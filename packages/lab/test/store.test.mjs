import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ingestLines, openLab, summary } from "../src/store.mjs"
import {
  activePolicy,
  policyHistory,
  promotePolicy,
  recordHold,
  revokePolicy,
  rollbackPolicy,
  saveCandidate,
  saveEpisode,
  writeActivePolicyFile,
} from "../src/store.mjs"

function envelope(sequence, overrides = {}) {
  const serverEpoch = overrides.serverEpoch ?? "epoch-1"
  return {
    id: `wev_${serverEpoch}_${sequence}`,
    sequence,
    serverId: "server-a",
    serverEpoch,
    locationId: "loc-a",
    hostIds: {},
    origin: "main_work",
    type: "prompt.observed",
    occurredAt: sequence,
    observedAt: sequence,
    ...overrides,
  }
}

test("lab store: ingestion is idempotent by envelope id", () => {
  const dir = mkdtempSync(join(tmpdir(), "jw-lab-"))
  try {
    const db = openLab(join(dir, "lab.db"))
    const lines = [JSON.stringify(envelope(1)), JSON.stringify(envelope(2)), JSON.stringify(envelope(3))]
    const first = ingestLines(db, lines)
    assert.equal(first.inserted, 3)
    assert.equal(first.duplicates, 0)
    assert.equal(first.ack[0].ackSequence, 3)
    const second = ingestLines(db, lines)
    assert.equal(second.inserted, 0)
    assert.equal(second.duplicates, 3)
    assert.equal(summary(db).events, 3)
    db.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("lab store: ack waits for a contiguous sequence and per-stream streams stay separate", () => {
  const dir = mkdtempSync(join(tmpdir(), "jw-lab-"))
  try {
    const db = openLab(join(dir, "lab.db"))
    ingestLines(db, [JSON.stringify(envelope(1)), JSON.stringify(envelope(3))])
    let streams = summary(db).streams
    assert.deepEqual(streams.map((stream) => stream.ack_sequence), [1])
    ingestLines(db, [JSON.stringify(envelope(2))])
    streams = summary(db).streams
    assert.deepEqual(streams.map((stream) => stream.ack_sequence), [3])
    ingestLines(db, [JSON.stringify(envelope(1, { serverEpoch: "epoch-2" }))])
    streams = summary(db).streams
    assert.equal(streams.length, 2)
    db.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("lab store: malformed lines are counted, not stored", () => {
  const dir = mkdtempSync(join(tmpdir(), "jw-lab-"))
  try {
    const db = openLab(join(dir, "lab.db"))
    writeFileSync(join(dir, "outbox.jsonl"), "")
    const result = ingestLines(db, ["not json", JSON.stringify({ id: "x" }), JSON.stringify(envelope(1))])
    assert.equal(result.invalid, 2)
    assert.equal(result.inserted, 1)
    db.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("lab policy: promote, rollback and revoke move the pointer with history", () => {
  const dir = mkdtempSync(join(tmpdir(), "jw-lab-"))
  try {
    const db = openLab(join(dir, "lab.db"))
    assert.equal(activePolicy(db).status, "baseline")
    assert.throws(() => promotePolicy(db, { bundleId: "missing", digest: "x", evaluationRef: "e" }))
    saveCandidate(db, { id: "candidate-1", digest: "digest-1", bundle: { schemaVersion: "warden.policy/0.1", id: "candidate-1" } })
    assert.throws(() => promotePolicy(db, { bundleId: "candidate-1", digest: "wrong", evaluationRef: "e" }))
    assert.equal(activePolicy(db).status, "baseline", "a failed promote must not move the pointer")

    const promoted = promotePolicy(db, { bundleId: "candidate-1", digest: "digest-1", evaluationRef: "eval-1" })
    assert.equal(promoted.status, "active")
    assert.equal(promoted.bundleId, "candidate-1")
    const rolled = rollbackPolicy(db, { evaluationRef: "eval-2" })
    assert.equal(rolled.status, "baseline")
    revokePolicy(db, { digest: "digest-1", reason: "bad-candidate" })
    const state = activePolicy(db)
    assert.deepEqual(state.revoked.map((entry) => entry.digest), ["digest-1"])
    assert.deepEqual(
      policyHistory(db).map((entry) => entry.action),
      ["revoke", "rollback", "promote"],
    )

    const exportPath = join(dir, "policy", "active.json")
    const exported = writeActivePolicyFile(db, exportPath)
    assert.equal(exported.status, "baseline")
    assert.deepEqual(exported.revokedDigests, ["digest-1"])
    const readBack = JSON.parse(readFileSync(exportPath, "utf8"))
    assert.equal(readBack.schemaVersion, "warden.active-policy/0.1")
    db.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("lab policy: an active candidate is exported with its bundle", () => {
  const dir = mkdtempSync(join(tmpdir(), "jw-lab-"))
  try {
    const db = openLab(join(dir, "lab.db"))
    const bundle = { schemaVersion: "warden.policy/0.1", id: "candidate-2", status: "candidate" }
    saveCandidate(db, { id: "candidate-2", digest: "digest-2", bundle })
    promotePolicy(db, { bundleId: "candidate-2", digest: "digest-2", evaluationRef: "eval-3" })
    const exportPath = join(dir, "policy", "active.json")
    writeActivePolicyFile(db, exportPath)
    const readBack = JSON.parse(readFileSync(exportPath, "utf8"))
    assert.equal(readBack.bundleId, "candidate-2")
    assert.deepEqual(readBack.bundle, bundle)
    db.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("lab policy: a hold decision records history without moving the pointer", () => {
  const dir = mkdtempSync(join(tmpdir(), "jw-lab-"))
  try {
    const db = openLab(join(dir, "lab.db"))
    saveCandidate(db, { id: "candidate-3", digest: "digest-3", bundle: { id: "candidate-3" } })
    recordHold(db, { bundleId: "candidate-3", digest: "digest-3", evaluationRef: "decision-1", reason: "not_recommended" })
    assert.equal(activePolicy(db).status, "baseline")
    const history = policyHistory(db)
    assert.equal(history[0].action, "hold")
    db.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
