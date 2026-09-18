/**
 * Minimal status projection.
 *
 * Status counts observations; it never claims that the main model read,
 * accepted or benefited from anything. Delivery and effectiveness are
 * separate measurements recorded elsewhere.
 */
import type { NativeEffect } from "./permission.ts"

export interface WardenCounters {
  readonly promptObservations: number
  readonly contextObservations: number
  readonly toolBeforeObservations: number
  readonly toolAfterObservations: number
  readonly permissionEvaluations: number
  readonly guidanceDelivered: number
  readonly guidanceSuppressedByDedup: number
  readonly spooledEvents: number
  readonly droppedEvents: number
}

export interface WardenFlags {
  readonly durabilityDegraded: boolean
  readonly hostCapabilitiesDegraded: boolean
  readonly scopeUnresolved: boolean
  readonly labUnreachable: boolean
  readonly jevUnavailable: boolean
}

export interface WardenStatus {
  readonly schemaVersion: "warden.status/0.1"
  readonly pluginId: string
  readonly pluginVersion: string
  readonly mode: "observe" | "advise"
  readonly serverId: string
  readonly serverEpoch: string
  readonly locationId: string
  readonly policy: { readonly id: string; readonly digest: string } | null
  readonly counters: WardenCounters
  readonly flags: WardenFlags
  readonly lastPermissionEffect?: NativeEffect
  readonly updatedAt: number
}

export function emptyCounters(): WardenCounters {
  return {
    promptObservations: 0,
    contextObservations: 0,
    toolBeforeObservations: 0,
    toolAfterObservations: 0,
    permissionEvaluations: 0,
    guidanceDelivered: 0,
    guidanceSuppressedByDedup: 0,
    spooledEvents: 0,
    droppedEvents: 0,
  }
}

export function emptyFlags(): WardenFlags {
  return {
    durabilityDegraded: false,
    hostCapabilitiesDegraded: false,
    scopeUnresolved: false,
    labUnreachable: false,
    jevUnavailable: true,
  }
}

/** Status is display data; it deliberately contains no credentials or raw content. */
export function assertStatusSafe(status: WardenStatus): void {
  const text = JSON.stringify(status)
  for (const pattern of ["apiKey", "api_key", "authorization", "bearer ", "password"]) {
    if (text.toLowerCase().includes(pattern.toLowerCase())) {
      throw new TypeError(`status must not contain credential material (${pattern})`)
    }
  }
}
