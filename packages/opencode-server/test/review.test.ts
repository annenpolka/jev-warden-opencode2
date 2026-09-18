import { test } from "node:test"
import assert from "node:assert/strict"
import { parseOptions } from "../src/options.ts"
import { ReviewLedger, requestReview } from "../src/review.ts"
import { WardenRuntime } from "../src/runtime.ts"
import type { LiveJev } from "../src/jev-live.ts"

function runtime(): WardenRuntime {
  return new WardenRuntime({
    options: parseOptions({}).options,
    optionErrors: [],
    locationDirectory: "/tmp/unit",
    projectId: "proj",
    worktreeId: "wt",
  })
}

function fakeTransport(result: Awaited<ReturnType<LiveJev["evaluate"]>>): { transport: LiveJev; calls: number } {
  const state = { calls: 0 }
  return {
    get calls() {
      return state.calls
    },
    transport: {
      evaluate: async () => {
        state.calls += 1
        return result
      },
      get requestsUsed() {
        return state.calls
      },
      get requestsRemaining() {
        return 99
      },
    } as LiveJev,
  }
}

const completedResult = {
  status: "completed" as const,
  model: "jev-test",
  answers: { expected_calls_value_visible: { type: "noul" as const, noul: 0.04 } },
  requestDigest: "a".repeat(64),
  stateDigest: "b".repeat(64),
  questionsDigest: "c".repeat(64),
  startedAt: 1,
  finishedAt: 2,
}

const validInput = {
  sessionID: "ses_unit",
  probeID: "specific-sufficiency.expected-calls-definition",
  state: { test_code: "expect(calls.length).toBe(EXPECTED_CALLS)", definitions: "export const other = 1" },
}

test("review: unknown probe is rejected without a network call", async () => {
  const ledger = new ReviewLedger()
  const fake = fakeTransport(completedResult)
  const output = await requestReview({ runtime: runtime(), transport: fake.transport, ledger }, {
    probeID: "not-a-probe",
    state: {},
  })
  assert.equal(output.status, "rejected")
  assert.equal(output.error, "unknown_probe")
  assert.equal(fake.calls, 0)
})

test("review: disabled Jev is rejected without a network call", async () => {
  const ledger = new ReviewLedger()
  const output = await requestReview({ runtime: runtime(), transport: null, ledger }, validInput)
  assert.equal(output.status, "rejected")
  assert.equal(output.error, "jev_disabled")
})

test("review: missing required state key is rejected", async () => {
  const ledger = new ReviewLedger()
  const fake = fakeTransport(completedResult)
  const output = await requestReview({ runtime: runtime(), transport: fake.transport, ledger }, {
    probeID: validInput.probeID,
    state: { test_code: "x" },
  })
  assert.equal(output.status, "rejected")
  assert.match(output.error ?? "", /^missing_state_key:definitions/)
  assert.equal(fake.calls, 0)
})

test("review: credential-shaped state is rejected and only the category is recorded", async () => {
  const ledger = new ReviewLedger()
  const fake = fakeTransport(completedResult)
  const secret = `api_key = "${"z".repeat(24)}"`
  const output = await requestReview({ runtime: runtime(), transport: fake.transport, ledger }, {
    ...validInput,
    state: { test_code: "x", definitions: secret },
  })
  assert.equal(output.status, "rejected")
  assert.match(output.error ?? "", /^credential_pattern:/)
  assert.equal(fake.calls, 0)
  const recorded = JSON.stringify(ledger.list())
  assert.equal(recorded.includes("z".repeat(24)), false)
})

test("review: completed observation is recorded with raw probabilities and counters", async () => {
  const rt = runtime()
  const ledger = new ReviewLedger()
  const fake = fakeTransport(completedResult)
  const output = await requestReview({ runtime: rt, transport: fake.transport, ledger }, validInput)
  assert.equal(output.status, "completed")
  assert.equal(output.model, "jev-test")
  assert.deepEqual(output.answers, completedResult.answers)
  assert.equal(rt.status().counters.jevObservations, 1)
  assert.equal(ledger.size, 1)
  assert.equal(ledger.list()[0]?.status, "completed")
})

test("review: transport failure keeps the status and counts as rejected", async () => {
  const rt = runtime()
  const ledger = new ReviewLedger()
  const fake = fakeTransport({
    status: "unavailable",
    model: "jev-test",
    error: "key_store_lookup_failed",
    requestDigest: "d".repeat(64),
    stateDigest: "e".repeat(64),
    questionsDigest: "f".repeat(64),
    startedAt: 1,
    finishedAt: 2,
  })
  const output = await requestReview({ runtime: rt, transport: fake.transport, ledger }, validInput)
  assert.equal(output.status, "unavailable")
  assert.equal(output.error, "key_store_lookup_failed")
  assert.equal(rt.status().counters.jevRejected, 1)
  assert.equal(ledger.list()[0]?.status, "unavailable")
})
