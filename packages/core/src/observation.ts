/**
 * Observations and their applicability.
 *
 * A completed observation is usable for a current request only when the scope,
 * snapshot and policy digest match and the evidence it depends on is present.
 * This is a freshness gate; it is not a semantic truth or acceptance gate.
 */
import { nonBlank } from "./ids.ts"
import { sameScope, validateScope, type Scope } from "./scope.ts"

export interface ViewStamp {
  readonly scope: Scope
  readonly snapshotId: string
  readonly policyDigest: string
}

export type ObservationStatus =
  | "completed"
  | "unavailable"
  | "invalid_response"
  | "budget_exhausted"
  | "cancelled"
  | "superseded"

export interface ObservationEnvelope extends ViewStamp {
  readonly id: string
  readonly status: ObservationStatus
  readonly requiredEvidence: "available" | "missing" | "unknown"
  /** Distinguishes the host execution identity from a Warden dispatch sequence. */
  readonly hostExecutionId?: string
  readonly wardenDispatchSequence: number
  readonly hostExecutionIdUnknown: boolean
}

export type EligibilityReason =
  | "not_completed"
  | "scope_mismatch"
  | "stale_snapshot"
  | "policy_mismatch"
  | "evidence_missing"

export type Eligibility =
  | { readonly eligible: true }
  | { readonly eligible: false; readonly reason: EligibilityReason }

export function validateViewStamp(stamp: ViewStamp): void {
  validateScope(stamp.scope)
  nonBlank(stamp.snapshotId, "stamp.snapshotId")
  nonBlank(stamp.policyDigest, "stamp.policyDigest")
}

export function observationEligibility(current: ViewStamp, observed: ObservationEnvelope): Eligibility {
  validateViewStamp(current)
  validateViewStamp(observed)
  nonBlank(observed.id, "observation.id")
  if (!Number.isInteger(observed.wardenDispatchSequence) || observed.wardenDispatchSequence < 0) {
    throw new TypeError("observation.wardenDispatchSequence must be a non-negative integer")
  }
  if (observed.status !== "completed") return { eligible: false, reason: "not_completed" }
  if (!sameScope(current.scope, observed.scope)) return { eligible: false, reason: "scope_mismatch" }
  if (current.snapshotId !== observed.snapshotId) return { eligible: false, reason: "stale_snapshot" }
  if (current.policyDigest !== observed.policyDigest) return { eligible: false, reason: "policy_mismatch" }
  if (observed.requiredEvidence !== "available") return { eligible: false, reason: "evidence_missing" }
  return { eligible: true }
}
