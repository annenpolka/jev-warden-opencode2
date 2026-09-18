/**
 * Host hook registration.
 *
 * Every callback is synchronous and wrapped so that a Warden failure becomes a
 * recorded degradation instead of a host failure. Warden never mutates:
 * - the user prompt or its delivery,
 * - tool input, results or errors,
 * - a native permission effect except to strengthen it per the fixed kernel
 *   decision (deny-by-rule), never to weaken it.
 */
import { Effect, type Scope } from "effect"
import type { Plugin } from "@opencode/plugin/effect"
import {
  canonicalJson,
  composePermission,
  correlationDigest,
  parseNativeEffect,
  renderAdvisoryBlock,
  type KernelDecision,
  type NativeEffect,
} from "@jev-warden/core"
import { appendFileSync } from "node:fs"
import type { WardenRuntime } from "./runtime.ts"

export interface HookDeps {
  readonly runtime: WardenRuntime
  readonly flushSpool: () => Effect.Effect<void>
}

export function registerHooks(ctx: Plugin.Context, deps: HookDeps): Effect.Effect<void, never, Scope.Scope> {
  const { runtime } = deps
  const injectedSessions = new Set<string>()

  const guard = (label: string, body: () => void): Effect.Effect<void> =>
    Effect.sync(() => {
      try {
        body()
      } catch (error) {
        runtime.setFlag("hostCapabilitiesDegraded", true)
        probe(runtime, {
          event: "warden.error",
          label,
          message: error instanceof Error ? error.message : String(error),
        })
      }
    })

  const prompt = ctx.session.hook("prompt", (event) =>
    guard("session.prompt", () => {
      runtime.increment("promptObservations")
      runtime.bindSessionPin({ sessionId: event.sessionID })
      const text = typeof event.prompt.text === "string" ? event.prompt.text : ""
      const envelope = runtime.record({
        type: "prompt.observed",
        sessionId: event.sessionID,
        hostIds: { messageId: event.messageID },
        payloadDigest: correlationDigest(`${text}\u0000${event.delivery}`),
      })
      probe(runtime, {
        event: "session.prompt.observed",
        envelope: envelope.id,
        sequence: envelope.sequence,
        sessionID: event.sessionID,
        messageID: event.messageID,
        delivery: event.delivery,
        text,
        textDigest: correlationDigest(text),
        draftKind: "observed_prompt_draft",
      })
      // Deliberately no mutation: the user's request stays the user's request.
    }),
  )

  const context = ctx.session.hook("context", (event) =>
    guard("session.context", () => {
      runtime.increment("contextObservations")
      const envelope = runtime.record({
        type: "context.observed",
        sessionId: event.sessionID,
        agentId: event.agent,
        payloadDigest: correlationDigest(`system:${event.system.length};messages:${event.messages.length}`),
      })
      probe(runtime, {
        event: "session.context.observed",
        envelope: envelope.id,
        sequence: envelope.sequence,
        sessionID: event.sessionID,
        agent: event.agent,
        systemCount: event.system.length,
        messageCount: event.messages.length,
        toolNames: Object.keys(event.tools).sort(),
      })

      const note = runtime.options.advisoryNote
      if (note === null) return
      const key = `${event.sessionID}\u0000${correlationDigest(note)}`
      if (injectedSessions.has(key)) {
        runtime.increment("guidanceSuppressedByDedup")
        probe(runtime, { event: "guidance.suppressed", sessionID: event.sessionID, reason: "already_delivered" })
        return
      }
      const block = renderAdvisoryBlock(
        { title: "", items: [{ findingId: "operator-note", text: note, sourceRefs: [] }] },
        1,
      )
      if (block === null) return
      injectedSessions.add(key)
      event.system.push({ type: "text", text: block })
      runtime.increment("guidanceDelivered")
      runtime.record({
        type: "guidance.delivered",
        sessionId: event.sessionID,
        agentId: event.agent,
        payloadDigest: correlationDigest(block),
      })
      probe(runtime, {
        event: "guidance.delivered",
        sessionID: event.sessionID,
        channel: "context",
        blockDigest: correlationDigest(block),
      })
    }),
  )

  const title = ctx.session.hook("title", (event) =>
    guard("session.title", () => {
      runtime.record({ type: "auxiliary.title", sessionId: event.sessionID, origin: "warden" })
    }),
  )

  const generate = ctx.session.hook("generate", (event) =>
    guard("session.generate", () => {
      runtime.record({ type: "auxiliary.generate", sessionId: event.sessionID, origin: "warden" })
    }),
  )

  const toolBefore = ctx.tool.hook("execute.before", (event) =>
    guard("tool.execute.before", () => {
      runtime.increment("toolBeforeObservations")
      const digest = correlationDigest(canonicalJson(event.input ?? null))
      runtime.rememberToolCall(event.id, {
        tool: event.tool,
        sessionID: event.sessionID,
        agentID: event.agent,
        messageID: event.messageID,
        beforeDigest: digest,
        observedAt: Date.now(),
      })
      const envelope = runtime.record({
        type: "tool.requested",
        sessionId: event.sessionID,
        agentId: event.agent,
        hostIds: { toolCallId: event.id, messageId: event.messageID },
        payloadDigest: digest,
      })
      probe(runtime, {
        event: "tool.execute.before",
        envelope: envelope.id,
        sequence: envelope.sequence,
        tool: event.tool,
        callID: event.id,
        sessionID: event.sessionID,
        messageID: event.messageID,
        requestedInputDigest: digest,
        note: "before_permission_and_dispatch",
      })
    }),
  )

  const toolAfter = ctx.tool.hook("execute.after", (event) =>
    guard("tool.execute.after", () => {
      runtime.increment("toolAfterObservations")
      const pending = runtime.takeToolCall(event.id)
      const afterDigest = correlationDigest(canonicalJson(event.input ?? null))
      const inputMatchesBefore = pending === undefined ? null : pending.beforeDigest === afterDigest
      const status = event.status === "completed" ? "completed" : "error"
      let errorMessage: string | null = null
      if (event.status === "error") errorMessage = safeErrorMessage(event.error)
      const envelope = runtime.record({
        type: status === "completed" ? "tool.completed" : "tool.error",
        sessionId: event.sessionID,
        agentId: event.agent,
        hostIds: { toolCallId: event.id, messageId: event.messageID },
        payloadDigest: afterDigest,
      })
      probe(runtime, {
        event: "tool.execute.after",
        envelope: envelope.id,
        sequence: envelope.sequence,
        tool: event.tool,
        callID: event.id,
        status,
        inputMatchesBefore,
        errorMessage,
      })
      // The host result/error is returned exactly as received.
    }),
  )

  const permission = ctx.permission.hook("evaluate", (event) =>
    guard("permission.evaluate", () => {
      const observed: NativeEffect = parseNativeEffect(event.effect)
      runtime.increment("permissionEvaluations")
      runtime.setLastPermissionEffect(observed)
      const decision = kernelDecision(runtime, event.action)
      const composed = composePermission(observed, decision)
      if (composed !== observed) event.effect = composed
      const envelope = runtime.record({
        type: "permission.evaluated",
        sessionId: event.sessionID,
        ...(event.agent === undefined ? {} : { agentId: event.agent }),
        hostIds:
          event.source?.type === "tool"
            ? { toolCallId: event.source.id, messageId: event.source.messageID }
            : {},
        payloadDigest: correlationDigest(`${event.action}\u0000${observed}\u0000${composed}`),
      })
      probe(runtime, {
        event: "permission.evaluate",
        envelope: envelope.id,
        sequence: envelope.sequence,
        sessionID: event.sessionID,
        action: event.action,
        resources: event.resources,
        observed,
        composed,
        changed: composed !== observed,
      })
    }),
  )

  const flush = deps.flushSpool

  return Effect.gen(function* () {
    yield* prompt
    yield* context
    yield* title
    yield* generate
    yield* toolBefore
    yield* toolAfter
    yield* permission
    yield* flush()
  })
}

function kernelDecision(runtime: WardenRuntime, action: string): KernelDecision {
  return runtime.options.denyActions.includes(action)
    ? { kind: "deny_by_rule", ruleId: `deny-actions:${action}` }
    : { kind: "abstain" }
}

function safeErrorMessage(error: unknown): string | null {
  if (error === null || error === undefined) return null
  if (typeof error === "string") return error.slice(0, 500)
  if (typeof error === "object" && "message" in error && typeof (error as { message: unknown }).message === "string") {
    return (error as { message: string }).message.slice(0, 500)
  }
  return "tool_error_unreadable"
}

/** JSONL evidence writer used only when the operator sets options.probeLog. */
export function probe(runtime: WardenRuntime, value: Record<string, unknown>): void {
  const path = runtime.options.probeLog
  if (path === null) return
  try {
    appendFileSync(path, JSON.stringify({ at: Date.now(), ...value }) + "\n")
  } catch {
    runtime.setFlag("durabilityDegraded", true)
  }
}
