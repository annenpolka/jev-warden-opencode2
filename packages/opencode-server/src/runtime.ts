/**
 * Server-plugin runtime state.
 *
 * This object holds the hot cache: counters, a bounded in-memory spool, the
 * pending tool-call map used to compare requested and effective input, and
 * the Warden-local dispatch sequence. It is not durable storage and it never
 * holds credentials or raw source content.
 */
import {
  correlationDigest,
  emptyCounters,
  emptyFlags,
  SessionPins,
  type EventEnvelope,
  type HostIds,
  type NativeEffect,
  type PolicyPin,
  type WardenCounters,
  type WardenFlags,
  type WardenStatus,
  type WorkOrigin,
} from "@jev-warden/core"
import type { WardenOptions } from "./options.ts"

/** Built-in baseline pin used until an adopted bundle exists. */
export const BASELINE_POLICY_ID = "baseline-observe-only"
export const BASELINE_POLICY_DIGEST = correlationDigest(
  "warden.policy.baseline/0.1:observe-only:no-guidance:no-permission-change",
)

export interface ScopeProvenance {
  /** True when the adapter could resolve this field from host data, not from ctx.location inference. */
  readonly serverIdResolved: boolean
  readonly locationResolvedForPluginInstance: boolean
  readonly sessionLocationResolved: boolean
  readonly worktreeResolved: boolean
}

export interface PendingToolCall {
  readonly tool: string
  readonly sessionID: string
  readonly agentID: string
  readonly messageID: string
  readonly beforeDigest: string
  readonly observedAt: number
}

export interface RecordInput {
  readonly type: string
  readonly origin?: WorkOrigin
  readonly hostIds?: HostIds
  readonly sessionId?: string
  readonly agentId?: string
  readonly hostOccurredAt?: number
  readonly payloadDigest?: string
  readonly snapshotId?: string
  readonly policyId?: string
  readonly policyDigest?: string
  /** True only when the event itself carried a location verified against the session. */
  readonly hostLocationVerified?: boolean
}

export const PLUGIN_ID = "jev-warden"
export const PLUGIN_VERSION = "0.1.0"
export const SPOOL_LIMIT = 512
export const STORAGE_KEY = "spool/v1"

export class WardenRuntime {
  readonly pluginId = PLUGIN_ID
  readonly pluginVersion = PLUGIN_VERSION
  readonly options: WardenOptions
  readonly serverEpoch: string
  readonly locationDirectory: string
  readonly locationId: string
  readonly projectId: string
  readonly worktreeId: string
  readonly serverId: string
  private readonly counters: { -readonly [K in keyof WardenCounters]: number }
  private readonly flags: { -readonly [K in keyof WardenFlags]: boolean }
  private readonly spool: EventEnvelope[] = []
  private readonly pending = new Map<string, PendingToolCall>()
  private readonly pins = new SessionPins()
  private readonly revokedDigests = new Set<string>()
  private readonly guidanceBySession = new Map<string, boolean>()
  private sequence = 0
  private counter = 0
  private unresolvedScopeEvents = 0
  private lastPermissionEffect?: NativeEffect
  private lastEventType?: string
  private readonly eventTypes = new Map<string, number>()
  private updatedAt = Date.now()
  private durabilityDegraded = false
  private readonly optionErrorsValue: readonly string[]
  private changedEmitter: ((reason: string) => void) | null = null

  constructor(input: {
    readonly options: WardenOptions
    readonly optionErrors: readonly string[]
    readonly locationDirectory: string
    readonly projectId: string
    readonly worktreeId: string
  }) {
    this.options = input.options
    this.optionErrorsValue = input.optionErrors
    this.locationDirectory = input.locationDirectory
    this.projectId = input.projectId
    this.worktreeId = input.worktreeId
    this.serverId = input.options.serverId ?? `local-server:${input.projectId}`
    this.serverEpoch = `epoch_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
    this.locationId = `loc_${correlationDigest(input.locationDirectory).slice(-16)}`
    this.counters = emptyCounters() as { [K in keyof WardenCounters]: number }
    this.flags = emptyFlags() as { [K in keyof WardenFlags]: boolean }
    // Without an operator-provided server id the adapter cannot resolve the
    // connected server, so evidence must not be sent off-host.
    this.flags.scopeUnresolved = input.options.serverId === null
    this.flags.jevUnavailable = true
  }

  setChangedEmitter(emitter: (reason: string) => void): void {
    this.changedEmitter = emitter
  }

  /**
   * Binds a policy to a session at first observation. The caller supplies the
   * adopted bundle when one is active; otherwise the built-in baseline is used.
   * A later active-pointer move does not replace an existing session pin.
   */
  bindSessionPin(
    input: { readonly sessionId: string; readonly agentId?: string },
    policy?: { readonly id: string; readonly digest: string },
    guidanceEnabled = false,
  ): PolicyPin {
    const pin = this.pins.pin(
      {
        serverId: this.serverId,
        serverEpoch: this.serverEpoch,
        locationId: this.locationId,
        projectId: this.projectId,
        worktreeId: this.worktreeId,
        sessionId: input.sessionId,
        agentId: input.agentId ?? "unobserved",
      },
      policy ?? { id: BASELINE_POLICY_ID, digest: BASELINE_POLICY_DIGEST },
    )
    if (!this.guidanceBySession.has(input.sessionId)) {
      this.guidanceBySession.set(input.sessionId, guidanceEnabled)
    }
    return pin
  }

  noteRevokedDigests(digests: readonly string[]): void {
    for (const digest of digests) this.revokedDigests.add(digest)
  }

  isRevoked(digest: string): boolean {
    return this.revokedDigests.has(digest)
  }

  /** Whether context guidance is delivered for this session, and why not. */
  guidanceGate(sessionId: string): "deliver" | "suppress" | "revoked" {
    const pin = this.pinFor({ sessionId })
    if (pin === undefined) return "suppress"
    if (this.isRevoked(pin.policyDigest)) return "revoked"
    return this.guidanceBySession.get(sessionId) === true ? "deliver" : "suppress"
  }

  pinsView(): readonly Record<string, unknown>[] {
    return [...this.guidanceBySession.entries()].map(([sessionId, guidance]) => {
      const pin = this.pinFor({ sessionId })
      return {
        sessionId,
        policyId: pin?.policyId ?? null,
        policyDigest: pin?.policyDigest ?? null,
        guidance,
        revoked: pin === undefined ? false : this.isRevoked(pin.policyDigest),
      }
    })
  }

  pinFor(input: { readonly sessionId: string; readonly agentId?: string }): PolicyPin | undefined {
    const read = this.pins.read({
      serverId: this.serverId,
      serverEpoch: this.serverEpoch,
      locationId: this.locationId,
      projectId: this.projectId,
      worktreeId: this.worktreeId,
      sessionId: input.sessionId,
      agentId: input.agentId ?? "unobserved",
    })
    return read.kind === "missing" ? undefined : read.pin
  }

  record(input: RecordInput): EventEnvelope {
    this.counter += 1
    this.sequence += 1
    const now = Date.now()
    const locationDerived = input.sessionId !== undefined && input.hostLocationVerified !== true
    if (locationDerived) this.unresolvedScopeEvents += 1
    const pin =
      input.sessionId === undefined
        ? undefined
        : this.pinFor({ sessionId: input.sessionId, ...(input.agentId === undefined ? {} : { agentId: input.agentId }) })
    const envelope: EventEnvelope = {
      id: `wev_${this.serverEpoch}_${this.sequence}`,
      sequence: this.sequence,
      serverId: this.serverId,
      serverEpoch: this.serverEpoch,
      locationId: this.locationId,
      projectId: this.projectId,
      worktreeId: this.worktreeId,
      ...(locationDerived ? { unresolvedFields: ["projectId", "worktreeId"] } : {}),
      ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
      ...(input.agentId === undefined ? {} : { agentId: input.agentId }),
      hostIds: input.hostIds ?? {},
      origin: input.origin ?? "main_work",
      type: input.type,
      ...(input.policyId === undefined
        ? pin === undefined
          ? {}
          : { policyId: pin.policyId }
        : { policyId: input.policyId }),
      ...(input.policyDigest === undefined
        ? pin === undefined
          ? {}
          : { policyDigest: pin.policyDigest }
        : { policyDigest: input.policyDigest }),
      ...(input.snapshotId === undefined ? {} : { snapshotId: input.snapshotId }),
      occurredAt: input.hostOccurredAt ?? now,
      observedAt: now,
      ...(input.payloadDigest === undefined ? {} : { payloadDigest: input.payloadDigest }),
    }
    this.spool.push(envelope)
    if (this.spool.length > SPOOL_LIMIT) {
      this.spool.shift()
      this.counters.droppedEvents += 1
      this.durabilityDegraded = true
    }
    this.updatedAt = now
    this.changedEmitter?.(input.type)
    return envelope
  }

  increment(counter: keyof WardenCounters, by = 1): void {
    this.counters[counter] += by
  }

  setCounter(counter: keyof WardenCounters, value: number): void {
    this.counters[counter] = value
  }

  setFlag(flag: keyof WardenFlags, value: boolean): void {
    this.flags[flag] = value
  }

  setLastPermissionEffect(effect: NativeEffect): void {
    this.lastPermissionEffect = effect
  }

  noteEventType(type: string): void {
    this.lastEventType = type
    this.eventTypes.set(type, (this.eventTypes.get(type) ?? 0) + 1)
  }

  rememberToolCall(id: string, call: PendingToolCall): void {
    this.pending.set(id, call)
  }

  takeToolCall(id: string): PendingToolCall | undefined {
    const call = this.pending.get(id)
    this.pending.delete(id)
    return call
  }

  markDurabilityDegraded(): void {
    this.durabilityDegraded = true
  }

  get optionErrors(): readonly string[] {
    return this.optionErrorsValue
  }

  get spoolSnapshot(): readonly EventEnvelope[] {
    return this.spool
  }

  get currentSequence(): number {
    return this.sequence
  }

  status(): WardenStatus {
    return {
      schemaVersion: "warden.status/0.1",
      pluginId: this.pluginId,
      pluginVersion: this.pluginVersion,
      mode: this.options.mode,
      serverId: this.serverId,
      serverEpoch: this.serverEpoch,
      locationId: this.locationId,
      policy: null,
      counters: { ...this.counters },
      flags: { ...this.flags, durabilityDegraded: this.durabilityDegraded || this.flags.durabilityDegraded },
      ...(this.lastPermissionEffect === undefined ? {} : { lastPermissionEffect: this.lastPermissionEffect }),
      updatedAt: this.updatedAt,
    }
  }

  statusLine(): string {
    const counters = this.counters
    const unresolved = this.flags.scopeUnresolved ? " scope unresolved" : ""
    return [
      "Warden",
      `mode ${this.options.mode}`,
      "policy unbound",
      `probes ${counters.permissionEvaluations}`,
      `observed ${counters.promptObservations + counters.toolBeforeObservations}`,
      `unresolved ${unresolved.trim() === "" ? 0 : 1}`,
    ].join(" / ")
  }

  /** Debug projection for the RPC snapshot method; no raw content. */
  debugSummary(): Record<string, unknown> {
    return {
      sequence: this.sequence,
      spool: this.spool.length,
      pendingToolCalls: this.pending.size,
      lastEventType: this.lastEventType ?? null,
      optionErrors: this.optionErrors,
      eventTypes: Object.fromEntries(this.eventTypes),
      pinnedSessions: this.pins.size,
      unresolvedScopeEvents: this.unresolvedScopeEvents,
      revokedDigests: this.revokedDigests.size,
      baselinePolicy: { id: BASELINE_POLICY_ID, digest: BASELINE_POLICY_DIGEST },
      pins: this.pinsView(),
    }
  }

  dispose(): void {
    this.changedEmitter = null
    this.pending.clear()
  }
}
