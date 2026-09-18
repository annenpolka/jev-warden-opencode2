/**
 * Event envelopes.
 *
 * Warden's long-term record lives in the Lab. The server plugin keeps a
 * bounded hot spool. An envelope therefore carries provenance and correlation
 * keys instead of raw content, and never invents a host identifier: host ids
 * are optional and `unknown` is explicit.
 */
import { nonBlank } from "./ids.ts"

export type WorkOrigin = "main_work" | "warden" | "experiment" | "audit"

export interface HostIds {
  readonly messageId?: string
  readonly toolCallId?: string
  readonly executionId?: string
  readonly permissionRequestId?: string
}

export interface EventEnvelope {
  /** Warden-internal event id (namespaced with `wev_`). */
  readonly id: string
  /** Monotonic Warden sequence within the server epoch. */
  readonly sequence: number
  readonly serverId: string
  readonly serverEpoch: string
  readonly locationId: string
  readonly projectId?: string
  readonly worktreeId?: string
  readonly sessionId?: string
  readonly agentId?: string
  readonly hostIds: HostIds
  readonly origin: WorkOrigin
  readonly type: string
  readonly policyId?: string
  readonly policyDigest?: string
  readonly snapshotId?: string
  readonly occurredAt: number
  readonly observedAt: number
  /** Digest of the payload stored in the content-addressed store. */
  readonly payloadDigest?: string
  /**
   * Scope fields that were derived from the plugin instance location (or are
   * otherwise unverified) for this event. An empty list means every recorded
   * scope value was verified against the event itself.
   */
  readonly unresolvedFields?: readonly string[]
}

export function validateEnvelope(envelope: EventEnvelope): void {
  nonBlank(envelope.id, "envelope.id")
  nonBlank(envelope.serverId, "envelope.serverId")
  nonBlank(envelope.serverEpoch, "envelope.serverEpoch")
  nonBlank(envelope.locationId, "envelope.locationId")
  nonBlank(envelope.type, "envelope.type")
  if (!Number.isInteger(envelope.sequence) || envelope.sequence < 0) {
    throw new TypeError("envelope.sequence must be a non-negative integer")
  }
  for (const [label, value] of [
    ["occurredAt", envelope.occurredAt],
    ["observedAt", envelope.observedAt],
  ] as const) {
    if (!Number.isFinite(value) || value < 0) throw new TypeError(`envelope.${label} must be a timestamp`)
  }
  if (envelope.unresolvedFields !== undefined) {
    for (const [index, field] of envelope.unresolvedFields.entries()) {
      nonBlank(field, `envelope.unresolvedFields[${index}]`)
    }
  }
}

/**
 * Suppresses recursive optimization scheduling. It is not an authorization or
 * audit-recording decision: every origin is still recorded.
 */
export function mayScheduleNewLearning(origin: WorkOrigin, isAuthorizedScheduler: boolean): boolean {
  return isAuthorizedScheduler && origin === "main_work"
}
