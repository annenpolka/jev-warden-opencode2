#!/usr/bin/env node
/**
 * Host-conformance runner for OpenCode 2.
 *
 * Starts the installed OpenCode server against a scratch project, loads the
 * fixture probe plugin (and optionally the Warden server plugin), points the
 * model at a local OpenAI-compatible mock, and drives real sessions.
 *
 * Zero external network and zero provider cost: the only model endpoint is
 * 127.0.0.1. Results are written as a machine-readable JSON file; every case
 * cites the raw JSONL evidence it was derived from.
 *
 * Usage:
 *   node fixtures/host-contracts/run-host-conformance.mjs --out checks/host-conformance.json
 */
import { spawn } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, "../..")
const probePath = join(here, "probe")
const wardenPath = join(repoRoot, "packages/opencode-server")
const mockServerPath = join(here, "mock-model-server.mjs")

const args = parseArgs(process.argv.slice(2))
const outPath = args.out ? resolve(process.cwd(), args.out) : join(repoRoot, "checks/host-conformance.json")
const keepScratch = args.keep === "true"
const filter = args.filter ?? null

const cases = []
const startedAt = Date.now()
let cliVersion = null
let serverVersion = null

function parseArgs(argv) {
  const result = {}
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith("--")) continue
    const key = token.slice(2)
    const next = argv[index + 1]
    if (next !== undefined && !next.startsWith("--")) {
      result[key] = next
      index += 1
    } else {
      result[key] = "true"
    }
  }
  return result
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
}

function freePort() {
  return new Promise((resolvePromise, reject) => {
    const server = createServer()
    server.unref()
    server.on("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      const port = typeof address === "object" && address !== null ? address.port : 0
      server.close(() => resolvePromise(port))
    })
  })
}

function readJsonl(path) {
  if (!existsSync(path)) return []
  const lines = readFileSync(path, "utf8").split("\n").filter((line) => line.trim().length > 0)
  const values = []
  for (const line of lines) {
    try {
      values.push(JSON.parse(line))
    } catch {
      // keep the line visible as a raw marker
      values.push({ event: "unparsed", raw: line.slice(0, 200) })
    }
  }
  return values
}

function record(id, area, requirement, status, detail, evidenceRefs) {
  cases.push({
    id,
    area,
    requirement,
    status,
    ...(detail === undefined ? {} : { detail }),
    evidenceRefs: evidenceRefs ?? [],
    observedAt: Date.now(),
  })
  const marker = status === "PASSED" ? "PASS" : status
  process.stderr.write(`  [${marker}] ${id} ${detail ?? ""}\n`)
}

async function runCase(id, area, requirement, body) {
  if (filter !== null && !id.includes(filter)) return
  try {
    const result = await body()
    record(id, area, requirement, result.status, result.detail, result.evidenceRefs)
  } catch (error) {
    record(id, area, requirement, "FAILED", error instanceof Error ? error.message : String(error), error?.evidenceRefs)
  }
}

function assert(condition, message) {
  if (!condition) {
    const error = new Error(message)
    error.evidenceRefs = []
    throw error
  }
}

class MockModel {
  constructor(scriptPath, logPath) {
    this.scriptPath = scriptPath
    this.logPath = logPath
    this.proc = null
    this.port = null
  }

  async start(script) {
    writeFileSync(this.scriptPath, JSON.stringify(script, null, 2))
    this.port = await freePort()
    this.proc = spawn(process.execPath, [mockServerPath, String(this.port), this.scriptPath, this.logPath], {
      stdio: ["ignore", "pipe", "pipe"],
    })
    await waitFor(async () => {
      try {
        const response = await fetch(`http://127.0.0.1:${this.port}/__state`)
        return response.ok
      } catch {
        return false
      }
    }, 10_000, 50, "mock model server did not start")
    return this
  }

  get baseURL() {
    return `http://127.0.0.1:${this.port}/v1`
  }

  events() {
    return readJsonl(this.logPath)
  }

  async stop() {
    this.proc?.kill("SIGTERM")
    await sleep(150)
    if (this.proc !== null && this.proc.exitCode === null) this.proc.kill("SIGKILL")
  }
}

class Host {
  constructor(scratch) {
    this.scratch = scratch
    this.proc = null
    this.port = null
    this.password = null
    this.sessions = []
  }

  async start() {
    this.port = await freePort()
    this.proc = spawn("opencode", ["serve", "--port", String(this.port)], {
      cwd: this.scratch,
      env: { ...process.env, OPENCODE_DISABLE_AUTOUPDATE: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    this.proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString()
    })
    this.proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString()
    })
    await waitFor(() => stdout.includes("server listening") && /server password \S+/.test(stdout), 30_000, 100,
      `opencode serve did not start: ${stdout} ${stderr}`)
    const password = stdout.match(/server password (\S+)/)?.[1]
    this.password = password ?? null
    return this
  }

  get base() {
    return `http://127.0.0.1:${this.port}`
  }

  async api(path, options = {}) {
    const headers = { ...(options.headers ?? {}) }
    if (this.password !== null) {
      headers.authorization = `Basic ${Buffer.from(`opencode:${this.password}`).toString("base64")}`
    }
    if (options.body !== undefined) headers["content-type"] = "application/json"
    const response = await fetch(`${this.base}${path}`, {
      method: options.method ?? "GET",
      headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    })
    const text = await response.text()
    let parsed = null
    try {
      parsed = text.length === 0 ? null : JSON.parse(text)
    } catch {
      parsed = { raw: text.slice(0, 400) }
    }
    if (!response.ok && options.allowFailure !== true) {
      const error = new Error(`${options.method ?? "GET"} ${path} -> ${response.status}: ${text.slice(0, 300)}`)
      error.status = response.status
      error.body = parsed
      throw error
    }
    return { status: response.status, body: parsed }
  }

  async reload() {
    await this.api("/api/location/reload", { method: "POST" })
  }

  async plugins() {
    const response = await this.api("/api/plugin")
    return response.body?.data ?? []
  }

  async findPlugin(id) {
    return (await this.plugins()).find((entry) => entry.id === id) ?? null
  }

  async createSession(title) {
    const response = await this.api("/api/session", {
      method: "POST",
      body: { model: { providerID: "jw-mock", id: "mock-1" }, title },
    })
    const sessionID = response.body?.data?.id
    assert(typeof sessionID === "string", "session create did not return an id")
    this.sessions.push(sessionID)
    return sessionID
  }

  async prompt(sessionID, text) {
    await this.api(`/api/session/${sessionID}/prompt`, { method: "POST", body: { text } })
  }

  async sessionContext(sessionID) {
    const response = await this.api(`/api/session/${sessionID}/context`)
    return response.body?.data ?? response.body
  }

  async waitIdle(sessionID, timeoutMs = 20_000) {
    await waitFor(async () => {
      try {
        const response = await this.api(`/api/session/${sessionID}`)
        const data = response.body?.data
        return data?.time?.idle !== undefined || data?.outcome !== undefined
      } catch {
        return false
      }
    }, timeoutMs, 250, `session ${sessionID} did not become idle`)
  }

  async pendingPermissions(sessionID) {
    const response = await this.api(`/api/permission/request?sessionID=${encodeURIComponent(sessionID)}`)
    return response.body?.data ?? []
  }

  async replyPermission(sessionID, requestID, decision) {
    await this.api(`/api/session/${sessionID}/permission/${requestID}/reply`, {
      method: "POST",
      body: { decision },
    })
  }

  async cleanupSessions() {
    for (const sessionID of this.sessions) {
      try {
        await this.api(`/api/session/${sessionID}`, { method: "DELETE", allowFailure: true })
      } catch {
        // best effort
      }
    }
  }

  async stop() {
    await this.cleanupSessions()
    this.proc?.kill("SIGTERM")
    await sleep(200)
    if (this.proc !== null && this.proc.exitCode === null) this.proc.kill("SIGKILL")
  }
}

async function waitFor(check, timeoutMs, intervalMs, message) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (await check()) return
    if (Date.now() > deadline) throw new Error(message)
    await sleep(intervalMs)
  }
}

/** Runs one isolated scenario: scratch dir, mock model, host, plugin config. */
async function withHost(options, body) {
  const scratch = mkdtempSync(join(tmpdir(), "jw-conformance-"))
  const probeLog = join(scratch, "probe.jsonl")
  const wardenLog = join(scratch, "warden.jsonl")
  const mockLog = join(scratch, "mock.jsonl")
  const mockScript = join(scratch, "mock-script.json")
  const plugins = []
  if (options.probe !== undefined) {
    plugins.push({
      package: probePath,
      options: { probeLog, mockBaseURL: null, ...options.probe },
    })
  }
  if (options.warden !== undefined) {
    plugins.push({
      package: wardenPath,
      options: { probeLog: wardenLog, ...options.warden },
    })
  }
  const config = {
    $schema: "https://opencode.ai/config.json",
    ...(options.permissions === undefined ? {} : { permissions: options.permissions }),
    plugins,
  }
  writeFileSync(join(scratch, "opencode.json"), JSON.stringify(config, null, 2))

  const mock = await new MockModel(mockScript, mockLog).start(options.script ?? [])
  // The mock provider is registered by the probe, so the probe needs the mock URL.
  if (options.probe !== undefined) {
    const index = plugins.findIndex((entry) => entry.package === probePath)
    plugins[index].options = { ...plugins[index].options, mockBaseURL: mock.baseURL, probeLog }
    writeFileSync(join(scratch, "opencode.json"), JSON.stringify(config, null, 2))
  }

  const host = await new Host(scratch).start()
  try {
    // Wait for the location to boot before reloading: a reload that arrives
    // during boot is not queued.
    await waitFor(async () => {
      try {
        const response = await host.api("/api/location")
        const directory = response.body?.directory
        return typeof directory === "string" && directory === realpathSync(scratch)
      } catch {
        return false
      }
    }, 30_000, 250, "location did not boot")
    try {
      const info = await host.api("/api/info")
      if (typeof info.body?.version === "string") serverVersion = info.body.version
    } catch {
      // version capture is best effort
    }
    if (plugins.length > 0) {
      let lastReload = 0
      let attempts = 0
      await waitFor(async () => {
        attempts += 1
        if (Date.now() - lastReload > 3_000) {
          lastReload = Date.now()
          await host.reload()
        }
        const expected = []
        if (options.probe !== undefined) expected.push("jw-host-probe")
        if (options.warden !== undefined) expected.push("jev-warden")
        const active = await Promise.all(expected.map((id) => host.findPlugin(id)))
        if (active.every((plugin) => plugin?.state?.status === "active")) return true
        if (attempts > 20) {
          const states = await Promise.all(
            active.map(async (plugin, index) =>
              plugin === null
                ? `${expected[index]}=missing`
                : `${expected[index]}=${plugin.state?.status}${plugin.state?.error ? `:${String(plugin.state.error).slice(0, 300)}` : ""}`,
            ),
          )
          throw new Error(`plugins not active: ${states.join(", ")}`)
        }
        return false
      }, 30_000, 500, "plugins did not activate")
    }
    return await body({
      scratch,
      host,
      mock,
      probeLog,
      wardenLog,
      mockLog,
      probeEvents: () => readJsonl(probeLog),
      wardenEvents: () => readJsonl(wardenLog),
      pluginState: async (id) => host.findPlugin(id),
      artifacts: { config: join(scratch, "opencode.json"), probeLog, wardenLog, mockLog },
    })
  } finally {
    await host.stop()
    await mock.stop()
    if (!keepScratch) rmSync(scratch, { recursive: true, force: true })
  }
}

const SHELL_TOOL_SCRIPT = (command, finalText) => [
  { kind: "tool", tool: "shell", arguments: { command } },
  { kind: "text", text: finalText },
]

async function main() {
  const rawVersion = await new Promise((resolvePromise) => {
    const proc = spawn("opencode", ["--version"])
    let out = ""
    proc.stdout.on("data", (chunk) => {
      out += chunk.toString()
    })
    proc.on("close", () => resolvePromise(out.trim()))
  })
  cliVersion = rawVersion.replace(/^opencode\s+v?/i, "").trim() || null
  process.stderr.write(`conformance run against opencode ${cliVersion ?? "unknown"}\n`)

  // ---------------------------------------------------------------- activation
  await runCase("OC2-001", "host", "初回loadとcleanup: 登録を解除し、元のhost処理を維持する", async () => {
    const result = await withHost({ probe: {} }, async (env) => {
      const setup1 = env.probeEvents().filter((entry) => entry.event === "probe.setup")
      assert(setup1.length >= 1, "probe.setup was not observed")
      const version = setup1[0].version
      await env.host.reload()
      await waitFor(async () => (await env.pluginState("jw-host-probe"))?.state?.status === "active", 20_000, 250,
        "probe did not reactivate after reload")
      const events = env.probeEvents()
      assert(events.some((entry) => entry.event === "probe.finalizer"), "probe.finalizer was not observed on reload")
      assert(events.filter((entry) => entry.event === "probe.setup").length >= 2, "probe did not load again after cleanup")
      const active = await env.pluginState("jw-host-probe")
      return {
        status: "PASSED",
        detail: `load+cleanup+reload on opencode ${version}; plugin state ${active?.state?.status}`,
        evidenceRefs: [env.artifacts.probeLog, env.artifacts.config],
      }
    })
    return result
  })

  // ----------------------------------------------------------- prompt and context
  const advisoryMarker = `JW-WARDEN-ADVISORY-${startedAt}`
  await runCase("OC2-007", "context", "履歴readback: 一時guidanceがcanonical user意思へ変わらない", async () => {
    const result = await withHost(
      {
        probe: {},
        warden: { advisoryNote: advisoryMarker },
        script: [{ kind: "text", text: "ack" }],
      },
      async (env) => {
        const sessionID = await env.host.createSession("oc2-007")
        await env.host.prompt(sessionID, "Conformance context check.")
        await env.host.waitIdle(sessionID)
        await sleep(500)
        const mockEvents = env.mock.events()
        assert(mockEvents.length >= 1, "mock model was not called")
        const firstRequest = JSON.stringify(mockEvents[0].body)
        assert(firstRequest.includes(advisoryMarker), "advisory note was not present in the outgoing model request")
        const readback = JSON.stringify(await env.host.sessionContext(sessionID))
        assert(!readback.includes(advisoryMarker), "advisory note leaked into persisted session context")
        const wardenEvents = env.wardenEvents()
        assert(
          wardenEvents.some((entry) => entry.event === "guidance.delivered" && entry.channel === "context"),
          "warden did not record context guidance delivery",
        )
        return {
          status: "PASSED",
          detail: "temporary system guidance reached the model call and was absent from session readback",
          evidenceRefs: [env.artifacts.mockLog, env.artifacts.wardenLog],
        }
      },
    )
    return result
  })

  // -------------------------------------------------------------- prompt draft
  await runCase("OC2-004", "prompt", "先行pluginがdraftを書換え: 観測draftを原文と偽らない", async () => {
    const result = await withHost(
      {
        probe: { prependPromptText: "[PREFIX] " },
        warden: {},
        script: [{ kind: "text", text: "ack" }],
      },
      async (env) => {
        const sessionID = await env.host.createSession("oc2-004")
        await env.host.prompt(sessionID, "Draft rewrite check.")
        await env.host.waitIdle(sessionID)
        await sleep(500)
        const probeEvents = env.probeEvents()
        const original = probeEvents.find((entry) => entry.event === "session.prompt")
        const rewritten = probeEvents.find((entry) => entry.event === "session.prompt.rewritten")
        assert(original?.text === "Draft rewrite check.", "probe did not observe the original text")
        assert(rewritten?.after === "[PREFIX] Draft rewrite check.", "probe did not rewrite the draft")
        const wardenObserved = env.wardenEvents().find((entry) => entry.event === "session.prompt.observed")
        assert(wardenObserved !== undefined, "warden did not observe the prompt")
        const sawRewritten = wardenObserved.text === "[PREFIX] Draft rewrite check."
        const sawOriginal = wardenObserved.text === "Draft rewrite check."
        assert(sawRewritten || sawOriginal, "warden observed an unexpected prompt text")
        const active = await env.pluginState("jev-warden")
        return {
          status: "PASSED",
          detail: sawRewritten
            ? "hook order honoured config order: warden recorded the rewritten draft (observed_prompt_draft)"
            : "warden ran before the rewriting plugin and recorded only its own observed draft",
          evidenceRefs: [env.artifacts.probeLog, env.artifacts.wardenLog],
        }
      },
    )
    return result
  })

  // --------------------------------------------------------------- tool ordering
  const toolOutput = "jw-probe-tool-ran"
  await runCase("OC2-017", "permission", "permissionとexecute.before順序: 認可と実行対象の相違を検出する", async () => {
    const result = await withHost(
      { probe: {}, warden: {}, script: SHELL_TOOL_SCRIPT(`echo ${toolOutput}`, "done") },
      async (env) => {
        const sessionID = await env.host.createSession("oc2-017")
        await env.host.prompt(sessionID, "Run the shell tool.")
        await env.host.waitIdle(sessionID)
        await sleep(500)
        const events = env.probeEvents()
        const beforeIndex = events.findIndex((entry) => entry.event === "tool.execute.before")
        const permissionIndex = events.findIndex((entry) => entry.event === "permission.evaluate")
        assert(beforeIndex >= 0, "execute.before was not observed")
        assert(permissionIndex >= 0, "permission.evaluate was not observed for an allow decision")
        assert(beforeIndex < permissionIndex, `execute.before must be observed before permission evaluation (got ${beforeIndex} vs ${permissionIndex})`)
        const permission = events[permissionIndex]
        assert(permission.effect === "allow", `expected allow, got ${permission.effect}`)
        return {
          status: "PASSED",
          detail: "on the tested host, execute.before ran before permission.evaluate; before is a request observation, not an authorization",
          evidenceRefs: [env.artifacts.probeLog],
        }
      },
    )
    return result
  })

  await runCase("OC2-009", "tool", "成功した実toolとWarden障害: tool成功をWardenエラーへ変えない", async () => {
    const result = await withHost(
      {
        probe: {},
        // A deliberately unwritable probe log makes Warden's own recording fail.
        warden: { probeLog: "/nonexistent-jw-warden-dir/warden.jsonl" },
        script: SHELL_TOOL_SCRIPT(`echo ${toolOutput}`, "done"),
      },
      async (env) => {
        const sessionID = await env.host.createSession("oc2-009")
        await env.host.prompt(sessionID, "Run the shell tool.")
        await env.host.waitIdle(sessionID)
        await sleep(500)
        const events = env.probeEvents()
        const after = events.find((entry) => entry.event === "tool.execute.after")
        assert(after !== undefined, "tool.execute.after was not observed")
        assert(after.status === "completed", `tool did not complete: ${after.status}`)
        assert(JSON.stringify(after.result).includes(toolOutput), "tool output was not preserved")
        const warden = await env.pluginState("jev-warden")
        assert(warden?.state?.status === "active", `warden plugin state was ${warden?.state?.status}`)
        const wardenStatus = await env.host.api("/api/rpc/jev-warden/status", { method: "POST", body: { input: {} } })
        const status = wardenStatus.body?.output?.status
        assert(status?.flags?.durabilityDegraded === true, "warden did not mark durability degraded")
        return {
          status: "PASSED",
          detail: "warden recording failed without changing the successful tool result; durability degraded was reported",
          evidenceRefs: [env.artifacts.probeLog, env.artifacts.config],
        }
      },
    )
    return result
  })

  // ---------------------------------------------------------------- input mutation
  await runCase("OC2-011", "tool", "before以降にinputが変更: requested/effectiveを混同しない", async () => {
    const result = await withHost(
      {
        probe: { mutateToolInput: "echo jw-probe-tool-mutated" },
        script: SHELL_TOOL_SCRIPT("echo jw-probe-original", "done"),
      },
      async (env) => {
        const sessionID = await env.host.createSession("oc2-011")
        await env.host.prompt(sessionID, "Run the shell tool.")
        await env.host.waitIdle(sessionID)
        await sleep(500)
        const events = env.probeEvents()
        const mutation = events.find((entry) => entry.event === "tool.input.mutated")
        assert(mutation !== undefined, "input mutation was not observed")
        assert(mutation.from === "echo jw-probe-original", `unexpected before input ${mutation.from}`)
        const after = events.find((entry) => entry.event === "tool.execute.after")
        assert(after !== undefined && after.status === "completed", "tool did not complete")
        const resultText = JSON.stringify(after.result)
        assert(resultText.includes("jw-probe-tool-mutated"), "effective input did not reach execution")
        assert(!resultText.includes("jw-probe-original"), "requested input was executed after a later mutation")
        return {
          status: "PASSED",
          detail: "a later hook changed the effective input; the requested and executed commands differed",
          evidenceRefs: [env.artifacts.probeLog],
        }
      },
    )
    return result
  })

  // ---------------------------------------------------------------- ask + abstain
  await runCase("OC2-016", "permission", "元のaskとWarden: askをallowへ変えない", async () => {
    const result = await withHost(
      {
        probe: {},
        warden: {},
        permissions: [{ action: "shell", resource: "*", effect: "ask" }],
        script: SHELL_TOOL_SCRIPT(`echo ${toolOutput}`, "done"),
      },
      async (env) => {
        const sessionID = await env.host.createSession("oc2-016")
        await env.host.prompt(sessionID, "Run the shell tool.")
        await waitFor(async () => (await env.host.pendingPermissions(sessionID)).length > 0, 15_000, 250,
          "an ask decision did not produce a pending permission request")
        const pending = await env.host.pendingPermissions(sessionID)
        const wardenPermission = env.wardenEvents().find((entry) => entry.event === "permission.evaluate")
        assert(wardenPermission !== undefined, "warden did not evaluate the permission")
        assert(wardenPermission.observed === "ask", `warden observed ${wardenPermission.observed}`)
        assert(wardenPermission.composed === "ask", `warden composed ${wardenPermission.composed}`)
        assert(wardenPermission.changed === false, "warden changed the native effect")
        await env.host.replyPermission(sessionID, pending[0].id, "once")
        await env.host.waitIdle(sessionID)
        await sleep(300)
        const after = env.probeEvents().find((entry) => entry.event === "tool.execute.after")
        assert(after?.status === "completed", "tool did not complete after an explicit once reply")
        return {
          status: "PASSED",
          detail: "ask stayed a pending request while Warden abstained; execution required an explicit user reply",
          evidenceRefs: [env.artifacts.probeLog, env.artifacts.wardenLog],
        }
      },
    )
    return result
  })

  // ------------------------------------------------------------------ config deny
  await runCase("OC2-015", "permission", "config denyの最終優先順位: Wardenによる弱化なし、他pluginとの最終動作を確認", async () => {
    const marker = join(tmpdir(), `jw-deny-marker-${startedAt}.txt`)
    const result = await withHost(
      {
        probe: {},
        warden: {},
        permissions: [{ action: "shell", resource: "*", effect: "deny" }],
        script: SHELL_TOOL_SCRIPT(`echo jw-probe-deny-ran > ${marker}`, "done"),
      },
      async (env) => {
        const sessionID = await env.host.createSession("oc2-015")
        await env.host.prompt(sessionID, "Run the shell tool.")
        await env.host.waitIdle(sessionID)
        await sleep(500)
        const events = env.probeEvents()
        const permissionEvents = events.filter((entry) => entry.event === "permission.evaluate")
        assert(permissionEvents.length === 0, "permission hook ran for a configured deny")
        const before = events.find((entry) => entry.event === "tool.execute.before")
        assert(before !== undefined, "execute.before did not observe the requested call")
        assert(!existsSync(marker), "denied command executed a side effect")
        if (existsSync(marker)) rmSync(marker, { force: true })
        // On this host a denied tool is removed from the session tool list, so
        // the call produces a tool error and no execute.after hook. The raw
        // model request records that outcome.
        const mockEvents = env.mock.events()
        const deniedResult = mockEvents
          .slice(1)
          .some((entry) => JSON.stringify(entry.body).includes("No tool named"))
        assert(deniedResult, "denied call did not surface as a tool error result")
        const afterEvents = events.filter((entry) => entry.event === "tool.execute.after")
        return {
          status: "PASSED",
          detail:
            `configured deny skipped the permission hook and produced no side effect; ` +
            `after hook ${afterEvents.length === 0 ? "absent" : "present"} (a missing after must stay outcome_unknown)`,
          evidenceRefs: [env.artifacts.probeLog, env.artifacts.mockLog],
        }
      },
    )
    return result
  })

  // ------------------------------------------------------------------------- RPC
  await runCase("HOST-RPC", "rpc", "typed RPC register/call: read-only status method", async () => {
    const result = await withHost({ probe: {} }, async (env) => {
      const response = await env.host.api("/api/rpc/jw-probe/status", { method: "POST", body: { input: {} } })
      const output = response.body?.output
      assert(output?.ok === true, "rpc status did not return ok")
      assert(typeof output.storageCounter === "number", "rpc status did not return the storage counter")
      return {
        status: "PASSED",
        detail: `typed rpc call returned storageCounter=${output.storageCounter}`,
        evidenceRefs: [env.artifacts.probeLog],
      }
    })
    return result
  })

  // --------------------------------------------------------------------- storage
  await runCase("HOST-STORAGE", "storage", "plugin storage survives location reload", async () => {
    const result = await withHost({ probe: {} }, async (env) => {
      await env.host.reload()
      await waitFor(async () => (await env.pluginState("jw-host-probe"))?.state?.status === "active", 20_000, 250,
        "probe did not reactivate")
      const storageEvents = env.probeEvents().filter((entry) => entry.event === "probe.storage")
      assert(storageEvents.length >= 2, `expected two storage events, got ${storageEvents.length}`)
      const last = storageEvents[storageEvents.length - 1]
      assert(last.current === last.previous + 1, `counter did not increment across reload: ${JSON.stringify(last)}`)
      return {
        status: "PASSED",
        detail: "plugin storage counter persisted across a location reload",
        evidenceRefs: [env.artifacts.probeLog],
      }
    })
    return result
  })

  const finishedAt = Date.now()
  const result = {
    schemaVersion: "warden.host-conformance/0.1",
    host: { cliVersion, opencodeVersionFromServer: serverVersion },
    startedAt,
    finishedAt,
    cases,
    artifacts: { results: outPath },
    notes: [
      "All model calls were served by a local OpenAI-compatible mock on 127.0.0.1.",
      "No Jev/Lab/network call was made by this run.",
      keepScratch ? "Scratch directories were kept for inspection." : "Scratch directories were removed.",
    ],
  }
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, JSON.stringify(result, null, 2) + "\n")
  const failed = cases.filter((entry) => entry.status === "FAILED").length
  process.stderr.write(`conformance: ${cases.length} cases, ${failed} failed -> ${outPath}\n`)
  if (failed > 0) process.exitCode = 1
}

main().catch((error) => {
  process.stderr.write(`conformance runner failed: ${error instanceof Error ? error.stack : String(error)}\n`)
  process.exitCode = 1
})

process.on("SIGINT", () => process.exit(130))
