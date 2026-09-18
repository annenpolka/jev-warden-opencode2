/**
 * Lab port and an in-memory reference implementation.
 *
 * Ingestion is at-least-once: appending the same event id twice stores one
 * copy. The ack cursor advances only past contiguous stored sequences. The
 * in-memory version is for tests and Phase 0; durability semantics belong to
 * the Lab storage implementation.
 */
import { nonBlank } from "./ids.ts"
import type { EventEnvelope } from "./envelope.ts"
import type { LabClient } from "./ports.ts"
import type { PolicyBundle } from "./policy.ts"
import type { Scope } from "./scope.ts"

export interface LabAppendResult {
  readonly stored: number
  readonly duplicates: number
  readonly ackedSequence: number
}

export class InMemoryLab implements LabClient {
  readonly handshake: { readonly endpoint: string; readonly serverEpoch: string }
  private readonly events = new Map<string, EventEnvelope>()
  private readonly sequences = new Set<number>()
  private ackedSequence = 0

  constructor(endpoint = "memory://lab", serverEpoch = "epoch-0") {
    this.handshake = { endpoint, serverEpoch }
  }

  appendEvent(envelope: EventEnvelope): { readonly stored: boolean; readonly ackedSequence: number } {
    if (this.events.has(envelope.id)) return { stored: false, ackedSequence: this.ackedSequence }
    this.events.set(envelope.id, envelope)
    this.sequences.add(envelope.sequence)
    while (this.sequences.has(this.ackedSequence + 1)) this.ackedSequence += 1
    return { stored: true, ackedSequence: this.ackedSequence }
  }

  appendEvents(events: readonly EventEnvelope[]): Promise<LabAppendResult> {
    let stored = 0
    let duplicates = 0
    for (const envelope of events) {
      const result = this.appendEvent(envelope)
      if (result.stored) stored += 1
      else duplicates += 1
    }
    return Promise.resolve({ stored, duplicates, ackedSequence: this.ackedSequence })
  }

  fetchPolicy(scope: Scope): Promise<PolicyBundle | null> {
    nonBlank(scope.sessionId, "scope.sessionId")
    return Promise.resolve(null)
  }

  get cursor(): number {
    return this.ackedSequence
  }

  get size(): number {
    return this.events.size
  }

  has(id: string): boolean {
    return this.events.has(id)
  }
}
