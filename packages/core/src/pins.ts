/**
 * Policy pins.
 *
 * A session keeps the policy it started with. A global active-pointer update
 * is never an atomic switch for running sessions, and an unavailable pin is
 * held rather than silently replaced with the latest bundle.
 *
 * This in-memory implementation is a reference for the pure decision logic.
 * Production pins need durable storage; the adapter owns persistence.
 */
import { nonBlank } from "./ids.ts"
import { scopeKey, sessionScopeOf, type Scope, type SessionScope } from "./scope.ts"

export interface PolicyRef {
  readonly id: string
  readonly digest: string
}

export interface PolicyPin {
  readonly scope: SessionScope
  readonly policyId: string
  readonly policyDigest: string
}

export type PinRead =
  | { readonly kind: "missing" }
  | { readonly kind: "active"; readonly pin: PolicyPin }
  | { readonly kind: "revoked"; readonly pin: PolicyPin; readonly reason: string }

export class SessionPins {
  private readonly pins = new Map<string, PolicyPin>()
  private readonly revoked = new Map<string, string>()

  pin(scope: Scope, policy: PolicyRef): PolicyPin {
    nonBlank(policy.id, "policy.id")
    nonBlank(policy.digest, "policy.digest")
    const key = scopeKey(scope)
    const existing = this.pins.get(key)
    if (existing) return existing // an active-pointer move never replaces an existing pin
    const value: PolicyPin = Object.freeze({
      scope: sessionScopeOf(scope),
      policyId: policy.id,
      policyDigest: policy.digest,
    })
    this.pins.set(key, value)
    return value
  }

  revokeDigest(digest: string, reason: string): void {
    nonBlank(digest, "digest")
    nonBlank(reason, "reason")
    this.revoked.set(digest, reason)
  }

  read(scope: Scope): PinRead {
    const pin = this.pins.get(scopeKey(scope))
    if (!pin) return { kind: "missing" }
    const reason = this.revoked.get(pin.policyDigest)
    return reason === undefined ? { kind: "active", pin } : { kind: "revoked", pin, reason }
  }

  /** Number of held pins; exposed for status and tests. */
  get size(): number {
    return this.pins.size
  }
}
