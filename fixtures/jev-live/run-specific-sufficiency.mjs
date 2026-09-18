#!/usr/bin/env node
/**
 * Specific-sufficiency episode runner.
 *
 * Reproduces the first Warden "one thread" against live Jev:
 *   1. judge a test snippet whose expected-value definition is not shown;
 *   2. retrieve the definition through a scope-checked source read;
 *   3. re-judge with the definition present;
 *   4. record an Episode that separates decision-time inputs from the later
 *      outcome, stores raw probabilities, and labels the claim as a weak model
 *      label rather than acceptance.
 *
 * Without --live it reuses the responses already obtained through the
 * jev-crosscheck helper, so the episode can be rebuilt without new calls.
 *
 * Usage:
 *   node fixtures/jev-live/run-specific-sufficiency.mjs --live \
 *     --out checks/jev-live/2026-09-18-specific-sufficiency/episode-live.json
 */
import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { createLiveJev, DEFAULT_ENDPOINT, DEFAULT_MODEL, macOsKeychainReader } from "../../packages/opencode-server/src/jev-live.ts"

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

const fixtureDir = resolve(process.cwd(), args.fixture ?? "checks/jev-live/2026-09-18-specific-sufficiency")
const outPath = resolve(process.cwd(), args.out ?? join(fixtureDir, "episode.json"))
const live = args.live === "true"
const maxRequests = Number(args["max-requests"] ?? 8)

const questions = {
  expected_calls_value_visible: {
    type: "noul",
    instructions:
      "Do `test_code` and `definitions` state the actual value that EXPECTED_CALLS has, directly rather than only by the constant name?",
    criteria: {
      true: "The material contains the definition of EXPECTED_CALLS together with its value",
      false: "The definition or its value is absent, or only the name is shown",
    },
  },
  expected_total_is_three: {
    type: "noul",
    instructions:
      "Do `test_code` and `definitions` support the statement that the expected total number of recorded calls asserted by the test is 3?",
    criteria: {
      true: "The value 3 can be read from the shown material as the expected total",
      false: "The expected total cannot be determined as 3 from the shown material",
    },
  },
}

const sha256 = (value) => createHash("sha256").update(value).digest("hex")

function readFixture(relative) {
  const path = join(fixtureDir, relative)
  const canonical = resolve(path)
  if (!canonical.startsWith(resolve(fixtureDir))) throw new Error(`fixture read escaped the declared scope: ${relative}`)
  return { content: readFileSync(canonical, "utf8"), path: canonical }
}

/** Minimal scope-checked source read for the synthetic fixture. */
function retrieveDefinition() {
  const read = readFixture("b-with-definition/definitions.txt")
  const lines = read.content.split("\n")
  const lineIndex = lines.findIndex((line) => line.includes("EXPECTED_CALLS = 3"))
  if (lineIndex < 0) throw new Error("definition line was not found in the retrieved source")
  return {
    at: Date.now(),
    sourceRef: `fixture:${relative(read.path)}`,
    digest: sha256(read.content),
    lineRef: `L${lineIndex + 1}`,
    excerpt: lines[lineIndex].trim(),
    inspectedScope: "complete_declared_scope",
    hasMissingReference: false,
    content: read.content,
  }
}

const relative = (path) => path.slice(repoRoot.length + 1)

async function judge(state, label) {
  if (!live) {
    const variant = label === "a" ? "a-missing-definition" : "b-with-definition"
    const response = JSON.parse(readFileSync(join(fixtureDir, variant, "response.json"), "utf8"))
    return {
      source: "crosscheck_helper_response",
      status: "completed",
      model: response.model,
      answers: response.answers,
      usage: response.usage,
      at: Date.now(),
    }
  }
  const jev = createLiveJev({
    endpoint: process.env.TYPESAFE_BASE_URL ?? DEFAULT_ENDPOINT,
    model: DEFAULT_MODEL,
    timeoutMs: 60_000,
    maxRequests,
    maxStateBytes: 32 * 1024,
    keyReader: macOsKeychainReader(),
  })
  const result = await jev.evaluate(state, questions)
  writeFileSync(join(fixtureDir, `transport-${label}.json`), JSON.stringify(result, null, 2) + "\n")
  writeFileSync(join(fixtureDir, `state-${label}.json`), JSON.stringify(state, null, 2) + "\n")
  return {
    source: "warden_live_transport",
    status: result.status,
    ...(result.model === undefined ? {} : { model: result.model }),
    ...(result.answers === undefined ? {} : { answers: result.answers }),
    ...(result.usage === undefined ? {} : { usage: result.usage }),
    ...(result.error === undefined ? {} : { error: result.error }),
    requestDigest: result.requestDigest,
    stateDigest: result.stateDigest,
    questionsDigest: result.questionsDigest,
    at: result.startedAt,
    requestsUsed: jev.requestsUsed,
  }
}

const noul = (observation, name) => {
  const answer = observation.answers?.[name]
  return answer?.type === "noul" ? answer.noul : null
}

async function main() {
  const testCode = readFixture("test_code.txt").content
  const definitionsMissing = readFixture("a-missing-definition/definitions.txt").content

  const observationA = await judge(
    { test_code: testCode, definitions: definitionsMissing },
    "a",
  )
  if (observationA.status !== "completed") {
    console.warn(`initial judgment did not complete: ${observationA.status} ${observationA.error ?? ""}`)
  }
  const retrieval = retrieveDefinition()
  const observationB = await judge(
    { test_code: testCode, definitions: retrieval.content },
    "b",
  )

  const sufficiencyA = noul(observationA, "expected_calls_value_visible")
  const claimA = noul(observationA, "expected_total_is_three")
  const sufficiencyB = noul(observationB, "expected_calls_value_visible")
  const claimB = noul(observationB, "expected_total_is_three")

  const gapConfirmed =
    sufficiencyA !== null && sufficiencyB !== null && sufficiencyA < 0.5 && sufficiencyB >= 0.5
  const claimSupportedAfterDefinition =
    claimA !== null && claimB !== null && claimA < 0.5 && claimB >= 0.5

  const episode = {
    schemaVersion: "warden.episode/0.1",
    episodeId: `ep_specific_sufficiency_${sha256(JSON.stringify({ test_code: testCode, retrieval: retrieval.digest })).slice(0, 12)}`,
    mode: live ? "live" : "replay",
    decisionTime: {
      at: observationA.at,
      definitionPresent: false,
      observation: observationA,
      inputs: {
        testCodeDigest: sha256(testCode),
        definitionsDigest: sha256(definitionsMissing),
        questionsDigest: sha256(JSON.stringify(questions)),
      },
      sufficiency: sufficiencyA,
      claim: claimA,
    },
    retrieval: {
      at: retrieval.at,
      sourceRef: retrieval.sourceRef,
      digest: retrieval.digest,
      lineRef: retrieval.lineRef,
      excerpt: retrieval.excerpt,
      inspectedScope: retrieval.inspectedScope,
      hasMissingReference: retrieval.hasMissingReference,
    },
    outcome: {
      at: observationB.at,
      definitionPresent: true,
      observation: observationB,
      sufficiency: sufficiencyB,
      claim: claimB,
    },
    resolution: {
      state: gapConfirmed ? "definition_gap_confirmed" : "inconclusive",
      claimLabel: claimSupportedAfterDefinition ? "supported_after_definition" : "unchanged_or_contradicted",
      labelSource: "weak_model_label",
      note:
        "Probabilities are not acceptance. The definition value in the fixture is authored synthetic material, " +
        "not an independent source of truth.",
    },
  }

  writeFileSync(outPath, JSON.stringify(episode, null, 2) + "\n")
  console.log(JSON.stringify({
    mode: episode.mode,
    out: relative(outPath),
    sufficiencyA,
    claimA,
    retrieval: `${retrieval.sourceRef}#${retrieval.lineRef}`,
    sufficiencyB,
    claimB,
    resolution: episode.resolution.state,
  }, null, 2))
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error))
  process.exitCode = 1
})
