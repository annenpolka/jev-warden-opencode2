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
import { spawn, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import { createServer as createNetServer } from "node:net"
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
const liveJevEnabled = process.env.JW_LIVE_JEV === "1" || args["live-jev"] === "true"

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
    const server = createNetServer()
    server.unref()
    server.on("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      const port = typeof address === "object" && address !== null ? address.port : 0
      server.close(() => resolvePromise(port))
    })
  })
}

/** Runs a Lab CLI and returns its parsed stdout. */
function runLab(label, script, args) {
  return new Promise((resolvePromise, reject) => {
    const proc = spawn(process.execPath, [join(repoRoot, "packages/lab/src", script), ...args], {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString()
    })
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString()
    })
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`${label} exited ${code}: ${stderr.slice(0, 300)}`))
        return
      }
      try {
        resolvePromise(JSON.parse(stdout))
      } catch {
        reject(new Error(`${label} produced non-JSON output: ${stdout.slice(0, 200)}`))
      }
    })
  })
}

/** A local Jev endpoint used only for fault injection. */
function startFaultJev(script) {
  return new Promise((resolvePromise) => {
    const requests = []
    const server = createServer(async (req, res) => {
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      let body = {}
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"))
      } catch {}
      const index = requests.length
      requests.push({ at: Date.now(), body })
      const entry = script[index] ?? { kind: "ok", noul: 0.5 }
      if (entry.kind === "hang") {
        // Never respond: the transport deadline must handle it.
        return
      }
      if (entry.kind === "http_error") {
        res.writeHead(entry.status ?? 429, { "content-type": "application/json" })
        res.end(JSON.stringify({ error: "scripted fault" }))
        return
      }
      const answers = {}
      for (const [name] of Object.entries(body.questions ?? {})) {
        if (entry.kind === "invalid_noul") answers[name] = { type: "noul", noul: 1.4 }
        else answers[name] = { type: "noul", noul: entry.noul ?? 0.5 }
      }
      res.writeHead(200, { "content-type": "application/json" })
      res.end(JSON.stringify({ model: "jev-fault-mock", answers }))
    })
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      const port = typeof address === "object" && address !== null ? address.port : 0
      resolvePromise({
        url: `http://127.0.0.1:${port}/v1/systemone`,
        requests,
        stop: () => server.close(),
      })
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

  async rpc(rpcID, method, input) {
    const response = await this.api(`/api/rpc/${rpcID}/${method}`, { method: "POST", body: { input } })
    return response.body?.output
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

  // ------------------------------------------------------------------ Jev review
  const fixtureDir = join(repoRoot, "checks/jev-live/2026-09-18-specific-sufficiency")
  const fixtureTestCode = readFileSync(join(fixtureDir, "test_code.txt"), "utf8")
  const fixtureDefinitionsMissing = readFileSync(join(fixtureDir, "a-missing-definition/definitions.txt"), "utf8")
  const fixtureDefinitionsPresent = readFileSync(join(fixtureDir, "b-with-definition/definitions.txt"), "utf8")
  const probeID = "specific-sufficiency.expected-calls-definition"

  await runCase("EXTRA-JEV-DISABLED", "jev", "review RPC is rejected when live Jev is disabled", async () => {
    const result = await withHost({ probe: {}, warden: {} }, async (env) => {
      const sessionID = await env.host.createSession("jev-disabled")
      const output = await env.host.rpc("jev-warden", "review.request", {
        sessionID,
        probeID,
        state: { test_code: fixtureTestCode, definitions: fixtureDefinitionsMissing },
      })
      assert(output?.status === "rejected", `expected rejected, got ${JSON.stringify(output)}`)
      assert(output?.error === "jev_disabled", `unexpected error ${output?.error}`)
      const status = await env.host.rpc("jev-warden", "status", {})
      assert(status?.status?.flags?.jevUnavailable === true, "disabled Jev should be flagged unavailable")
      return {
        status: "PASSED",
        detail: "live Jev stays off by default; the review RPC is rejected before any transport call",
        evidenceRefs: [env.artifacts.config],
      }
    })
    return result
  })

  await runCase("EXTRA-JEV-LIVE", "jev", "explicit review RPC runs live Jev, records answers, and enforces budget", async () => {
    if (!liveJevEnabled) {
      return {
        status: "BLOCKED",
        detail: "live Jev disabled for this run; set JW_LIVE_JEV=1 to execute (uses the OS credential store)",
        evidenceRefs: [],
      }
    }
    const result = await withHost(
      { probe: {}, warden: { jev: { enabled: true, maxRequests: 2 } } },
      async (env) => {
        const sessionID = await env.host.createSession("jev-live")
        const credentialOutput = await env.host.rpc("jev-warden", "review.request", {
          sessionID,
          probeID,
          state: {
            test_code: fixtureTestCode,
            definitions: `api_key = "${"q".repeat(24)}"`,
          },
        })
        assert(credentialOutput?.status === "rejected", "credential-shaped state was not rejected")
        assert(
          typeof credentialOutput?.error === "string" && credentialOutput.error.startsWith("credential_pattern:"),
          `unexpected rejection: ${credentialOutput?.error}`,
        )
        assert(
          !JSON.stringify(credentialOutput).includes("q".repeat(24)),
          "the rejected value leaked into the RPC response",
        )

        const missing = await env.host.rpc("jev-warden", "review.request", {
          sessionID,
          probeID,
          state: { test_code: fixtureTestCode, definitions: fixtureDefinitionsMissing },
          stateRefs: ["fixture:test_code", "fixture:definitions-missing"],
        })
        assert(missing?.status === "completed", `first live review failed: ${JSON.stringify(missing)}`)
        assert(missing?.answers?.expected_calls_value_visible?.type === "noul", "missing sufficiency answer")
        const sufficiencyA = missing.answers.expected_calls_value_visible.noul
        const claimA = missing.answers.expected_total_is_three?.noul

        const present = await env.host.rpc("jev-warden", "review.request", {
          sessionID,
          probeID,
          state: { test_code: fixtureTestCode, definitions: fixtureDefinitionsPresent },
          stateRefs: ["fixture:test_code", "fixture:definitions-present"],
        })
        assert(present?.status === "completed", `second live review failed: ${JSON.stringify(present)}`)
        const sufficiencyB = present.answers.expected_calls_value_visible.noul
        const claimB = present.answers.expected_total_is_three?.noul

        const overBudget = await env.host.rpc("jev-warden", "review.request", {
          sessionID,
          probeID,
          state: { test_code: fixtureTestCode, definitions: fixtureDefinitionsMissing },
        })
        assert(overBudget?.status === "budget_exhausted", `budget was not enforced: ${JSON.stringify(overBudget)}`)

        const listed = await env.host.rpc("jev-warden", "review.list", { sessionID })
        assert(
          Array.isArray(listed?.items) && listed.items.length === 4,
          `review ledger did not record four items: ${JSON.stringify(listed)?.slice(0, 600)}`,
        )

        const status = await env.host.rpc("jev-warden", "status", {})
        assert(status?.status?.counters?.jevObservations === 2, "jevObservations counter mismatch")
        assert(status?.status?.counters?.jevRejected === 2, "jevRejected counter mismatch")

        writeFileSync(
          join(fixtureDir, "host-review-observations.json"),
          JSON.stringify(
            {
              schemaVersion: "warden.jev-host-observations/0.1",
              at: Date.now(),
              host: "opencode 2.0.7",
              transport: "plugin RPC review.request",
              sessionID,
              reviews: [
                { arm: "credential-control", output: credentialOutput },
                { arm: "definition-missing", output: missing, stateRefs: ["fixture:test_code", "fixture:definitions-missing"] },
                { arm: "definition-present", output: present, stateRefs: ["fixture:test_code", "fixture:definitions-present"] },
                { arm: "over-budget-control", output: overBudget },
              ],
              counters: status?.status?.counters ?? null,
            },
            null,
            2,
          ) + "\n",
        )

        return {
          status: "PASSED",
          detail:
            `live review through the plugin: sufficiency ${sufficiencyA} -> ${sufficiencyB}, ` +
            `claim ${claimA} -> ${claimB}; credential-shaped state rejected locally; budget enforced at 2`,
          evidenceRefs: [env.artifacts.config, "checks/jev-live/2026-09-18-specific-sufficiency/"],
        }
      },
    )
    return result
  })

  // ------------------------------------------------------------- policy switch
  const candidateBundle = JSON.parse(readFileSync(join(fixtureDir, "candidate-bundle.json"), "utf8"))
  await runCase("EXTRA-POLICY-SWITCH", "policy", "active bundle pin survives rollback; revocation stops guidance", async () => {
    const policyDir = mkdtempSync(join(tmpdir(), "jw-policy-"))
    const marker = `JW-POLICY-GUIDANCE-${Date.now()}`
    try {
      const labDb = join(policyDir, "lab.db")
      const policyFile = join(policyDir, "policy", "active.json")
      const candidatePath = join(policyDir, "candidate.json")
      writeFileSync(candidatePath, JSON.stringify(candidateBundle, null, 2))
      const stored = await runLab("candidate", "candidate.mjs", ["--db", labDb, "--bundle", candidatePath])
      const promoted = await runLab("promote", "policy.mjs", [
        "--db", labDb, "promote",
        "--bundle", candidateBundle.id,
        "--digest", stored.digest,
        "--evaluation", "canary-mechanics-validation",
        "--export", policyFile,
      ])
      assert(promoted.pointer?.status === "active", "promotion did not move the active pointer")

      const result = await withHost(
        { probe: {}, warden: { advisoryNote: marker, policyPath: policyFile } },
        async (env) => {
          const idA = await env.host.createSession("policy-a")
          await env.host.prompt(idA, "Policy check A")
          await env.host.waitIdle(idA)
          await sleep(500)
          const eventsA = env.wardenEvents()
          const boundA = eventsA.filter((entry) => entry.event === "policy.bound" && entry.sessionID === idA).pop()
          assert(boundA?.policyId === candidateBundle.id, `session A pinned ${boundA?.policyId}`)
          assert(boundA?.guidanceEnabled === true, "candidate guidance was not enabled")
          assert(eventsA.some((entry) => entry.event === "guidance.delivered" && entry.sessionID === idA), "guidance was not delivered")
          const requestsWithMarkerBefore = env.mock.events().filter((entry) => JSON.stringify(entry.body).includes(marker)).length
          assert(requestsWithMarkerBefore >= 1, "guidance marker never reached the model request")

          const snapshotA = await env.host.rpc("jev-warden", "snapshot.get", {})
          const pinA = (snapshotA?.debug?.pins ?? []).find((entry) => entry.sessionId === idA)
          assert(pinA?.policyId === candidateBundle.id && pinA.guidance === true && pinA.revoked === false,
            `unexpected pin view for A: ${JSON.stringify(pinA)}`)

          await runLab("rollback", "policy.mjs", [
            "--db", labDb, "rollback", "--evaluation", "eval-rollback-1", "--export", policyFile,
          ])
          await sleep(300)

          const idB = await env.host.createSession("policy-b")
          await env.host.prompt(idB, "Policy check B")
          await env.host.waitIdle(idB)
          await sleep(500)
          const eventsB = env.wardenEvents()
          const boundB = eventsB.filter((entry) => entry.event === "policy.bound" && entry.sessionID === idB).pop()
          assert(boundB?.policyId === "baseline-observe-only", `session B pinned ${boundB?.policyId}`)
          assert(
            eventsB.some((entry) => entry.event === "guidance.suppressed" && entry.sessionID === idB && entry.reason === "suppress"),
            "baseline pin did not suppress guidance",
          )
          const latestRequest = env.mock.events().at(-1)
          assert(!JSON.stringify(latestRequest?.body ?? {}).includes(marker), "suppressed guidance still reached the model")
          const snapshotB = await env.host.rpc("jev-warden", "snapshot.get", {})
          const pinAAfterRollback = (snapshotB?.debug?.pins ?? []).find((entry) => entry.sessionId === idA)
          assert(pinAAfterRollback?.policyId === candidateBundle.id, "rollback replaced an existing session pin")

          await runLab("revoke", "policy.mjs", [
            "--db", labDb, "revoke", "--digest", stored.digest, "--reason", "conformance", "--export", policyFile,
          ])
          await sleep(300)
          await env.host.prompt(idA, "Policy check A2")
          await env.host.waitIdle(idA)
          await sleep(500)
          const eventsA2 = env.wardenEvents()
          assert(
            eventsA2.some((entry) => entry.event === "guidance.suppressed" && entry.sessionID === idA && entry.reason === "revoked"),
            "revocation did not stop guidance for the pinned session",
          )
          const snapshot2 = await env.host.rpc("jev-warden", "snapshot.get", {})
          const pinA2 = (snapshot2?.debug?.pins ?? []).find((entry) => entry.sessionId === idA)
          assert(pinA2?.revoked === true, "revoked pin was not visible in the snapshot")
          const status = await env.host.rpc("jev-warden", "status", {})
          assert(status?.status?.counters?.policyRevokedSessions === 1, "policyRevokedSessions counter mismatch")

          return {
            status: "PASSED",
            detail:
              `active ${candidateBundle.id} pinned to A (guidance on); rollback pinned B to baseline and kept A; ` +
              `revocation stopped guidance for A`,
            evidenceRefs: [env.artifacts.wardenLog, policyFile],
          }
        },
      )
      return result
    } finally {
      if (keepScratch !== true) rmSync(policyDir, { recursive: true, force: true })
    }
  })

  // --------------------------------------------------------------- Jev faults
  await runCase("EXTRA-JEV-FAULTS", "jev", "fault injection: timeout, 5xx, 429, invalid answer, budget exhaustion", async () => {
    const faults = await startFaultJev([
      { kind: "hang" },
      { kind: "http_error", status: 500 },
      { kind: "http_error", status: 429 },
      { kind: "invalid_noul" },
    ])
    try {
      const result = await withHost(
        { probe: {}, warden: { jev: { enabled: true, maxRequests: 4, timeoutMs: 800, endpoint: faults.url } } },
        async (env) => {
          const sessionID = await env.host.createSession("jev-faults")
          const state = { test_code: fixtureTestCode, definitions: fixtureDefinitionsMissing }
          const call = () => env.host.rpc("jev-warden", "review.request", { sessionID, probeID, state })

          const timeout = await call()
          assert(timeout?.status === "unavailable", `timeout: expected unavailable, got ${timeout?.status}`)
          assert(/transport_error/.test(timeout?.error ?? ""), `timeout error was ${timeout?.error}`)
          const serverError = await call()
          assert(serverError?.status === "unavailable" && /^http_500/.test(serverError?.error ?? ""), `500 handling: ${JSON.stringify(serverError)}`)
          const rateLimited = await call()
          assert(rateLimited?.status === "unavailable" && /^http_429/.test(rateLimited?.error ?? ""), `429 handling: ${JSON.stringify(rateLimited)}`)
          const invalid = await call()
          assert(invalid?.status === "invalid_response", `invalid answer: expected invalid_response, got ${invalid?.status}`)
          assert((invalid?.error ?? "").startsWith("answer_invalid"), `invalid error was ${invalid?.error}`)
          const overBudget = await call()
          assert(overBudget?.status === "budget_exhausted", `expected budget_exhausted, got ${overBudget?.status}`)
          assert(faults.requests.length === 4, `fault endpoint saw ${faults.requests.length} requests`)

          const listed = await env.host.rpc("jev-warden", "review.list", { sessionID })
          const invalidItem = (listed?.items ?? []).find((entry) => entry.status === "invalid_response")
          assert(
            typeof invalidItem?.rawSample === "string" && invalidItem.rawSample.includes("1.4"),
            `raw invalid answer was not kept for audit: ${JSON.stringify(invalidItem?.rawSample)}`,
          )

          const status = await env.host.rpc("jev-warden", "status", {})
          assert(
            status?.status?.counters?.jevRejected === 5,
            `jevRejected counter mismatch: ${status?.status?.counters?.jevRejected} (timeout, 500, 429, invalid, budget stop)`,
          )
          assert(status?.status?.counters?.jevObservations === 0, "a faulted call was recorded as an observation")
          return {
            status: "PASSED",
            detail:
              "timeout, 500, 429 and an out-of-range answer stayed unavailable/invalid_response without normalisation; " +
              "the invalid value was kept raw for audit; the budget stopped the fifth call locally",
            evidenceRefs: [env.artifacts.wardenLog],
          }
        },
      )
      return result
    } finally {
      faults.stop()
    }
  })

  // ------------------------------------------------------------ outbox failure
  await runCase("EXTRA-OUTBOX-FAILURE", "storage", "an unwritable outbox degrades durability without changing tool results", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jw-outboxfail-"))
    try {
      const result = await withHost(
        { probe: {}, warden: { outboxPath: dir }, script: SHELL_TOOL_SCRIPT(`echo ${toolOutput}`, "done") },
        async (env) => {
          const sessionID = await env.host.createSession("outbox-failure")
          await env.host.prompt(sessionID, "Run the shell tool.")
          await env.host.waitIdle(sessionID)
          await sleep(4_000)
          const after = env.probeEvents().find((entry) => entry.event === "tool.execute.after")
          assert(after?.status === "completed", `tool did not complete: ${after?.status}`)
          assert(JSON.stringify(after.result).includes(toolOutput), "tool output was not preserved")
          const status = await env.host.rpc("jev-warden", "status", {})
          assert(status?.status?.flags?.durabilityDegraded === true, "durability degradation was not reported")
          return {
            status: "PASSED",
            detail: "writing the outbox to an unwritable path degraded durability while the tool result stayed unchanged",
            evidenceRefs: [env.artifacts.probeLog, env.artifacts.config],
          }
        },
      )
      return result
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  // ------------------------------------------------------------------ TUI load
  await runCase("EXTRA-TUI-LOAD", "tui", "TUI plugin load and command surface", async () => {
    const tmuxCheck = spawnSync("which", ["tmux"], { encoding: "utf8" })
    if (tmuxCheck.status !== 0) {
      return { status: "BLOCKED", detail: "tmux is not available on this host", evidenceRefs: [] }
    }
    const scratch = mkdtempSync(join(tmpdir(), "jw-tui-load-"))
    const tuiLog = join(scratch, "tui.jsonl")
    const paneOut = join(repoRoot, "checks", "tui-pane-2.0.7.txt")
    const session = `jw-tui-${Date.now()}`
    try {
      writeFileSync(
        join(scratch, "opencode.json"),
        JSON.stringify(
          {
            $schema: "https://opencode.ai/config.json",
            plugins: [
              { package: probePath, options: { mockBaseURL: null } },
              { package: wardenPath, options: { mode: "observe" } },
            ],
          },
          null,
          2,
        ) + "\n",
      )
      const start = spawnSync(
        "tmux",
        ["new-session", "-d", "-s", session, "-x", "150", "-y", "45", "-c", scratch, `env JW_PROBE_TUI_LOG=${tuiLog} opencode`],
        { encoding: "utf8" },
      )
      assert(start.status === 0, `tmux new-session failed: ${start.stderr}`)
      await sleep(10_000)
      spawnSync("tmux", ["send-keys", "-t", session, "/plugins", "Enter"], { encoding: "utf8" })
      await sleep(1_000)
      spawnSync("tmux", ["send-keys", "-t", session, "Enter"], { encoding: "utf8" })
      await sleep(2_000)
      const pane = spawnSync("tmux", ["capture-pane", "-t", session, "-p"], { encoding: "utf8" }).stdout ?? ""
      writeFileSync(paneOut, pane)
      spawnSync("tmux", ["kill-session", "-t", session], { encoding: "utf8" })

      const events = readJsonl(tuiLog)
      const imported = events.some((entry) => entry.event === "tui.module-imported")
      const setup = events.some((entry) => entry.event === "tui.setup")
      const listedInPanel = pane.includes("jw-host-probe")
      if (imported && setup) {
        return {
          status: "PASSED",
          detail: "the TUI process imported the ./tui entry and ran setup",
          evidenceRefs: ["checks/tui-pane-2.0.7.txt"],
        }
      }
      return {
        status: "BLOCKED",
        detail:
          `TUI process did not import the ./tui entry (moduleImported=${imported}, setup=${setup}, ` +
          `listedInPanel=${listedInPanel}); on opencode 2.0.7 the CLI-side loader reports ` +
          `"Keymap.Provider is missing" and the interactive TUI does not load V2 ./tui entries`,
        evidenceRefs: ["checks/tui-pane-2.0.7.txt"],
      }
    } finally {
      spawnSync("tmux", ["kill-session", "-t", session], { encoding: "utf8" })
      rmSync(scratch, { recursive: true, force: true })
    }
  })

  // ------------------------------------------------------- mutation executor
  await runCase("EXTRA-MUTATION-EXECUTOR", "executor", "mutation detection separates regression from setup failure", async () => {
    const out = join(repoRoot, "checks", "mutation-2026-09-18.json")
    const run = spawnSync(process.execPath, [join(here, "..", "executor", "run-mutation.mjs"), "--out", out], {
      encoding: "utf8",
      timeout: 120_000,
    })
    assert(run.status === 0, `mutation executor failed: ${run.stderr?.slice(0, 300)}`)
    const receipt = JSON.parse(readFileSync(out, "utf8"))
    assert(receipt.baseline?.passed === true, "baseline did not pass")
    const byId = Object.fromEntries(receipt.mutations.map((entry) => [entry.id, entry.classification]))
    assert(byId["double-send"] === "regression_detected", `wrong implementation classified as ${byId["double-send"]}`)
    assert(byId["syntax-error"] === "setup_error", `broken setup classified as ${byId["syntax-error"]}`)
    assert(byId["comment-only"] === "tolerated", `tolerated change classified as ${byId["comment-only"]}`)
    assert(receipt.mainUnchanged === true, "the main task directory changed")
    assert(receipt.cleanup?.removed === true, "the owned temp directory was not removed")
    return {
      status: "PASSED",
      detail:
        "isolated copy: baseline passed, wrong implementation detected at the assertion, broken setup classified as setup_error, tolerated change passed, main tree unchanged",
      evidenceRefs: ["checks/mutation-2026-09-18.json"],
    }
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
