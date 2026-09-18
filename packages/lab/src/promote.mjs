#!/usr/bin/env node
/**
 * Automated promotion step.
 *
 * Reads a work-comparison decision and a candidate bundle. If the decision
 * recommends promotion for exactly this bundle (enough trials, matching id and
 * digest), the candidate is stored, the pointer moves, and the active-policy
 * file is exported. Otherwise a `hold` entry is appended to policy history and
 * the pointer stays put.
 *
 * Usage:
 *   node packages/lab/src/promote.mjs --db .warden/lab.db \
 *     --decision checks/work-comparison/x/decision.json \
 *     --bundle candidate.json --export .warden/policy/active.json
 */
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { policyDigestInput, validatePolicyBundle } from "../../core/src/index.ts"
import { evaluatePromotion } from "./promotion.mjs"
import { openLab, promotePolicy, recordHold, saveCandidate, writeActivePolicyFile } from "./store.mjs"

const argv = process.argv.slice(2)
const args = {}
for (let index = 0; index < argv.length; index += 1) {
  if (!argv[index].startsWith("--")) continue
  args[argv[index].slice(2)] = argv[index + 1]
  index += 1
}

if (args.db === undefined || args.decision === undefined || args.bundle === undefined) {
  console.error("usage: promote.mjs --db <lab.db> --decision <decision.json> --bundle <candidate.json> [--export <active.json>]")
  process.exitCode = 2
} else {
  const dbPath = resolve(process.cwd(), args.db)
  const decisionPath = resolve(process.cwd(), args.decision)
  const bundlePath = resolve(process.cwd(), args.bundle)

  const bundle = validatePolicyBundle(JSON.parse(readFileSync(bundlePath, "utf8")))
  const digest = createHash("sha256").update(policyDigestInput(bundle)).digest("hex")
  const decision = JSON.parse(readFileSync(decisionPath, "utf8"))

  const verdict = evaluatePromotion({ decision, bundleId: bundle.id, digest })
  const db = openLab(dbPath)
  // The candidate is stored whether or not it is promoted, so history and
  // evaluations can always be joined back to the bundle.
  saveCandidate(db, { id: bundle.id, digest, bundle })
  let outcome
  if (verdict.eligible) {
    const pointer = promotePolicy(db, {
      bundleId: bundle.id,
      digest,
      evaluationRef: `${decisionPath}#${decision.at ?? "unknown"}`,
    })
    outcome = { decision: "promote", pointer }
  } else {
    recordHold(
      db,
      { bundleId: bundle.id, digest, evaluationRef: decisionPath, reason: verdict.reason },
    )
    outcome = { decision: "hold", reason: verdict.reason }
  }
  if (args.export !== undefined) {
    const exported = writeActivePolicyFile(db, resolve(process.cwd(), args.export))
    outcome = {
      ...outcome,
      exported: {
        path: resolve(process.cwd(), args.export),
        bundleId: exported.bundleId,
        digest: exported.digest,
        revoked: exported.revokedDigests.length,
      },
    }
  }
  db.close()
  console.log(JSON.stringify(outcome, null, 2))
}
