/**
 * Jev transport contract plus a dummy implementation.
 *
 * The dummy transport never fabricates a probability. Scripted results are
 * returned exactly as configured; an empty script yields `unavailable`, which
 * stays distinct from "evaluated false". No confidence value may ever be used
 * to authorize an action.
 */
import type { ObservationStatus } from "./observation.ts"
import type { JevEvaluator, ProbeResult } from "./ports.ts"
import type { PolicyProbe } from "./policy.ts"
import type { ViewStamp } from "./observation.ts"

export interface JevTransportRequest {
  readonly requestId: string
  readonly probeId: string
  readonly instructions: string
  readonly inputsRef: string
  readonly model: string
}

export interface JevTransportResult {
  readonly status: ObservationStatus
  readonly value?: unknown
  readonly error?: string
  readonly model?: string
  readonly usage?: { readonly inputTokens?: number; readonly outputTokens?: number }
}

/**
 * A host-agnostic cancellation token. Core never touches AbortSignal/DOM
 * globals; adapters translate host cancellation into this shape.
 */
export interface Cancellation {
  readonly cancelled: boolean
  onCancel(listener: () => void): void
}

export function neverCancelled(): Cancellation {
  return { cancelled: false, onCancel: () => {} }
}

export interface JevTransport {
  evaluate(request: JevTransportRequest, cancellation: Cancellation): Promise<readonly JevTransportResult[]>
}

export type DummyScript = Readonly<Record<string, readonly JevTransportResult[]>>

/**
 * Returns scripted transport results by probe id. Requests for probe ids that
 * are not scripted return `unavailable` (never a low probability).
 */
export class DummyTransport implements JevTransport {
  private readonly script: DummyScript
  private readonly calls: JevTransportRequest[]

  constructor(script: DummyScript = {}, calls: JevTransportRequest[] = []) {
    this.script = script
    this.calls = calls
  }

  async evaluate(request: JevTransportRequest, _cancellation: Cancellation): Promise<readonly JevTransportResult[]> {
    this.calls.push(request)
    return this.script[request.probeId] ?? [{ status: "unavailable", error: "dummy_transport_unscripted" }]
  }

  get callLog(): readonly JevTransportRequest[] {
    return this.calls
  }
}

/** Adapts a transport to the Core evaluator port without hiding failures. */
export class TransportEvaluator implements JevEvaluator {
  private readonly transport: JevTransport

  constructor(transport: JevTransport) {
    this.transport = transport
  }

  async evaluate(
    probes: readonly PolicyProbe[],
    _stamp: ViewStamp,
    inputs: Readonly<Record<string, unknown>>,
  ): Promise<readonly ProbeResult[]> {
    const results: ProbeResult[] = []
    for (const probe of probes) {
      const transportResults = await this.transport.evaluate(
        {
          requestId: `${probe.id}:${Date.now()}`,
          probeId: probe.id,
          instructions: probe.instructions,
          inputsRef: JSON.stringify(probe.inputs),
          model: "dummy",
        },
        neverCancelled(),
      )
      for (const result of transportResults) {
        results.push({
          probeId: probe.id,
          status: result.status,
          ...(result.value === undefined ? {} : { value: result.value }),
          ...(result.error === undefined ? {} : { error: result.error }),
          ...(result.model === undefined ? {} : { model: result.model }),
          ...(result.usage === undefined ? {} : { usage: result.usage }),
        })
      }
    }
    void inputs
    return results
  }
}
