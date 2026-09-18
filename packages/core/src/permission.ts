/**
 * Permission composition (Warden-local contract).
 *
 * The host type allows a hook to lower an effect (allow -> ask -> deny is not
 * ordered by strength; any change is possible). Warden's own contract is
 * stricter: Warden never weakens what it observed.
 *
 * Rules:
 * - deny stays deny.
 * - ask stays ask, or becomes deny when a fixed rule requires it.
 * - allow stays allow, or becomes ask/deny when a fixed rule requires it.
 * - An unknown incoming value is never converted into an allowance.
 *
 * A model confidence is never an argument to this function.
 */
import { nonBlank } from "./ids.ts"

export type NativeEffect = "allow" | "ask" | "deny"

export type KernelDecision =
  | { readonly kind: "abstain" }
  | { readonly kind: "ask_permission"; readonly ruleId: string }
  | { readonly kind: "deny_by_rule"; readonly ruleId: string }

export function abstain(): KernelDecision {
  return { kind: "abstain" }
}

export function parseNativeEffect(value: unknown): NativeEffect {
  if (value !== "allow" && value !== "ask" && value !== "deny") {
    throw new TypeError("Unknown native permission effect")
  }
  return value
}

/** Ranks effects by restrictiveness for audit purposes only. */
export function effectRank(effect: NativeEffect): 0 | 1 | 2 {
  switch (effect) {
    case "allow":
      return 0
    case "ask":
      return 1
    case "deny":
      return 2
  }
}

export function isWeakerThan(candidate: NativeEffect, observed: NativeEffect): boolean {
  return effectRank(candidate) < effectRank(observed)
}

export function composePermission(native: NativeEffect, decision: KernelDecision): NativeEffect {
  const observed = parseNativeEffect(native)
  if (decision.kind === "abstain") return observed
  if (decision.kind !== "ask_permission" && decision.kind !== "deny_by_rule") {
    throw new TypeError("Unknown kernel decision")
  }
  nonBlank(decision.ruleId, "ruleId")
  if (observed === "deny" || decision.kind === "deny_by_rule") return "deny"
  return "ask"
}

export type NonWeakeningViolation = {
  readonly observed: NativeEffect
  readonly proposed: NativeEffect
  readonly ruleId: string
}

export function findNonWeakeningViolation(
  observed: NativeEffect,
  proposed: NativeEffect,
): NonWeakeningViolation | undefined {
  parseNativeEffect(observed)
  parseNativeEffect(proposed)
  if (isWeakerThan(proposed, observed)) return { observed, proposed, ruleId: "non-weakening" }
  return undefined
}
