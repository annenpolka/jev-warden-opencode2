#!/usr/bin/env node
/**
 * Bounded mutation check on an isolated copy of a fixture task.
 *
 * For each mutation the receipt separates:
 *   - regression_detected: the test failed at the assertion the contract names;
 *   - setup_error: the run failed before the contract could be exercised;
 *   - tolerated: the mutation kept the contract, tests passed.
 *
 * The main task directory is hashed before and after; only the temp copy is
 * ever removed. This is filesystem isolation, not an OS sandbox, and the
 * receipt says so.
 *
 * Usage: node fixtures/executor/run-mutation.mjs [--out checks/mutation.json]
 */
import { createHash } from "node:crypto"
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, "../..")
const taskDir = join(here, "task")

const args = {}
for (let index = 0; index < process.argv.length; index += 1) {
  if (process.argv[index] !== "--out") continue
  args.out = process.argv[index + 1]
  index += 1
}
const outPath = resolve(process.cwd(), args.out ?? "checks/mutation-2026-09-18.json")

function listFiles(dir, base = dir) {
  const found = []
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry)
    const stats = statSync(full)
    if (stats.isDirectory()) found.push(...listFiles(full, base))
    else found.push(relative(base, full))
  }
  return found
}

function manifest(dir) {
  const entries = {}
  for (const relativePath of listFiles(dir)) {
    entries[relativePath] = createHash("sha256").update(readFileSync(join(dir, relativePath))).digest("hex")
  }
  return entries
}

function runTests(dir) {
  const startedAt = Date.now()
  const result = spawnSync(process.execPath, ["--test", "test/notify.test.mjs"], {
    cwd: dir,
    encoding: "utf8",
    timeout: 30_000,
  })
  return {
    exitCode: result.status,
    durationMs: Date.now() - startedAt,
    stdout: (result.stdout ?? "").slice(0, 4_000),
    stderr: (result.stderr ?? "").slice(0, 4_000),
  }
}

const ASSERTION_PATTERN = /notifies once per event|AssertionError|Expected values/
const SETUP_PATTERN = /SyntaxError|ERR_MODULE_NOT_FOUND|Cannot find module|ERR_UNSUPPORTED|Unexpected token/

function classify(run) {
  if (run.exitCode === 0) return "tolerated"
  const output = `${run.stdout}\n${run.stderr}`
  if (ASSERTION_PATTERN.test(output)) return "regression_detected"
  if (SETUP_PATTERN.test(output)) return "setup_error"
  return "unclassified_failure"
}

const MUTATIONS = [
  {
    id: "double-send",
    kind: "wrong_implementation",
    files: {
      "src/notify.mjs": `export async function notifyUser(event, transport) {\n  await transport.send(\`event:\${event.id}\`)\n  await transport.send(\`event:\${event.id}\`)\n}\n`,
    },
  },
  {
    id: "syntax-error",
    kind: "broken_setup",
    files: {
      "src/notify.mjs": `export async function notifyUser(event, transport) {\n  await transport.send(\`event:\${event.id}\`)\n`,
    },
  },
  {
    id: "comment-only",
    kind: "tolerated_change",
    files: {
      "src/notify.mjs": `// refactor note: single send preserved\nexport async function notifyUser(event, transport) {\n  await transport.send(\`event:\${event.id}\`)\n}\n`,
    },
  },
]

function main() {
  const before = manifest(taskDir)
  const tempRoot = join(tmpdir(), `jw-mutation-${Date.now()}-${process.pid}`)
  mkdirSync(tempRoot, { recursive: true })
  const workDir = join(tempRoot, "task")
  const receipt = {
    schemaVersion: "warden.mutation-receipt/0.1",
    at: Date.now(),
    isolation: "filesystem copy under the OS temp directory; not an OS sandbox",
    environment: { node: process.version, platform: process.platform },
    task: { path: taskDir, files: before },
    baseline: null,
    mutations: [],
    cleanup: { removed: false, onlyOwnedDirectory: true },
    mainUnchanged: false,
  }
  try {
    cpSync(taskDir, workDir, { recursive: true })
    const baseline = runTests(workDir)
    receipt.baseline = {
      exitCode: baseline.exitCode,
      durationMs: baseline.durationMs,
      passed: baseline.exitCode === 0,
    }
    for (const mutation of MUTATIONS) {
      cpSync(taskDir, workDir, { recursive: true, force: true }) // reset to the snapshot between runs
      for (const [relativePath, content] of Object.entries(mutation.files)) {
        writeFileSync(join(workDir, relativePath), content)
      }
      const run = runTests(workDir)
      receipt.mutations.push({
        id: mutation.id,
        kind: mutation.kind,
        exitCode: run.exitCode,
        durationMs: run.durationMs,
        classification: classify(run),
      })
    }
  } finally {
    rmSync(tempRoot, { recursive: true, force: true })
    receipt.cleanup.removed = !existsSync(tempRoot)
    void rmdirSync
  }
  receipt.mainUnchanged = JSON.stringify(before) === JSON.stringify(manifest(taskDir))
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, JSON.stringify(receipt, null, 2) + "\n")
  console.log(JSON.stringify({ out: outPath, baseline: receipt.baseline, mutations: receipt.mutations, mainUnchanged: receipt.mainUnchanged }, null, 2))
}

main()
