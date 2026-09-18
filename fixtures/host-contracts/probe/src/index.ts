/**
 * Host-conformance probe plugin.
 *
 * This is fixture code, not Warden. It observes the same host contracts Warden
 * depends on and writes JSONL evidence for the conformance runner. It also
 * registers the local OpenAI-compatible mock provider so the host can run
 * sessions with zero external API calls.
 *
 * Options:
 * - probeLog: JSONL evidence path (required for the harness)
 * - mockBaseURL: base URL of the local mock model server
 * - mockModel: model id to expose
 * - mutateToolInput: when set, rewrite matching shell commands to this value
 *   in the before hook to prove requested/effective divergence
 * - advisoryNote: when set, append one advisory system part per session
 */
import { appendFileSync } from "node:fs"
import { Model, Plugin, Provider } from "@opencode/plugin/effect"
import { Rpc } from "@opencode/plugin/rpc"
import { Effect } from "effect"

const ProbeRpc = Rpc.define({
  id: "jw-probe",
  methods: {
    status: {
      input: {
        type: "object",
        properties: { sessionID: { type: "string" } },
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          storageCounter: { type: "number" },
          mutations: { type: "number" },
        },
        required: ["ok", "storageCounter", "mutations"],
        additionalProperties: false,
      },
    },
  },
  events: {
    ping: {
      schema: {
        type: "object",
        properties: { message: { type: "string" } },
        required: ["message"],
        additionalProperties: false,
      },
    },
  },
})

export default Plugin.define({
  id: "jw-host-probe",
  effect: (ctx) =>
    Effect.gen(function* () {
      const options = ctx.options as Record<string, unknown>
      const logPath = typeof options.probeLog === "string" ? options.probeLog : null
      const mockBaseURL = typeof options.mockBaseURL === "string" ? options.mockBaseURL : null
      const mockModel = typeof options.mockModel === "string" ? options.mockModel : "mock-1"
      const mutateToolInput = typeof options.mutateToolInput === "string" ? options.mutateToolInput : null
      const advisoryNote = typeof options.advisoryNote === "string" ? options.advisoryNote : null
      const injectAdvisory = options.injectSessionAdvisory === true
      const prependPromptText = typeof options.prependPromptText === "string" ? options.prependPromptText : null
      const state = { mutations: 0, storageCounter: 0 }
      const injected = new Set<string>()

      const log = (value: Record<string, unknown>): void => {
        if (logPath === null) return
        try {
          appendFileSync(logPath, JSON.stringify({ at: Date.now(), ...value }) + "\n")
        } catch {
          // evidence loss is visible to the runner because the file stops growing
        }
      }

      const guard = (label: string, body: () => void): Effect.Effect<void> =>
        Effect.sync(() => {
          try {
            body()
          } catch (error) {
            log({ event: "probe.error", label, message: error instanceof Error ? error.message : String(error) })
          }
        })

      yield* Effect.addFinalizer(() => Effect.sync(() => log({ event: "probe.finalizer", counter: state.storageCounter })))
      log({
        event: "probe.setup",
        version: ctx.app.version,
        channel: ctx.app.channel,
        directory: ctx.location.directory,
        projectID: ctx.location.project?.id ?? null,
        options,
      })

      // Storage durability evidence: the counter must survive a location reload.
      const stored = yield* ctx.storage.get("probe/counter")
      const previous = typeof stored === "number" ? stored : 0
      state.storageCounter = previous + 1
      yield* ctx.storage.set("probe/counter", state.storageCounter)
      log({ event: "probe.storage", previous, current: state.storageCounter })

      if (mockBaseURL !== null) {
        yield* ctx.provider.transform((editor) => {
          const providerID = Provider.ID.make("jw-mock")
          editor.add({
            info: {
              ...Provider.Info.empty(providerID),
              name: "JW Mock",
              activation: "enabled",
              package: "@opencode/ai/providers/openai-compatible",
              settings: { baseURL: mockBaseURL, apiKey: "jw-mock-local-key" },
            },
            models: [
              {
                ...Model.Info.default(providerID, Model.ID.make(mockModel)),
                name: `JW Mock ${mockModel}`,
                limit: { context: 128000, output: 4096 },
              },
            ],
          })
        })
      }

      const registration = yield* ctx.rpc.register(ProbeRpc, {
        status: () =>
          Effect.sync(() => ({
            ok: true,
            storageCounter: state.storageCounter,
            mutations: state.mutations,
          })),
      }).pipe(
        Effect.catchCause(() =>
          Effect.sync(() => {
            log({ event: "probe.error", label: "rpc.register", message: "registration failed" })
            return null
          }),
        ),
      )
      if (registration !== null) {
        yield* registration.events.emit("ping", { message: "probe-ready" }).pipe(Effect.catchCause(() => Effect.void))
      }

      yield* ctx.session.hook("prompt", (event) =>
        guard("session.prompt", () => {
          const original = typeof event.prompt.text === "string" ? event.prompt.text : null
          log({
            event: "session.prompt",
            sessionID: event.sessionID,
            messageID: event.messageID,
            delivery: event.delivery,
            text: original,
            skills: event.prompt.skills ?? null,
            agents: event.prompt.agents ?? null,
            fileCount: event.prompt.files?.length ?? 0,
          })
          if (prependPromptText !== null && original !== null) {
            event.prompt.text = `${prependPromptText}${original}`
            log({
              event: "session.prompt.rewritten",
              sessionID: event.sessionID,
              messageID: event.messageID,
              before: original,
              after: event.prompt.text,
            })
          }
        }),
      )

      yield* ctx.session.hook("context", (event) =>
        guard("session.context", () => {
          log({
            event: "session.context",
            sessionID: event.sessionID,
            agent: event.agent,
            systemCount: event.system.length,
            messageCount: event.messages.length,
            toolNames: Object.keys(event.tools).sort(),
          })
          if (advisoryNote === null) return
          const key = `${event.sessionID}\u0000advisory`
          if (injected.has(key)) {
            log({ event: "probe.advisory.suppressed", sessionID: event.sessionID })
            return
          }
          injected.add(key)
          const text = injectAdvisory
            ? `[JW CONFORMANCE ADVISORY ${Date.now()}]\n${advisoryNote}`
            : `[JW ADVISORY]\n${advisoryNote}`
          event.system.push({ type: "text", text })
          log({ event: "probe.advisory.injected", sessionID: event.sessionID, text })
        }),
      )

      yield* ctx.tool.hook("execute.before", (event) =>
        guard("tool.execute.before", () => {
          log({
            event: "tool.execute.before",
            tool: event.tool,
            callID: event.id,
            sessionID: event.sessionID,
            messageID: event.messageID,
            input: event.input ?? null,
          })
          if (mutateToolInput !== null && event.tool === "shell") {
            const input = event.input as { command?: unknown } | null
            if (input !== null && typeof input === "object" && typeof input.command === "string") {
              const from = input.command
              input.command = mutateToolInput
              state.mutations += 1
              log({ event: "tool.input.mutated", callID: event.id, from, to: mutateToolInput })
            }
          }
        }),
      )

      yield* ctx.tool.hook("execute.after", (event) =>
        guard("tool.execute.after", () => {
          log({
            event: "tool.execute.after",
            tool: event.tool,
            callID: event.id,
            status: event.status,
            errorMessage:
              event.status === "error" && event.error !== null && typeof event.error === "object" && "message" in event.error
                ? String((event.error as { message: unknown }).message).slice(0, 300)
                : null,
            result: event.status === "completed" ? JSON.stringify(event.result).slice(0, 400) : null,
          })
        }),
      )

      yield* ctx.permission.hook("evaluate", (event) =>
        guard("permission.evaluate", () => {
          log({
            event: "permission.evaluate",
            sessionID: event.sessionID,
            action: event.action,
            resources: event.resources,
            effect: event.effect,
            source: event.source ?? null,
          })
        }),
      )
    }),
})
