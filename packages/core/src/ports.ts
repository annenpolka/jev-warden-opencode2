/**
 * Warden internal ports. These are Warden's own boundary names, not OpenCode
 * API names. The Core never imports the host, Effect or Node; adapters
 * implement these ports and validate host payloads before constructing Core
 * values.
 */
import type { EventEnvelope } from "./envelope.ts"
import type { NativeEffect } from "./permission.ts"
import type { ObservationEnvelope, ObservationStatus, ViewStamp } from "./observation.ts"
import type { PolicyBundle, PolicyProbe } from "./policy.ts"
import type { Scope } from "./scope.ts"

export interface Clock {
  now(): number
}

export interface GrantChecker {
  /** Returns true only for an explicit, still-valid grant for this scope and action. */
  isGranted(scope: Scope, action: string, resourceRef: string): Promise<boolean>
}

export interface SourceReadRequest {
  readonly scope: Scope
  readonly snapshotId: string
  readonly sourceRef: string
  readonly range?: { readonly start: number; readonly end: number }
}

export interface SourceReadResult {
  readonly status: "read" | "not_found" | "denied" | "unsupported" | "error"
  readonly content?: string
  readonly digest?: string
  readonly version?: string
  readonly message?: string
}

export interface SourceReader {
  read(request: SourceReadRequest): Promise<SourceReadResult>
}

export interface EventRecorder {
  record(envelope: EventEnvelope): Promise<void>
}

export interface ProbeResult {
  readonly probeId: string
  readonly status: ObservationStatus
  readonly value?: unknown
  readonly error?: string
  readonly model?: string
  readonly usage?: { readonly inputTokens?: number; readonly outputTokens?: number }
}

export interface JevEvaluator {
  evaluate(probes: readonly PolicyProbe[], stamp: ViewStamp, inputs: Readonly<Record<string, unknown>>): Promise<readonly ProbeResult[]>
}

export interface GuidanceCandidate {
  readonly findingId: string
  readonly evidenceDigest: string
  readonly text: string
}

export interface GuidanceSink {
  /** Returns true when the guidance was accepted for delivery. */
  deliver(stamp: ViewStamp, guidance: readonly GuidanceCandidate[]): Promise<boolean>
}

export interface SkillCandidate {
  readonly id: string
  readonly reason: string
  readonly catalogVersion: string
}

export interface SkillCatalog {
  list(): Promise<readonly { readonly id: string; readonly description: string; readonly catalogVersion: string }[]>
}

export interface CheckRequest {
  readonly checkRef: string
  readonly snapshotId: string
  readonly argv: readonly string[]
  readonly timeoutMs: number
}

export interface CheckResult {
  readonly status: "completed" | "timeout" | "unsupported" | "error"
  readonly exitCode?: number
  readonly stdoutDigest?: string
  readonly stderrDigest?: string
}

export interface CheckExecutor {
  run(request: CheckRequest): Promise<CheckResult>
}

export interface GenerationRequest {
  readonly purpose: "probe_candidates" | "explain"
  readonly scope: Scope
  readonly promptTemplateId: string
  readonly inputs: Readonly<Record<string, unknown>>
}

export interface GenerationPort {
  generate(request: GenerationRequest): Promise<{ readonly status: "completed" | "unavailable"; readonly text?: string }>
}

export interface LabClient {
  readonly handshake: { readonly endpoint: string; readonly serverEpoch: string }
  appendEvents(events: readonly EventEnvelope[]): Promise<{ readonly ackedSequence: number }>
  fetchPolicy(scope: Scope): Promise<PolicyBundle | null>
}

export interface PermissionObservation {
  readonly observed: NativeEffect
  readonly action: string
  readonly resources: readonly string[]
  readonly hostExecutionId?: string
}

export interface ObservationStore {
  put(observation: ObservationEnvelope): Promise<void>
  get(id: string): Promise<ObservationEnvelope | undefined>
}
