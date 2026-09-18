#!/usr/bin/env node
/**
 * Collects a host baseline from the installed environment.
 *
 * This records only facts that were actually observed locally: installed
 * versions, file digests, package-lock integrity, and contract statements that
 * host-conformance runs produced. It does not claim a release channel or an
 * upstream source state.
 *
 * Usage: node fixtures/host-contracts/collect-host-baseline.mjs [--out path] [--conformance path]
 */
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, "../..")

const args = {}
for (let index = 0; index < process.argv.length; index += 1) {
  const token = process.argv[index]
  if (token === "--out") args.out = process.argv[index + 1]
  if (token === "--conformance") args.conformance = process.argv[index + 1]
}
const outPath = resolve(process.cwd(), args.out ?? "checks/host-baseline.json")
const conformancePath = args.conformance ? resolve(process.cwd(), args.conformance) : null

function tryRun(command, commandArgs) {
  try {
    return execFileSync(command, commandArgs, { encoding: "utf8", timeout: 20_000 }).trim()
  } catch {
    return null
  }
}

function sha256File(path) {
  try {
    return createHash("sha256").update(readFileSync(path)).digest("hex")
  } catch {
    return null
  }
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"))
  } catch {
    return null
  }
}

const pluginDir = join(repoRoot, "node_modules/@opencode/plugin")
const pluginPackage = readJson(join(pluginDir, "package.json"))
const lock = readJson(join(repoRoot, "package-lock.json"))
const typeFiles = [
  "dist/effect/plugin.d.ts",
  "dist/effect/session.d.ts",
  "dist/effect/tool.d.ts",
  "dist/effect/permission.d.ts",
  "dist/effect/rpc.d.ts",
  "dist/effect/storage.d.ts",
  "dist/promise/index.d.ts",
  "dist/tui/plugin.d.ts",
  "dist/tui/context.d.ts",
]
const typeSurface = {}
for (const relative of typeFiles) {
  const digest = sha256File(join(pluginDir, relative))
  if (digest !== null) typeSurface[relative] = digest
}

const binaryPath = tryRun("which", ["opencode"])
const conformance = conformancePath !== null && existsSync(conformancePath) ? readJson(conformancePath) : null

const baseline = {
  schemaVersion: "warden.host-baseline/0.1",
  capturedAt: Date.now(),
  installedHost: {
    cliVersionRaw: tryRun("opencode", ["--version"]),
    binaryPath,
    binarySha256: binaryPath !== null ? sha256File(binaryPath) : null,
    runtime: `node ${process.version}`,
    bun: tryRun("bun", ["--version"]),
    platform: process.platform,
    platformRelease: tryRun("uname", ["-r"]),
  },
  publishedPluginPackage: {
    name: pluginPackage?.name ?? null,
    version: pluginPackage?.version ?? null,
    lockIntegrity: lock?.packages?.["node_modules/@opencode/plugin"]?.integrity ?? null,
    note: "Typechecking and the loaded fixture/warden plugins used this published package. The compiled CLI bundles its own copy; the binary package version is not directly observable.",
  },
  designBaseline: {
    repository: "anomalyco/opencode",
    commit: "a2594ddefb6557ecf7e7edb3e30ea50c71df8519",
    sourcePackageName: "@opencode/plugin",
    sourcePackageVersion: "2.0.7",
  },
  typeSurface,
  conformance: conformance === null
    ? null
    : {
        file: args.conformance ?? conformancePath,
        cliVersion: conformance.host?.cliVersion ?? null,
        serverVersion: conformance.host?.opencodeVersionFromServer ?? null,
        caseCount: conformance.cases?.length ?? 0,
        failed: (conformance.cases ?? []).filter((entry) => entry.status === "FAILED").length,
      },
  observedContracts: [
    {
      id: "HOST-PLUGIN-DISCOVERY",
      statement:
        "`.opencode/plugins/<dir>/index.{js,ts}` under the project is discovered after the location boots; activation and teardown run on POST /api/location/reload. A plugin directory referenced from config `plugins` needed a root index.ts entry in 2.0.7; package.json exports alone was not used for local directory loading.",
      evidence: ["checks/host-conformance-2.0.7.json#OC2-001", "session scratch probe on opencode 2.0.7"],
    },
    {
      id: "HOST-PLUGIN-RESOLUTION",
      statement:
        "A local plugin must resolve `@opencode/plugin` itself (for example from an ancestor node_modules). A resolution failure shows as plugin state `failed` with a `ref`, and the host keeps running.",
      evidence: ["observed error ref err_be4931e6 on opencode 2.0.7", "checks/host-conformance-2.0.7.json#OC2-001"],
    },
    {
      id: "HOST-PROMPT-ORDER",
      statement:
        "Prompt hooks run in plugin registration order (config order). A later plugin observes an earlier plugin's rewrite; the host observed and persisted the rewritten text, so a recorded draft must not be labelled as the original user request.",
      evidence: ["checks/host-conformance-2.0.7.json#OC2-004"],
    },
    {
      id: "HOST-CONTEXT-EPHEMERAL",
      statement:
        "A system part appended in the context hook reached the outgoing model request and was absent from session readback.",
      evidence: ["checks/host-conformance-2.0.7.json#OC2-007"],
    },
    {
      id: "HOST-BEFORE-VS-PERMISSION",
      statement:
        "On 2.0.7, tool execute.before runs before permission evaluation for allow and ask decisions. A requested call observed in before is not proof of authorization or dispatch.",
      evidence: ["checks/host-conformance-2.0.7.json#OC2-017", "checks/host-conformance-2.0.7.json#OC2-016"],
    },
    {
      id: "HOST-DENY-SHAPE",
      statement:
        "A configured deny did not invoke the permission hook. The denied tool was absent from the session tool list, the call produced a tool error result (\"No tool named ... is currently available\"), no execute.after hook ran, and no side effect occurred.",
      evidence: ["checks/host-conformance-2.0.7.json#OC2-015"],
    },
    {
      id: "HOST-INPUT-MUTATION",
      statement:
        "A later execute.before hook can replace tool input; execution used the mutated value. Requested input and effective input must be recorded separately.",
      evidence: ["checks/host-conformance-2.0.7.json#OC2-011"],
    },
    {
      id: "HOST-ASK-REPLY",
      statement:
        "An ask decision produced a pending permission request. A plugin that abstained left the request pending; execution required an explicit reply. The reply body in 2.0.7 requires `{decision}` (not `reply` as some docs show).",
      evidence: ["checks/host-conformance-2.0.7.json#OC2-016", "host API error: Missing key at [\"decision\"]"],
    },
    {
      id: "HOST-RPC",
      statement:
        "ctx.rpc.register accepted a JSON Schema contract; POST /api/rpc/{rpcId}/{method} with body {input} returned {output}.",
      evidence: ["checks/host-conformance-2.0.7.json#HOST-RPC"],
    },
    {
      id: "HOST-STORAGE",
      statement: "Plugin-scoped storage persisted across a location reload.",
      evidence: ["checks/host-conformance-2.0.7.json#HOST-STORAGE"],
    },
    {
      id: "HOST-SERVER-API-AUTH",
      statement:
        "The standalone server printed a `server password`; requests authenticated with HTTP Basic (`opencode:<password>`). API routes live under /api and the OpenAPI document is served at /openapi.json.",
      evidence: ["scratch host on opencode 2.0.7"],
    },
  ],
  unverified: [
    "TUI plugin loading and slot rendering (no interactive TUI session was run).",
    "Event stream delivery guarantees and reconnect behavior.",
    "Worktree/executor/OS isolation behavior.",
    "Live Jev and Lab connectivity.",
    "Behavior of the host's bundled plugin implementation version beyond the version string 2.0.7.",
  ],
}

writeFileSync(outPath, JSON.stringify(baseline, null, 2) + "\n")
console.log(`host baseline written to ${outPath}`)
