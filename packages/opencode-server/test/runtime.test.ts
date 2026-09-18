import { test } from "node:test"
import assert from "node:assert/strict"
import { parseOptions } from "../src/options.ts"
import { BASELINE_POLICY_DIGEST, BASELINE_POLICY_ID, WardenRuntime } from "../src/runtime.ts"

function runtime(): WardenRuntime {
  return new WardenRuntime({
    options: parseOptions({}).options,
    optionErrors: [],
    locationDirectory: "/tmp/unit",
    projectId: "proj",
    worktreeId: "wt",
  })
}

test("runtime: session events without a verified location mark location-derived fields unresolved", () => {
  const rt = runtime()
  const sessionEvent = rt.record({ type: "prompt.observed", sessionId: "ses_a" })
  assert.deepEqual(sessionEvent.unresolvedFields, ["projectId", "worktreeId"])
  const verified = rt.record({ type: "session.located", sessionId: "ses_a", hostLocationVerified: true })
  assert.equal(verified.unresolvedFields, undefined)
  const unscoped = rt.record({ type: "plugin.tick" })
  assert.equal(unscoped.unresolvedFields, undefined)
  assert.equal(rt.debugSummary().unresolvedScopeEvents, 1)
})

test("runtime: the baseline policy is pinned per session and recorded on its envelopes", () => {
  const rt = runtime()
  const pin = rt.bindSessionPin({ sessionId: "ses_a" })
  assert.equal(pin.policyId, BASELINE_POLICY_ID)
  assert.equal(pin.policyDigest, BASELINE_POLICY_DIGEST)
  const event = rt.record({ type: "prompt.observed", sessionId: "ses_a" })
  assert.equal(event.policyId, BASELINE_POLICY_ID)
  assert.equal(event.policyDigest, BASELINE_POLICY_DIGEST)
  // An explicit policy on the input wins over the pin.
  const explicit = rt.record({ type: "prompt.observed", sessionId: "ses_a", policyId: "other", policyDigest: "d" })
  assert.equal(explicit.policyId, "other")
  // A different session starts unpinned.
  const other = rt.record({ type: "prompt.observed", sessionId: "ses_b" })
  assert.equal(other.policyId, undefined)
  assert.equal(rt.debugSummary().pinnedSessions, 1)
})

test("runtime: the pin is stable across agent switches within a session", () => {
  const rt = runtime()
  rt.bindSessionPin({ sessionId: "ses_a", agentId: "build" })
  const plan = rt.pinFor({ sessionId: "ses_a", agentId: "plan" })
  assert.equal(plan?.policyId, BASELINE_POLICY_ID)
  assert.equal(rt.debugSummary().pinnedSessions, 1)
})
