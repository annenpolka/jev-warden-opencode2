import { test } from "node:test"
import assert from "node:assert/strict"
import { notifyUser } from "../src/notify.mjs"

// Contract: one notification per event. A concrete wrong implementation sends
// twice; an implementation change that keeps one send per event must pass.
test("notifies once per event", async () => {
  const calls = []
  await notifyUser({ id: "e1" }, { send: async (message) => calls.push(message) })
  assert.equal(calls.length, 1)
})
