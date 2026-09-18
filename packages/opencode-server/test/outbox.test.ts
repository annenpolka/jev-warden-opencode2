import { test } from "node:test"
import assert from "node:assert/strict"
import { resolveOutboxPath } from "../src/outbox.ts"
import { parseOptions } from "../src/options.ts"

test("outbox: null requested means no outbox", () => {
  const resolved = resolveOutboxPath("/project", null, false)
  assert.equal(resolved.path, null)
  assert.equal(resolved.skippedInsideLocation, false)
})

test("outbox: inside-location path is refused by default and allowed with explicit opt-in", () => {
  const refused = resolveOutboxPath("/project", ".warden/outbox.jsonl", false)
  assert.equal(refused.path, null)
  assert.equal(refused.skippedInsideLocation, true)
  const allowed = resolveOutboxPath("/project", ".warden/outbox.jsonl", true)
  assert.equal(allowed.path, "/project/.warden/outbox.jsonl")
  assert.equal(allowed.skippedInsideLocation, false)
})

test("outbox: an absolute path outside the location is accepted", () => {
  const resolved = resolveOutboxPath("/project", "/var/state/jev-warden/outbox.jsonl", false)
  assert.equal(resolved.path, "/var/state/jev-warden/outbox.jsonl")
  assert.equal(resolved.skippedInsideLocation, false)
})

test("outbox: a sibling path with a shared prefix is not treated as inside", () => {
  const resolved = resolveOutboxPath("/project", "/project-other/outbox.jsonl", false)
  assert.equal(resolved.path, "/project-other/outbox.jsonl")
  assert.equal(resolved.skippedInsideLocation, false)
})

test("options: outbox and allowOutboxInLocation are parsed and validated", () => {
  const parsed = parseOptions({ outboxPath: ".warden/outbox.jsonl", allowOutboxInLocation: true })
  assert.equal(parsed.errors.length, 0)
  assert.equal(parsed.options.outboxPath, ".warden/outbox.jsonl")
  assert.equal(parsed.options.allowOutboxInLocation, true)
  const bad = parseOptions({ allowOutboxInLocation: "yes" })
  assert.equal(bad.errors.length, 1)
  assert.equal(bad.options.allowOutboxInLocation, false)
})
