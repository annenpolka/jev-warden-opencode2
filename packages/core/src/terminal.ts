/**
 * Operation terminals.
 *
 * The host has two distinct endpoints for a tool call: an after hook with a
 * completed/error union, and the absence of any after hook. A missing after
 * never means "did not run": cancellation, host crash and capture gaps all
 * end in `outcome_unknown` until the host state is reconciled.
 *
 * `execute.before` runs before permission evaluation (verified on OpenCode
 * 2.0.7). Observing a requested call therefore never proves authorization or
 * dispatch.
 */
import { assertNever, isNonBlank } from "./ids.ts"

export type TerminalSignal =
  | { readonly kind: "tool_completed" }
  | { readonly kind: "tool_error" }
  | { readonly kind: "denied_before_dispatch" }
  | { readonly kind: "interrupted" }
  | { readonly kind: "missing_result" }

export type OperationOutcome =
  | "observed_completed"
  | "observed_error"
  | "denied_before_dispatch"
  | "outcome_unknown"

export function operationOutcome(signal: TerminalSignal): OperationOutcome {
  switch (signal.kind) {
    case "tool_completed":
      return "observed_completed"
    case "tool_error":
      return "observed_error"
    case "denied_before_dispatch":
      return "denied_before_dispatch"
    case "interrupted":
    case "missing_result":
      return "outcome_unknown"
    default:
      return assertNever(signal, "terminal signal")
  }
}

export interface ToolAfterPayload {
  readonly status: "completed" | "error"
  readonly errorMessage?: string
}

/**
 * Host error text that indicates the call was not dispatched because the tool
 * was filtered out by an authorization decision. This is a recognizer for a
 * tested host string, used only to raise an advisory flag. It is not proof:
 * the same shape could come from another plugin or an unavailable tool.
 */
const TOOL_UNAVAILABLE_PATTERN = /No tool named .* is currently available/i

export function looksLikeUndispatchedToolError(payload: ToolAfterPayload): boolean {
  return payload.status === "error" && isNonBlank(payload.errorMessage) &&
    TOOL_UNAVAILABLE_PATTERN.test(payload.errorMessage)
}

export function toolAfterOutcome(payload: ToolAfterPayload): OperationOutcome {
  return payload.status === "completed" ? "observed_completed" : "observed_error"
}
