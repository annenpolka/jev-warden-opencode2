#!/usr/bin/env node
/**
 * Jev Warden doctor.
 *
 * Collects installed-host facts and merges conformance results produced by
 * `fixtures/host-contracts/run-host-conformance.mjs`. It never marks a check as
 * passed on its own: runtime checks come from the conformance run, and anything
 * not executed stays NOT_RUN.
 */
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join, resolve } from "node:path"
import { check, type DoctorCheck, type DoctorReport, type InstalledHost } from "@jev-warden/core"
import { buildDoctorReport, mergeConformance, type ConformanceResult } from "./report.ts"

const require = createRequire(import.meta.url)
const repoRoot = resolve(dirname(new URL(import.meta.url).pathname), "../../..")

interface Args {
  readonly out: string | null
  readonly server: string | null
  readonly password: string | null
  readonly conformance: string | null
  readonly pluginPackage: string | null
}

function parseArgs(argv: readonly string[]): Args {
  const args: Record<string, string> = {}
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === undefined || !token.startsWith("--")) continue
    const key = token.slice(2)
    const next = argv[index + 1]
    if (next !== undefined && !next.startsWith("--")) {
      args[key] = next
      index += 1
    }
  }
  return {
    out: args.out ?? null,
    server: args.server ?? null,
    password: args.password ?? null,
    conformance: args.conformance ?? null,
    pluginPackage: args["plugin-package"] ?? null,
  }
}

function tryRun(command: string, args: readonly string[]): string | null {
  try {
    return execFileSync(command, [...args], { encoding: "utf8", timeout: 20_000 }).trim()
  } catch {
    return null
  }
}

function sha256File(path: string): string | null {
  try {
    return createHash("sha256").update(readFileSync(path)).digest("hex")
  } catch {
    return null
  }
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"))
  } catch {
    return null
  }
}

async function fetchServerVersion(server: string, password: string | null): Promise<string | null> {
  try {
    const headers: Record<string, string> = {}
    if (password !== null) headers.authorization = `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`
    const response = await fetch(`${server.replace(/\/$/, "")}/api/info`, { headers })
    if (!response.ok) return null
    const body = (await response.json()) as { data?: { version?: string }; version?: string }
    return body.data?.version ?? body.version ?? null
  } catch {
    return null
  }
}

function installedHost(args: Args): InstalledHost {
  const rawVersion = tryRun("opencode", ["--version"])
  const cliVersion = rawVersion === null ? null : rawVersion.replace(/^opencode\s+v?/i, "").trim() || rawVersion
  const binaryPath = tryRun("which", ["opencode"])
  const pluginPackagePath = args.pluginPackage ??
    join(repoRoot, "node_modules/@opencode/plugin/package.json")
  const pluginPackage = readJson(pluginPackagePath) as { version?: string } | null
  const lock = readJson(join(repoRoot, "package-lock.json")) as {
    packages?: Record<string, { integrity?: string; version?: string }>
  } | null
  const pluginIntegrity = lock?.packages?.["node_modules/@opencode/plugin"]?.integrity ?? null
  return {
    cliVersion,
    serverVersion: null,
    channel: null,
    pluginPackageVersion: typeof pluginPackage?.version === "string" ? pluginPackage.version : null,
    pluginPackageIntegrity: pluginIntegrity,
    binaryPath: binaryPath !== null && existsSync(binaryPath) ? binaryPath : null,
    binarySha256: binaryPath !== null && existsSync(binaryPath) ? sha256File(binaryPath) : null,
    runtime: `node ${process.version}`,
    platform: process.platform,
    platformRelease: tryRun("uname", ["-r"]),
  }
}

function notRunChecks(): DoctorCheck[] {
  return [
    check("doctor.jev.live", "jev", "実Jev接続で観測・検証を行う", "NOT_RUN", [], "no live Jev credential was used"),
    check("doctor.lab.handshake", "storage", "Lab handshakeとoutbox再送を確認する", "NOT_RUN", []),
    check("doctor.tui.load", "tui", "実TUIでのplugin loadとslot表示を確認する", "NOT_RUN", []),
    check("doctor.executor.sandbox", "executor", "OS隔離executorでmutation検証を行う", "NOT_RUN", []),
    check("doctor.learning.promotion", "learning", "候補生成から採用・退役までを実行する", "NOT_RUN", []),
  ]
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  let installed = installedHost(args)
  if (args.server !== null) {
    installed = { ...installed, serverVersion: await fetchServerVersion(args.server, args.password) }
  }

  const checks: DoctorCheck[] = []
  let notes: string[] = []

  if (args.conformance !== null && existsSync(args.conformance)) {
    const raw = readJson(args.conformance) as ConformanceResult | null
    if (raw !== null && raw.schemaVersion === "warden.host-conformance/0.1") {
      const observedAt = raw.finishedAt ?? Date.now()
      checks.push(...mergeConformance(raw.cases).map((entry) => ({ ...entry, observedAt })))
      if (installed.serverVersion === null && typeof raw.host.opencodeVersionFromServer === "string") {
        installed = { ...installed, serverVersion: raw.host.opencodeVersionFromServer }
      }
      notes.push(`conformance run: ${raw.host.cliVersion ?? "unknown-cli"}`)
      for (const [name, path] of Object.entries(raw.artifacts ?? {})) {
        notes.push(`artifact ${name}: ${path}`)
      }
    } else {
      notes.push(`conformance file was not usable: ${args.conformance}`)
    }
  } else {
    notes.push("no conformance result was supplied; runtime checks were not executed")
  }

  checks.push(...notRunChecks())
  const report: DoctorReport = buildDoctorReport({ installed, checks, generatedAt: Date.now(), notes })

  const json = JSON.stringify(report, null, 2)
  if (args.out !== null) writeFileSync(args.out, json + "\n")
  else process.stdout.write(json + "\n")
}

void main().catch((error) => {
  process.stderr.write(`doctor failed: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})

void require
