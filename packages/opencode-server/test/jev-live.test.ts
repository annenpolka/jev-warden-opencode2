import { test } from "node:test"
import assert from "node:assert/strict"
import { createLiveJev, redact, type JevQuestion } from "../src/jev-live.ts"

const questions: Record<string, JevQuestion> = {
  visible: {
    type: "noul",
    instructions: "Is the value visible?",
    criteria: { true: "visible", false: "not visible" },
  },
}

function fetchReturning(body: unknown, status = 200): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })) as typeof fetch
}

function options(overrides: Record<string, unknown> = {}) {
  return {
    endpoint: "https://example.invalid/v1/systemone",
    model: "jev-latest",
    timeoutMs: 1000,
    maxRequests: 2,
    maxStateBytes: 4096,
    keyReader: async () => ({ key: "test-key-value" }),
    ...overrides,
  }
}

test("live jev: completed noul answer is parsed with digests and usage", async () => {
  const jev = createLiveJev(options({
    fetchImpl: fetchReturning({
      model: "jev-1.13.0",
      answers: { visible: { type: "noul", noul: 0.88 } },
      usage: { input_tokens: 100, output_tokens: 5 },
    }),
  }))
  const result = await jev.evaluate({ a: "x" }, questions)
  assert.equal(result.status, "completed")
  assert.equal(result.model, "jev-1.13.0")
  assert.deepEqual(result.answers?.visible, { type: "noul", noul: 0.88 })
  assert.equal(result.usage?.inputTokens, 100)
  assert.match(result.requestDigest, /^[0-9a-f]{64}$/)
  assert.equal(jev.requestsUsed, 1)
  assert.equal(jev.requestsRemaining, 1)
})

test("live jev: out-of-range noul is invalid_response, never normalised", async () => {
  const jev = createLiveJev(options({
    fetchImpl: fetchReturning({ answers: { visible: { type: "noul", noul: 1.4 } } }),
  }))
  const result = await jev.evaluate({ a: "x" }, questions)
  assert.equal(result.status, "invalid_response")
  assert.equal(result.error, "answer_invalid:visible")
  assert.equal(result.answers, undefined)
  assert.match(result.rawSample ?? "", /1\.4/)
})

test("live jev: missing answer and wrong type are invalid_response", async () => {
  const missing = createLiveJev(options({ fetchImpl: fetchReturning({ answers: {} }) }))
  assert.equal((await missing.evaluate({ a: "x" }, questions)).status, "invalid_response")
  const wrongType = createLiveJev(options({
    fetchImpl: fetchReturning({ answers: { visible: { type: "score", score: 1 } } }),
  }))
  assert.equal((await wrongType.evaluate({ a: "x" }, questions)).status, "invalid_response")
})

test("live jev: choice probabilities must be finite, non-negative and sum to one", async () => {
  const good = createLiveJev(options({
    fetchImpl: fetchReturning({
      answers: { visible: { type: "noul", noul: 0.5 } },
    }),
  }))
  assert.equal((await good.evaluate({ a: "x" }, questions)).status, "completed")
  const choiceQuestions: Record<string, JevQuestion> = { pick: { type: "choice", instructions: "p", options: ["x", "y"] } }
  const bad = createLiveJev(options({ fetchImpl: fetchReturning({ answers: { pick: { type: "choice", choice: "x", probabilities: { x: 0.5, y: 0.2 } } } }) }))
  assert.equal((await bad.evaluate({ a: "x" }, choiceQuestions)).status, "invalid_response")
  const ok = createLiveJev(options({ fetchImpl: fetchReturning({ answers: { pick: { type: "choice", choice: "x", probabilities: { x: 0.7, y: 0.3 } } } }) }))
  assert.equal((await ok.evaluate({ a: "x" }, choiceQuestions)).status, "completed")
})

test("live jev: http failure is unavailable and keeps the status", async () => {
  const jev = createLiveJev(options({ fetchImpl: fetchReturning({ error: "rate limited" }, 429) }))
  const result = await jev.evaluate({ a: "x" }, questions)
  assert.equal(result.status, "unavailable")
  assert.match(result.error ?? "", /^http_429:/)
})

test("live jev: missing key never calls the network", async () => {
  let called = 0
  const jev = createLiveJev(options({
    keyReader: async () => ({ key: null, error: "key_store_lookup_failed" }),
    fetchImpl: (async () => {
      called += 1
      return new Response("{}")
    }) as typeof fetch,
  }))
  const result = await jev.evaluate({ a: "x" }, questions)
  assert.equal(result.status, "unavailable")
  assert.equal(result.error, "key_store_lookup_failed")
  assert.equal(called, 0)
  assert.equal(jev.requestsUsed, 0)
})

test("live jev: budget stops calls before they leave the process", async () => {
  let called = 0
  const jev = createLiveJev(options({
    maxRequests: 1,
    fetchImpl: (async () => {
      called += 1
      return new Response(JSON.stringify({ answers: { visible: { type: "noul", noul: 0.5 } } }))
    }) as typeof fetch,
  }))
  assert.equal((await jev.evaluate({ a: "x" }, questions)).status, "completed")
  const second = await jev.evaluate({ a: "x" }, questions)
  assert.equal(second.status, "budget_exhausted")
  assert.equal(called, 1)
})

test("live jev: oversized state is rejected locally", async () => {
  let called = 0
  const jev = createLiveJev(options({
    maxStateBytes: 16,
    fetchImpl: (async () => {
      called += 1
      return new Response("{}")
    }) as typeof fetch,
  }))
  const result = await jev.evaluate({ a: "x".repeat(100) }, questions)
  assert.equal(result.status, "invalid_response")
  assert.equal(result.error, "state_too_large")
  assert.equal(called, 0)
})

test("live jev: redact removes long token-like strings from errors", () => {
  assert.equal(redact("failed with abcdefghijklmnopqrstuvwxyz0123456789"), "failed with [redacted]")
  assert.equal(redact("short ok"), "short ok")
})
