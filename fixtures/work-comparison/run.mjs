#!/usr/bin/env node
/**
 * Bounded work comparison: control / Warden observe-only / Warden + guidance.
 *
 * A fixed task is solved by a real model in a scratch project. The guidance
 * arm injects one operator-fixed advisory line through Warden's context hook;
 * the baseline arm runs Warden observe-only; the control arm runs without
 * Warden. Correctness is scored by a deterministic sentinel (`ANSWER: <n>`),
 * separately from the Jev judgment measurements.
 *
 * Adoption thresholds are pre-registered here. With a small number of trials
 * the harness reports `hold`, not adoption.
 *
 * Usage:
 *   node fixtures/work-comparison/run.mjs --model deepseek/deepseek-flash --trials 2
 */
import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { policyDigestInput, validatePolicyBundle } from "../../packages/core/src/index.ts"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, "../..")

const args = {}
for (let index = 0; index < process.argv.length; index += 1) {
  const token = process.argv[index]
  if (!token.startsWith("--")) continue
  const key = token.slice(2)
  const next = process.argv[index + 1]
  if (next !== undefined && !next.startsWith("--")) {
    args[key] = next
    index += 1
  } else {
    args[key] = "true"
  }
}

const model = args.model ?? "deepseek/deepseek-flash"
const trials = Number(args.trials ?? 2)
const timeoutMs = Number(args.timeout ?? 180_000)
const expected = "3"
const MIN_TRIALS_FOR_ADOPTION = 8

const GUIDANCE = "The constant EXPECTED_CALLS is defined in config/limits.ts."
const QUESTION =
  "Read the project in the current directory, then answer: what is the expected total number of " +
  "notifications asserted by the test? End your reply with a line exactly: ANSWER: <integer>"

const ARMS = [
  { arm: "control", warden: null },
  { arm: "baseline", warden: { mode: "observe" } },
  { arm: "candidate", warden: { mode: "observe", advisoryNote: GUIDANCE } },
]

function writeFixture(dir) {
  mkdirSync(join(dir, "src"), { recursive: true })
  mkdirSync(join(dir, "test"), { recursive: true })
  mkdirSync(join(dir, "config"), { recursive: true })
  // A small but non-trivial tree: the constant is not in the test file, and
  // finding it takes a few reads unless the guidance points at it.
  writeFileSync(
    join(dir, "test/notify.test.ts"),
    `import { test, expect } from "vitest"\n` +
      `import { notifyUser } from "../src/notify"\n\n` +
      `test("notifies once per event", async () => {\n` +
      `  const calls: string[] = []\n` +
      `  await notifyUser({ id: "e1" }, { send: async (message) => calls.push(message) })\n` +
      `  expect(calls.length).toBe(EXPECTED_CALLS)\n` +
      `})\n`,
  )
  writeFileSync(join(dir, "config/limits.ts"), `export const EXPECTED_CALLS = ${expected}\n`)
  writeFileSync(
    join(dir, "src/notify.ts"),
    `export async function notifyUser(\n` +
      `  event: { id: string },\n` +
      `  transport: { send: (message: string) => Promise<void> },\n` +
      `) {\n` +
      `  await transport.send(\`event:\${event.id}\`)\n` +
      `}\n`,
  )
  for (let index = 0; index < 14; index += 1) {
    mkdirSync(join(dir, "src/modules"), { recursive: true })
    writeFileSync(
      join(dir, "src/modules", `module-${index}.ts`),
      `export const MODULE_${index} = ${index}\nexport function helper${index}(value: number) {\n  return value + ${index}\n}\n`,
    )
  }
  writeFileSync(join(dir, "config/runtime.ts"), "export const RUNTIME_TIMEOUT_MS = 5000\n")
  writeFileSync(join(dir, "config/retry.ts"), "export const RETRY_LIMIT = 4\n")
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "work-comparison-fixture", private: true, type: "module" }, null, 2) + "\n",
  )
}

function writeConfig(dir, wardenOptions) {
  const plugins =
    wardenOptions === null
      ? []
      : [
          {
            package: join(repoRoot, "packages/opencode-server"),
            options: { outboxPath: join(dir, ".warden/outbox.jsonl"), ...wardenOptions },
          },
        ]
  writeFileSync(
    join(dir, "opencode.json"),
    JSON.stringify({ $schema: "https://opencode.ai/config.json", plugins }, null, 2) + "\n",
  )
}

function runOnce(dir) {
  return new Promise((resolvePromise) => {
    const startedAt = Date.now()
    const proc = spawn(
      "opencode",
      ["run", "--standalone", "--auto", "--format", "json", "--model", model, "--title", "work-comparison", QUESTION],
      { cwd: dir, env: { ...process.env, OPENCODE_DISABLE_AUTOUPDATE: "1" }, stdio: ["ignore", "pipe", "pipe"] },
    )
    let stdout = ""
    let stderr = ""
    const timer = setTimeout(() => proc.kill("SIGKILL"), timeoutMs)
    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString()
    })
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString()
    })
    proc.on("close", (code) => {
      clearTimeout(timer)
      let toolCalls = 0
      let text = ""
      let sessionID = null
      for (const line of stdout.split("\n")) {
        if (line.trim().length === 0) continue
        let event
        try {
          event = JSON.parse(line)
        } catch {
          continue
        }
        if (typeof event.sessionID === "string") sessionID = event.sessionID
        if (event.type === "tool_use") toolCalls += 1
        if (event.type === "text" && typeof event.part?.text === "string") text += event.part.text
      }
      const match = text.match(/ANSWER:\s*(\d+)/)
      resolvePromise({
        exitCode: code,
        sessionID,
        answer: match === null ? null : Number(match[1]),
        correct: match !== null && Number(match[1]) === Number(expected),
        toolCalls,
        durationMs: Date.now() - startedAt,
        outputSample: text.slice(-400),
        ...(code === 0 ? {} : { errorSample: stderr.slice(-300) }),
      })
    })
  })
}

async function main() {
  const results = []
  for (const { arm, warden } of ARMS) {
    for (let trial = 1; trial <= trials; trial += 1) {
      const dir = mkdtempSync(join(tmpdir(), `jw-work-${arm}-`))
      try {
        writeFixture(dir)
        writeConfig(dir, warden)
        const run = await runOnce(dir)
        results.push({ arm, trial, ...run })
        process.stderr.write(
          `  [${arm} #${trial}] correct=${run.correct} answer=${run.answer} ${run.durationMs}ms exit=${run.exitCode}\n`,
        )
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    }
  }

  const byArm = {}
  for (const { arm } of ARMS) {
    const runs = results.filter((entry) => entry.arm === arm)
    const correct = runs.filter((entry) => entry.correct).length
    byArm[arm] = {
      trials: runs.length,
      correct,
      accuracy: runs.length === 0 ? null : correct / runs.length,
      meanDurationMs: runs.length === 0 ? null : Math.round(runs.reduce((sum, entry) => sum + entry.durationMs, 0) / runs.length),
      meanToolCalls: runs.length === 0 ? null : Number((runs.reduce((sum, entry) => sum + entry.toolCalls, 0) / runs.length).toFixed(2)),
    }
  }
  const control = byArm.control.accuracy
  const baseline = byArm.baseline.accuracy
  const candidate = byArm.candidate.accuracy
  const improvement = candidate !== null && baseline !== null ? candidate - baseline : null
  const nonInferior = candidate !== null && baseline !== null ? candidate >= baseline : null
  const enoughTrials = trials >= MIN_TRIALS_FOR_ADOPTION
  const toolCallsBetter =
    byArm.candidate.meanToolCalls !== null && byArm.baseline.meanToolCalls !== null
      ? byArm.candidate.meanToolCalls < byArm.baseline.meanToolCalls
      : null
  const promotionRecommended = enoughTrials && nonInferior === true && toolCallsBetter === true

  const candidateIdentity =
    args.candidate === undefined
      ? null
      : (() => {
          const bundle = validatePolicyBundle(JSON.parse(readFileSync(resolve(process.cwd(), args.candidate), "utf8")))
          const digest = createHash("sha256").update(policyDigestInput(bundle)).digest("hex")
          return { id: bundle.id, digest, guidance: bundle.guidance.kind }
        })()

  const decision = {
    schemaVersion: "warden.work-comparison/0.1",
    at: Date.now(),
    model,
    task: "find the constant referenced by the test and report the expected notification count",
    expected,
    guidance: GUIDANCE,
    ...(candidateIdentity === null ? {} : { candidate: candidateIdentity }),
    preRegistered: {
      primaryMetric: "correctness (ANSWER == expected)",
      secondaryMetric: "mean tool calls",
      adoptionRule: "candidate correct >= baseline correct AND candidate mean tool calls < baseline mean tool calls, at >= 8 trials per arm",
      minTrialsForAdoption: MIN_TRIALS_FOR_ADOPTION,
    },
    byArm,
    comparison: {
      candidateMinusBaselineAccuracy: improvement,
      nonInferior,
      toolCallsBetter,
      improvementObserved: improvement !== null && improvement > 0,
      enoughTrials,
    },
    promotionRecommended,
    decision: !enoughTrials
      ? "hold"
      : nonInferior === false
        ? "reject"
        : promotionRecommended
          ? "promote_recommended"
          : "hold",
    reason: !enoughTrials
      ? `only ${trials} trials per arm; adoption requires at least ${MIN_TRIALS_FOR_ADOPTION}`
      : nonInferior === false
        ? "candidate accuracy was lower than baseline"
        : promotionRecommended
          ? "correctness was non-inferior and mean tool calls were lower than baseline"
          : "correctness was non-inferior but the secondary metric did not improve",
  }

  const outDir = resolve(process.cwd(), args.out ?? `checks/work-comparison/${new Date().toISOString().slice(0, 10)}`)
  mkdirSync(outDir, { recursive: true })
  writeFileSync(
    join(outDir, "results.json"),
    JSON.stringify({ model, trials, candidate: candidateIdentity, results }, null, 2) + "\n",
  )
  writeFileSync(join(outDir, "decision.json"), JSON.stringify(decision, null, 2) + "\n")
  console.log(JSON.stringify({ outDir, byArm, decision: decision.decision, reason: decision.reason }, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error))
  process.exitCode = 1
})
