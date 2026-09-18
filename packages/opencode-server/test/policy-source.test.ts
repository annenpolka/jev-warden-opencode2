import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createPolicyLoader, policyDigest } from "../src/policy-source.ts"
import { validatePolicyBundle } from "@jev-warden/core"

function validBundle(): ReturnType<typeof validatePolicyBundle> {
  return validatePolicyBundle({
    schemaVersion: "warden.policy/0.1",
    id: "candidate-specific-definition-guidance-v1",
    status: "candidate",
    scope: { kind: "project", projectRef: "project-under-test" },
    compatibility: { coreContract: "warden.core/0.1", requiredCapabilities: ["source.read", "context.guidance"] },
    selectors: [{ id: "registered-definition-selector", options: { followReferencedConstants: true, maxFiles: 6 } }],
    probes: [
      {
        id: "p",
        type: "noul",
        instructions: "Is the definition visible?",
        inputs: ["test_code", "definitions"],
        role: "specific-evidence-sufficiency",
      },
    ],
    guidance: { kind: "definition-needed", delivery: "advisory", maxItems: 2, repeatOnlyOnNewEvidence: true },
    promotion: { evaluationPolicyRef: "fixed-evaluation-policy-1", reportRefs: [] },
  })
}

function withFile(contents: unknown, run: (path: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), "jw-policy-"))
  try {
    const path = join(dir, "active.json")
    writeFileSync(path, JSON.stringify(contents))
    run(path)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test("policy source: a valid active bundle is loaded with its digest and guidance flag", () => {
  const bundle = validBundle()
  withFile(
    { schemaVersion: "warden.active-policy/0.1", bundleId: bundle.id, digest: policyDigest(bundle), revokedDigests: [], bundle },
    (path) => {
      const loaded = createPolicyLoader(path).load()
      assert.equal(loaded.source, "file")
      assert.equal(loaded.bundle?.id, bundle.id)
      assert.equal(loaded.digest, policyDigest(bundle))
      assert.equal(loaded.guidanceEnabled, true)
      assert.equal(loaded.error, undefined)
    },
  )
})

test("policy source: digest mismatch falls back to baseline", () => {
  const bundle = validBundle()
  withFile({ bundleId: bundle.id, digest: "0".repeat(64), revokedDigests: [], bundle }, (path) => {
    const loaded = createPolicyLoader(path).load()
    assert.equal(loaded.source, "baseline")
    assert.equal(loaded.error, "policy_digest_mismatch")
    assert.equal(loaded.guidanceEnabled, false)
  })
})

test("policy source: a revoked digest falls back to baseline and reports the revocation", () => {
  const bundle = validBundle()
  withFile(
    { bundleId: bundle.id, digest: policyDigest(bundle), revokedDigests: [policyDigest(bundle)], bundle },
    (path) => {
      const loaded = createPolicyLoader(path).load()
      assert.equal(loaded.source, "baseline")
      assert.equal(loaded.error, "policy_revoked")
      assert.deepEqual(loaded.revoked, [policyDigest(bundle)])
    },
  )
})

test("policy source: a retired or executable bundle is never applied", () => {
  const retired = { ...validBundle(), status: "retired" as const }
  withFile({ bundleId: retired.id, digest: policyDigest(retired), revokedDigests: [], bundle: retired }, (path) => {
    const loaded = createPolicyLoader(path).load()
    assert.equal(loaded.source, "baseline")
    assert.equal(loaded.error, "policy_status_retired")
  })
  const executable = { ...validBundle(), exec: "rm -rf /" }
  withFile({ bundleId: executable.id, digest: "x", revokedDigests: [], bundle: executable }, (path) => {
    const loaded = createPolicyLoader(path).load()
    assert.equal(loaded.source, "baseline")
    assert.match(loaded.error ?? "", /^policy_bundle_invalid:/)
  })
})

test("policy source: a missing file is baseline with an error, not a throw", () => {
  const loader = createPolicyLoader("/nonexistent-policy-file.json")
  const loaded = loader.load()
  assert.equal(loaded.source, "baseline")
  assert.equal(loaded.error, "policy_file_missing")
  assert.equal(loader.describe().source, "baseline")
})
