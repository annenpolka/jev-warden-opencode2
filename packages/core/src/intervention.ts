/**
 * Guidance delivery dedup.
 *
 * A retry or a re-dispatch must not inject the same finding for the same
 * snapshot and policy twice. The key is derived from the scope stamp plus the
 * finding and evidence digests. The in-memory ledger is a reference; the
 * adapter must persist the key atomically before delivery.
 */
import { nonBlank } from "./ids.ts"
import { validateViewStamp, type ViewStamp } from "./observation.ts"

export type GuidanceChannel = "context" | "tui"

export function interventionKey(
  stamp: ViewStamp,
  findingId: string,
  evidenceDigest: string,
  channel: GuidanceChannel,
): string {
  validateViewStamp(stamp)
  for (const [label, value] of [
    ["findingId", findingId],
    ["evidenceDigest", evidenceDigest],
  ] as const) {
    nonBlank(value, label)
  }
  if (channel !== "context" && channel !== "tui") throw new TypeError("Invalid channel")
  return JSON.stringify([
    stamp.scope.serverId,
    stamp.scope.serverEpoch,
    stamp.scope.locationId,
    stamp.scope.projectId,
    stamp.scope.worktreeId,
    stamp.scope.sessionId,
    stamp.scope.agentId,
    stamp.snapshotId,
    stamp.policyDigest,
    findingId,
    evidenceDigest,
    channel,
  ])
}

export class InterventionLedger {
  private readonly delivered = new Set<string>()

  /** Returns false when this exact intervention was already delivered. */
  claim(key: string): boolean {
    nonBlank(key, "key")
    if (this.delivered.has(key)) return false
    this.delivered.add(key)
    return true
  }

  has(key: string): boolean {
    return this.delivered.has(key)
  }

  get size(): number {
    return this.delivered.size
  }
}
