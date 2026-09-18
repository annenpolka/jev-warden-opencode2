/**
 * Durable Lab store.
 *
 * Ingestion is at-least-once: the outbox may re-send events after a restart,
 * and this store dedups by envelope id. The ack cursor advances only across a
 * contiguous sequence from 1 within one (server, epoch) stream.
 */
import { DatabaseSync } from "node:sqlite"
import { existsSync, readFileSync, mkdirSync, renameSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"

export function openLab(path) {
  const db = new DatabaseSync(path)
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      server_id TEXT NOT NULL,
      server_epoch TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      type TEXT NOT NULL,
      origin TEXT NOT NULL,
      session_id TEXT,
      observed_at INTEGER NOT NULL,
      envelope TEXT NOT NULL,
      ingested_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS events_stream ON events (server_id, server_epoch, sequence);
    CREATE TABLE IF NOT EXISTS streams (
      server_id TEXT NOT NULL,
      server_epoch TEXT NOT NULL,
      ack_sequence INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (server_id, server_epoch)
    );
    CREATE TABLE IF NOT EXISTS episodes (
      id TEXT PRIMARY KEY,
      at INTEGER NOT NULL,
      decision_inputs TEXT NOT NULL,
      outcome TEXT NOT NULL,
      resolution TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS candidates (
      id TEXT PRIMARY KEY,
      digest TEXT NOT NULL,
      bundle TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS policy_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      bundle_id TEXT,
      digest TEXT,
      status TEXT NOT NULL,
      evaluation_ref TEXT,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS policy_history (
      entry_id INTEGER PRIMARY KEY AUTOINCREMENT,
      bundle_id TEXT NOT NULL,
      digest TEXT NOT NULL,
      action TEXT NOT NULL,
      evaluation_ref TEXT,
      at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS revoked_policies (
      digest TEXT PRIMARY KEY,
      reason TEXT NOT NULL,
      at INTEGER NOT NULL
    );
    INSERT OR IGNORE INTO policy_state (id, bundle_id, digest, status, evaluation_ref, updated_at)
      VALUES (1, NULL, NULL, 'baseline', NULL, 0);
  `)
  return db
}

export function ingestLines(db, lines, now = Date.now()) {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO events
      (id, server_id, server_epoch, sequence, type, origin, session_id, observed_at, envelope, ingested_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  let inserted = 0
  let duplicates = 0
  let invalid = 0
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    let envelope
    try {
      envelope = JSON.parse(trimmed)
    } catch {
      invalid += 1
      continue
    }
    if (
      typeof envelope?.id !== "string" ||
      typeof envelope?.serverId !== "string" ||
      typeof envelope?.serverEpoch !== "string" ||
      typeof envelope?.sequence !== "number" ||
      typeof envelope?.type !== "string"
    ) {
      invalid += 1
      continue
    }
    const result = insert.run(
      envelope.id,
      envelope.serverId,
      envelope.serverEpoch,
      envelope.sequence,
      envelope.type,
      typeof envelope.origin === "string" ? envelope.origin : "unknown",
      typeof envelope.sessionId === "string" ? envelope.sessionId : null,
      typeof envelope.observedAt === "number" ? envelope.observedAt : now,
      trimmed,
      now,
    )
    if (result.changes === 1) inserted += 1
    else duplicates += 1
  }
  const ack = updateAck(db, now)
  return { inserted, duplicates, invalid, ack }
}

export function ingestFile(db, path, now = Date.now()) {
  if (!existsSync(path)) return { read: 0, inserted: 0, duplicates: 0, invalid: 0, ack: [] }
  const lines = readFileSync(path, "utf8").split("\n")
  const result = ingestLines(db, lines, now)
  return { read: lines.length, ...result }
}

function updateAck(db, now) {
  const streams = db.prepare(`SELECT DISTINCT server_id, server_epoch FROM events`).all()
  const upsert = db.prepare(`
    INSERT INTO streams (server_id, server_epoch, ack_sequence, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT (server_id, server_epoch)
    DO UPDATE SET ack_sequence = excluded.ack_sequence, updated_at = excluded.updated_at
  `)
  const acks = []
  for (const stream of streams) {
    const sequences = db
      .prepare(`SELECT sequence FROM events WHERE server_id = ? AND server_epoch = ? ORDER BY sequence`)
      .all(stream.server_id, stream.server_epoch)
      .map((row) => row.sequence)
    let ack = 0
    for (const sequence of sequences) {
      if (sequence === ack + 1) ack += 1
      else if (sequence > ack + 1) break
    }
    upsert.run(stream.server_id, stream.server_epoch, ack, now)
    acks.push({ serverId: stream.server_id, serverEpoch: stream.server_epoch, ackSequence: ack })
  }
  return acks
}

export function summary(db) {
  const totals = db.prepare(`SELECT COUNT(*) AS events FROM events`).get()
  const types = db.prepare(`SELECT type, COUNT(*) AS count FROM events GROUP BY type ORDER BY count DESC`).all()
  const streams = db.prepare(`SELECT server_id, server_epoch, ack_sequence FROM streams ORDER BY server_id, server_epoch`).all()
  const recent = db
    .prepare(`SELECT id, sequence, type, session_id, observed_at FROM events ORDER BY ingested_at DESC LIMIT 10`)
    .all()
  return { events: totals.events, types, streams, recent }
}

// ---------------------------------------------------------------- episodes

export function saveEpisode(db, episode, now = Date.now()) {
  const result = db
    .prepare(`INSERT OR IGNORE INTO episodes (id, at, decision_inputs, outcome, resolution) VALUES (?, ?, ?, ?, ?)`)
    .run(
      episode.id,
      now,
      JSON.stringify(episode.decisionInputs ?? null),
      JSON.stringify(episode.outcome ?? null),
      JSON.stringify(episode.resolution ?? null),
    )
  return result.changes === 1
}

export function saveCandidate(db, candidate, now = Date.now()) {
  const result = db
    .prepare(`INSERT OR REPLACE INTO candidates (id, digest, bundle, created_at) VALUES (?, ?, ?, ?)`)
    .run(candidate.id, candidate.digest, JSON.stringify(candidate.bundle), now)
  return result.changes >= 1
}

// ---------------------------------------------------------------- policy pointer

export function activePolicy(db) {
  const state = db.prepare(`SELECT bundle_id, digest, status, evaluation_ref, updated_at FROM policy_state WHERE id = 1`).get()
  const revoked = db.prepare(`SELECT digest, reason, at FROM revoked_policies ORDER BY at`).all()
  return {
    bundleId: state.bundle_id,
    digest: state.digest,
    status: state.status,
    evaluationRef: state.evaluation_ref,
    updatedAt: state.updated_at,
    revoked: revoked.map((entry) => ({ digest: entry.digest, reason: entry.reason, at: entry.at })),
  }
}

export function policyHistory(db, limit = 32) {
  return db
    .prepare(`SELECT entry_id, bundle_id, digest, action, evaluation_ref, at FROM policy_history ORDER BY entry_id DESC LIMIT ?`)
    .all(limit)
}

function appendHistory(db, { bundleId, digest, action, evaluationRef, now }) {
  db.prepare(`INSERT INTO policy_history (bundle_id, digest, action, evaluation_ref, at) VALUES (?, ?, ?, ?, ?)`).run(
    bundleId,
    digest,
    action,
    evaluationRef ?? null,
    now,
  )
}

/** Moves the active pointer and appends history in one transaction. */
export function promotePolicy(db, { bundleId, digest, evaluationRef }, now = Date.now()) {
  const candidate = db.prepare(`SELECT id, digest FROM candidates WHERE id = ?`).get(bundleId)
  if (candidate === undefined) throw new Error(`unknown candidate: ${bundleId}`)
  if (candidate.digest !== digest) throw new Error(`candidate digest mismatch for ${bundleId}`)
  db.exec("BEGIN IMMEDIATE")
  try {
    db.prepare(`UPDATE policy_state SET bundle_id = ?, digest = ?, status = 'active', evaluation_ref = ?, updated_at = ? WHERE id = 1`).run(
      bundleId,
      digest,
      evaluationRef ?? null,
      now,
    )
    appendHistory(db, { bundleId, digest, action: "promote", evaluationRef, now })
    db.exec("COMMIT")
  } catch (error) {
    db.exec("ROLLBACK")
    throw error
  }
  return activePolicy(db)
}

export function rollbackPolicy(db, { evaluationRef } = {}, now = Date.now()) {
  const current = activePolicy(db)
  db.exec("BEGIN IMMEDIATE")
  try {
    db.prepare(`UPDATE policy_state SET bundle_id = NULL, digest = NULL, status = 'baseline', evaluation_ref = ?, updated_at = ? WHERE id = 1`).run(
      evaluationRef ?? null,
      now,
    )
    appendHistory(db, {
      bundleId: current.bundleId ?? "baseline",
      digest: current.digest ?? "",
      action: "rollback",
      evaluationRef,
      now,
    })
    db.exec("COMMIT")
  } catch (error) {
    db.exec("ROLLBACK")
    throw error
  }
  return activePolicy(db)
}

export function revokePolicy(db, { digest, reason }, now = Date.now()) {
  db.prepare(`INSERT OR REPLACE INTO revoked_policies (digest, reason, at) VALUES (?, ?, ?)`).run(digest, reason, now)
  appendHistory(db, { bundleId: "revoked", digest, action: "revoke", evaluationRef: reason, now })
  return activePolicy(db)
}

/**
 * Exports the active pointer and the active bundle as one JSON file that the
 * server plugin reads. Written atomically so a reader never sees a partial
 * pointer move.
 */
export function writeActivePolicyFile(db, path, now = Date.now()) {
  const state = activePolicy(db)
  let bundle = null
  if (state.bundleId !== null) {
    const row = db.prepare(`SELECT bundle FROM candidates WHERE id = ?`).get(state.bundleId)
    if (row !== undefined) bundle = JSON.parse(row.bundle)
  }
  const payload = {
    schemaVersion: "warden.active-policy/0.1",
    bundleId: state.bundleId,
    digest: state.digest,
    status: state.status,
    evaluationRef: state.evaluationRef,
    updatedAt: now,
    revokedDigests: state.revoked.map((entry) => entry.digest),
    ...(bundle === null ? {} : { bundle }),
  }
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp-${process.pid}`
  writeFileSync(tmp, JSON.stringify(payload, null, 2) + "\n")
  renameSync(tmp, path)
  return payload
}

