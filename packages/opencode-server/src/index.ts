/**
 * Jev Warden server plugin (OpenCode 2 / Effect API).
 *
 * Phase 0 scope: observe prompts, context, tool terminals and permission
 * effects; persist a bounded spool; expose a read-only status RPC. No Jev
 * call, no Lab send, no prompt rewrite, no permission weakening, no learning
 * job runs from this plugin.
 */
import { Plugin } from "@opencode/plugin/effect"
import { Effect, Schedule, Stream } from "effect"
import { appendFileSync, mkdirSync } from "node:fs"
import { dirname, isAbsolute, join } from "node:path"
import { WardenRpc } from "@jev-warden/contracts"
import { assertStatusSafe, correlationDigest } from "@jev-warden/core"
import { createLiveJev, macOsKeychainReader } from "./jev-live.ts"
import { parseOptions } from "./options.ts"
import { registerHooks, probe } from "./hooks.ts"
import { requestReview, ReviewLedger, type ReviewInput } from "./review.ts"
import { resolveOutboxPath } from "./outbox.ts"
import { createPolicyLoader, BASELINE_LOADED } from "./policy-source.ts"
import { PLUGIN_ID, PLUGIN_VERSION, SPOOL_LIMIT, STORAGE_KEY, WardenRuntime } from "./runtime.ts"

function toJsonValue(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value))
}

const plugin = Plugin.define({
  id: PLUGIN_ID,
  effect: (ctx) =>
    Effect.gen(function* () {
      const parsed = parseOptions(ctx.options)
      const projectId = ctx.location?.project?.id ?? "unknown-project"
      const canonical = ctx.location?.project?.canonical ?? ctx.location?.directory ?? "unknown-location"
      const worktreeId = `wt_${correlationDigest(canonical).slice(-16)}`
      const runtime = new WardenRuntime({
        options: parsed.options,
        optionErrors: parsed.errors,
        locationDirectory: ctx.location?.directory ?? "unknown-location",
        projectId,
        worktreeId,
      })
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          probe(runtime, { event: "plugin.finalizer", sequence: runtime.currentSequence, epoch: runtime.serverEpoch })
          runtime.dispose()
        }),
      )
      probe(runtime, {
        event: "plugin.setup",
        pluginId: PLUGIN_ID,
        pluginVersion: PLUGIN_VERSION,
        hostVersion: ctx.app.version,
        hostChannel: ctx.app.channel,
        directory: ctx.location?.directory ?? null,
        projectId,
        optionErrors: parsed.errors,
        epoch: runtime.serverEpoch,
      })

      // Outbox path resolution: relative paths belong to the location, not to
      // whatever working directory the server process happens to have. Writing
      // inside the location can feed the config watcher and cause reload loops,
      // so it is refused unless the operator explicitly opts in.
      const locationDirectory = ctx.location?.directory ?? "unknown-location"
      const resolvedOutbox = resolveOutboxPath(
        locationDirectory,
        parsed.options.outboxPath,
        parsed.options.allowOutboxInLocation,
      )
      const outboxPath = resolvedOutbox.path
      let lastOutboxSequence = 0
      if (resolvedOutbox.skippedInsideLocation) {
        runtime.setFlag("durabilityDegraded", true)
        probe(runtime, { event: "outbox.skipped_inside_location", path: resolvedOutbox.requested })
      }
      if (outboxPath !== null) {
        try {
          mkdirSync(dirname(outboxPath), { recursive: true })
        } catch {
          runtime.markDurabilityDegraded()
        }
        probe(runtime, { event: "outbox.configured", path: outboxPath })
      }

      const policyLoader =
        parsed.options.policyPath === null
          ? undefined
          : createPolicyLoader(
              isAbsolute(parsed.options.policyPath)
                ? parsed.options.policyPath
                : join(locationDirectory, parsed.options.policyPath),
            )
      if (policyLoader !== undefined) {
        probe(runtime, { event: "policy.configured", path: parsed.options.policyPath, status: policyLoader.describe() })
      }

      const flushSpool = (): Effect.Effect<void> =>
        Effect.gen(function* () {          const snapshot = runtime.spoolSnapshot.slice(-SPOOL_LIMIT)
          if (snapshot.length === 0) return
          yield* ctx.storage
            .set(STORAGE_KEY, {
              version: 1,
              updatedAt: Date.now(),
              events: toJsonValue(snapshot) as never,
            })
            .pipe(
              Effect.catchDefect(() =>
                Effect.sync(() => {
                  runtime.markDurabilityDegraded()
                  probe(runtime, { event: "spool.flush_failed" })
                }),
              ),
            )
          runtime.setCounter("spooledEvents", snapshot.length)
          // Durable outbox for the Lab. At-least-once: on restart the spool is
          // re-sent from the beginning and the Lab dedups by envelope id.
          if (outboxPath !== null) {
            const fresh = snapshot.filter((envelope) => envelope.sequence > lastOutboxSequence)
            if (fresh.length > 0) {
              try {
                appendFileSync(outboxPath, fresh.map((envelope) => JSON.stringify(envelope)).join("\n") + "\n")
                const last = fresh[fresh.length - 1]
                if (last !== undefined) lastOutboxSequence = last.sequence
              } catch {
                runtime.markDurabilityDegraded()
                probe(runtime, { event: "outbox.append_failed" })
              }
            }
          }
        })

      // Restore the previous spool count (not the content) so status is honest
      // about durability across reloads.
      const previous = yield* ctx.storage.get(STORAGE_KEY)
      if (previous !== undefined && previous !== null) {
        probe(runtime, { event: "spool.restored", hasPrevious: true })
      }

      yield* registerHooks(ctx, {
        runtime,
        flushSpool,
        ...(parsed.options.policyPath === null
          ? {}
          : {
              loadPolicy: () => {
                const loader = policyLoader
                return loader === undefined ? { ...BASELINE_LOADED, error: "policy_loader_missing" } : loader.load()
              },
            }),
      })

      // Live Jev is opt-in and only reachable through the explicit review RPC.
      const reviewLedger = new ReviewLedger()
      const transport = parsed.options.jev.enabled
        ? createLiveJev({
            endpoint: parsed.options.jev.endpoint,
            model: parsed.options.jev.model,
            timeoutMs: parsed.options.jev.timeoutMs,
            maxRequests: parsed.options.jev.maxRequests,
            maxStateBytes: 64 * 1024,
            keyReader: macOsKeychainReader(),
          })
        : null

      // RPC registration failure degrades the adapter instead of breaking the
      // host. The typed error channel is absorbed here and reported in status.
      const registration = yield* ctx.rpc.register(WardenRpc, {
        status: () =>
          Effect.sync(() => {
            const status = runtime.status()
            assertStatusSafe(status)
            return { text: runtime.statusLine(), status: toJsonValue(status) as Record<string, unknown> }
          }),
        "snapshot.get": () =>
          Effect.sync(() => ({
            cutSequence: runtime.currentSequence,
            itemCount: runtime.spoolSnapshot.length,
            debug: toJsonValue({
              ...runtime.debugSummary(),
              reviewItems: reviewLedger.size,
              policySource: policyLoader?.describe() ?? { source: "baseline" },
            }) as Record<string, unknown>,
          })),
        "review.request": (input) =>
          Effect.promise(async () => {
            try {
              return await requestReview({ runtime, transport, ledger: reviewLedger }, input as ReviewInput)
            } catch {
              runtime.increment("jevRejected")
              return { status: "unavailable" as const, requestDigest: "", error: "handler_error" }
            }
          }),
        "review.list": (input) =>
          Effect.sync(() => {
            const record = input as { sessionID?: string; limit?: number }
            return {
              items: toJsonValue(
                reviewLedger.list(record.sessionID, typeof record.limit === "number" ? record.limit : 32),
              ) as Record<string, unknown>[],
            }
          }),
      }).pipe(
        Effect.catchCause(() =>
          Effect.sync(() => {
            runtime.setFlag("hostCapabilitiesDegraded", true)
            probe(runtime, { event: "rpc.register_failed" })
            return null
          }),
        ),
      )

      if (registration !== null) {
        runtime.setChangedEmitter((reason) => {
          try {
            void Effect.runPromise(
              registration.events.emit("changed", { sequence: runtime.currentSequence, reason }).pipe(
                Effect.catchCause(() => Effect.void),
              ),
            )
          } catch {
            runtime.setFlag("hostCapabilitiesDegraded", true)
          }
        })
      } else {
        runtime.setFlag("hostCapabilitiesDegraded", true)
      }

      // Public event stream: a notification source only. Missing events are
      // expected; durable state comes from the spool and the Lab.
      yield* ctx.event.subscribe().pipe(
        Stream.runForEach((event) =>
          Effect.sync(() => {
            try {
              const type = typeof event?.type === "string" ? event.type : "unknown"
              runtime.noteEventType(type)
            } catch {
              runtime.setFlag("hostCapabilitiesDegraded", true)
            }
          }),
        ),
        Effect.catchCause(() =>
          Effect.sync(() => {
            runtime.setFlag("durabilityDegraded", true)
            probe(runtime, { event: "event_stream.ended" })
          }),
        ),
        Effect.forkScoped,
      )

      yield* flushSpool().pipe(Effect.repeat(Schedule.spaced("3 seconds")), Effect.forkScoped)
    }),
})

export default plugin
export { parseOptions } from "./options.ts"
export type { WardenOptions } from "./options.ts"
