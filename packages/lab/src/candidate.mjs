#!/usr/bin/env node
/**
 * Saves a candidate PolicyBundle (validated data) into the Lab.
 *
 *   node packages/lab/src/candidate.mjs --db .warden/lab.db --bundle candidate.json
 *
 * The digest is recomputed from the canonical bundle data; a bundle that fails
 * validation is rejected instead of stored.
 */
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { policyDigestInput, validatePolicyBundle } from "../../core/src/index.ts"
import { saveCandidate, openLab } from "./store.mjs"

const argv = process.argv.slice(2)
const args = {}
for (let index = 0; index < argv.length; index += 1) {
  if (!argv[index].startsWith("--")) continue
  args[argv[index].slice(2)] = argv[index + 1]
  index += 1
}

if (args.db === undefined || args.bundle === undefined) {
  console.error("usage: candidate.mjs --db <lab.db> --bundle <candidate.json>")
  process.exitCode = 2
} else {
  const bundlePath = resolve(process.cwd(), args.bundle)
  const raw = JSON.parse(readFileSync(bundlePath, "utf8"))
  const bundle = validatePolicyBundle(raw)
  const digest = createHash("sha256").update(policyDigestInput(bundle)).digest("hex")
  const db = openLab(resolve(process.cwd(), args.db))
  saveCandidate(db, { id: bundle.id, digest, bundle })
  db.close()
  console.log(JSON.stringify({ stored: bundle.id, digest, bundle: bundlePath }, null, 2))
}
