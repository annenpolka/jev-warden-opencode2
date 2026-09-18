/**
 * Explicit review jobs.
 *
 * A review runs only when a caller invokes the `review.request` RPC: Warden
 * never fires Jev from a hook on its own. The request is built from
 * caller-provided, named state keys, checked against a registered probe,
 * scanned for credential shapes, and recorded with raw answers. Probabilities
 * are observations, never authorization.
 */
import { scanForCredentials } from "@jev-warden/core"
import type { JevAnswer, JevCallStatus, LiveJev } from "./jev-live.ts"
import { getProbe, type ProbeDefinition } from "./probes.ts"
import type { WardenRuntime } from "./runtime.ts"

export interface ReviewInput {
  readonly sessionID?: string
  readonly probeID: string
  readonly state: Readonly<Record<string, unknown>>
  readonly stateRefs?: readonly string[]
}

export type ReviewStatus = JevCallStatus | "rejected"

export interface ReviewObservation {
  readonly at: number
  readonly sessionID: string | null
  readonly probeID: string
  readonly status: ReviewStatus
  readonly requestDigest: string
  readonly stateDigest: string
  readonly answers?: Readonly<Record<string, JevAnswer>>
  readonly model?: string
  readonly error?: string
  readonly usage?: { readonly inputTokens?: number; readonly outputTokens?: number }
  readonly stateRefs: readonly string[]
}

export interface ReviewOutput {
  readonly status: ReviewStatus
  readonly requestDigest: string
  readonly model?: string
  readonly answers?: Readonly<Record<string, JevAnswer>>
  readonly error?: string
}

const LEDGER_LIMIT = 64

export class ReviewLedger {
  private readonly items: ReviewObservation[] = []

  add(observation: ReviewObservation): void {
    this.items.push(observation)
    if (this.items.length > LEDGER_LIMIT) this.items.shift()
  }

  list(sessionID?: string, limit = 32): readonly ReviewObservation[] {
    const filtered = sessionID === undefined ? this.items : this.items.filter((item) => item.sessionID === sessionID)
    return filtered.slice(-limit)
  }

  get size(): number {
    return this.items.length
  }
}

export interface ReviewDeps {
  readonly runtime: WardenRuntime
  readonly transport: LiveJev | null
  readonly ledger: ReviewLedger
}

export async function requestReview(deps: ReviewDeps, input: ReviewInput): Promise<ReviewOutput> {
  const { runtime, ledger } = deps
  const probe = typeof input?.probeID === "string" ? getProbe(input.probeID) : undefined
  if (probe === undefined) {
    return reject(deps, input, "unknown_probe")
  }
  if (deps.transport === null) {
    return reject(deps, input, "jev_disabled")
  }
  const state = input.state ?? {}
  const missingKey = missingStateKey(probe, state)
  if (missingKey !== undefined) {
    return reject(deps, input, `missing_state_key:${missingKey}`)
  }

  const findings = scanForCredentials(state, "state")
  if (findings.length > 0) {
    // Only the category and location are recorded; the matched value is not.
    const summary = findings.map((finding) => `${finding.category}@${finding.location}`).join(",")
    return reject(deps, input, `credential_pattern:${summary}`)
  }

  const result = await deps.transport.evaluate(state, probe.questions)
  const observation: ReviewObservation = {
    at: Date.now(),
    sessionID: input.sessionID ?? null,
    probeID: probe.id,
    status: result.status,
    requestDigest: result.requestDigest,
    stateDigest: result.stateDigest,
    ...(result.answers === undefined ? {} : { answers: result.answers }),
    ...(result.model === undefined ? {} : { model: result.model }),
    ...(result.error === undefined ? {} : { error: result.error }),
    ...(result.usage === undefined ? {} : { usage: result.usage }),
    ...(result.rawSample === undefined ? {} : { rawSample: result.rawSample }),
    stateRefs: input.stateRefs ?? [],
  }
  ledger.add(observation)
  if (result.status === "completed") {
    runtime.increment("jevObservations")
    runtime.record({
      type: "jev.observation",
      ...(input.sessionID === undefined ? {} : { sessionId: input.sessionID }),
      payloadDigest: result.requestDigest,
    })
  } else {
    runtime.increment("jevRejected")
    runtime.record({
      type: "jev.failed",
      ...(input.sessionID === undefined ? {} : { sessionId: input.sessionID }),
      payloadDigest: result.requestDigest,
    })
  }
  return {
    status: result.status,
    requestDigest: result.requestDigest,
    ...(result.model === undefined ? {} : { model: result.model }),
    ...(result.answers === undefined ? {} : { answers: result.answers }),
    ...(result.error === undefined ? {} : { error: result.error }),
  }
}

function reject(deps: ReviewDeps, input: ReviewInput, error: string): ReviewOutput {
  const at = Date.now()
  deps.ledger.add({
    at,
    sessionID: input?.sessionID ?? null,
    probeID: typeof input?.probeID === "string" ? input.probeID : "unknown",
    status: "rejected",
    requestDigest: "",
    stateDigest: "",
    error,
    stateRefs: input?.stateRefs ?? [],
  })
  deps.runtime.increment("jevRejected")
  deps.runtime.record({ type: "jev.rejected" })
  return { status: "rejected", requestDigest: "", error }
}

function missingStateKey(probe: ProbeDefinition, state: Readonly<Record<string, unknown>>): string | undefined {
  for (const key of probe.requiredStateKeys) {
    const value = state[key]
    if (typeof value !== "string" || value.trim().length === 0) return key
  }
  return undefined
}
