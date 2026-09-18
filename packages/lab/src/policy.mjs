#!/usr/bin/env node
/**
 * Policy pointer CLI.
 *
 *   node packages/lab/src/policy.mjs --db .warden/lab.db show
 *   node packages/lab/src/policy.mjs --db .warden/lab.db promote --bundle <id> --digest <sha256> --evaluation <ref>
 *   node packages/lab/src/policy.mjs --db .warden/lab.db rollback --evaluation <ref>
 *   node packages/lab/src/policy.mjs --db .warden/lab.db revoke --digest <sha256> --reason <text>
 *
 * With --export <path> the active pointer and bundle are written for the
 * server plugin after the change.
 */
import { resolve } from "node:path"
import { activePolicy, openLab, policyHistory, promotePolicy, revokePolicy, rollbackPolicy, writeActivePolicyFile } from "./store.mjs"

const argv = process.argv.slice(2)
const args = {}
const positional = []
for (let index = 0; index < argv.length; index += 1) {
  const token = argv[index]
  if (token.startsWith("--")) {
    args[token.slice(2)] = argv[index + 1]
    index += 1
  } else {
    positional.push(token)
  }
}

const command = positional[0] ?? "show"
const dbPath = resolve(process.cwd(), args.db ?? ".warden/lab.db")
const exportPath = args.export === undefined ? null : resolve(process.cwd(), args.export)
const db = openLab(dbPath)

let result
switch (command) {
  case "show":
    result = { active: activePolicy(db), history: policyHistory(db) }
    break
  case "promote":
    result = promotePolicy(db, {
      bundleId: args.bundle,
      digest: args.digest,
      evaluationRef: args.evaluation,
    })
    break
  case "rollback":
    result = rollbackPolicy(db, { evaluationRef: args.evaluation })
    break
  case "revoke":
    result = revokePolicy(db, { digest: args.digest, reason: args.reason ?? "unspecified" })
    break
  default:
    console.error(`unknown command: ${command}`)
    process.exitCode = 2
}

if (exportPath !== null && result !== undefined) {
  const exported = writeActivePolicyFile(db, exportPath)
  result = { pointer: result, exported: { path: exportPath, bundleId: exported.bundleId, digest: exported.digest, revoked: exported.revokedDigests.length } }
}
if (result !== undefined) console.log(JSON.stringify(result, null, 2))
db.close()
