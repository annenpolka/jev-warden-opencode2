/**
 * Promotion eligibility.
 *
 * Pure decision logic: the Lab moves the active pointer only when the work
 * comparison recommends promotion, ran enough trials, and identifies the same
 * candidate bundle. Everything else records a hold.
 */
export function evaluatePromotion({ decision, bundleId, digest }) {
  if (decision === null || typeof decision !== "object") {
    return { eligible: false, reason: "decision_unreadable" }
  }
  if (decision.schemaVersion !== "warden.work-comparison/0.1") {
    return { eligible: false, reason: "unknown_decision_schema" }
  }
  if (decision.decision !== "promote_recommended" || decision.promotionRecommended !== true) {
    return { eligible: false, reason: "not_recommended" }
  }
  if (decision.comparison?.enoughTrials !== true) {
    return { eligible: false, reason: "insufficient_trials" }
  }
  if (decision.candidate?.id !== bundleId) {
    return { eligible: false, reason: "candidate_id_mismatch" }
  }
  if (typeof decision.candidate?.digest !== "string" || decision.candidate.digest !== digest) {
    return { eligible: false, reason: "candidate_digest_mismatch" }
  }
  return { eligible: true, reason: "recommended" }
}
