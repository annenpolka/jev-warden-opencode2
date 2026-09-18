import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { evaluatePromotion } from "../src/promotion.mjs"
import { openLab, saveEpisode, summary } from "../src/store.mjs"

function decision(overrides = {}) {
  return {
    schemaVersion: "warden.work-comparison/0.1",
    decision: "promote_recommended",
    promotionRecommended: true,
    comparison: { enoughTrials: true },
    candidate: { id: "candidate-1", digest: "digest-1" },
    ...overrides,
  }
}

test("promotion: only a matching, sufficient recommendation is eligible", () => {
  assert.deepEqual(evaluatePromotion({ decision: decision(), bundleId: "candidate-1", digest: "digest-1" }), {
    eligible: true,
    reason: "recommended",
  })
  assert.equal(evaluatePromotion({ decision: null, bundleId: "c", digest: "d" }).reason, "decision_unreadable")
  assert.equal(
    evaluatePromotion({ decision: decision({ decision: "hold", promotionRecommended: false }), bundleId: "candidate-1", digest: "digest-1" }).reason,
    "not_recommended",
  )
  assert.equal(
    evaluatePromotion({ decision: decision({ comparison: { enoughTrials: false } }), bundleId: "candidate-1", digest: "digest-1" }).reason,
    "insufficient_trials",
  )
  assert.equal(
    evaluatePromotion({ decision: decision({ candidate: { id: "other", digest: "digest-1" } }), bundleId: "candidate-1", digest: "digest-1" }).reason,
    "candidate_id_mismatch",
  )
  assert.equal(
    evaluatePromotion({ decision: decision({ candidate: { id: "candidate-1", digest: "other" } }), bundleId: "candidate-1", digest: "digest-1" }).reason,
    "candidate_digest_mismatch",
  )
})

test("lab episodes: storing the same episode twice is idempotent", () => {
  const dir = mkdtempSync(join(tmpdir(), "jw-lab-"))
  try {
    const db = openLab(join(dir, "lab.db"))
    const episode = {
      id: "ep-1",
      decisionInputs: { sufficiency: 0.04, claim: 0.02 },
      outcome: { sufficiency: 0.86, claim: 0.96 },
      resolution: { state: "definition_gap_confirmed" },
    }
    assert.equal(saveEpisode(db, episode), true)
    assert.equal(saveEpisode(db, episode), false)
    assert.equal(summary(db).episodes, 1)
    assert.equal(summary(db).candidates, 0)
    db.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
