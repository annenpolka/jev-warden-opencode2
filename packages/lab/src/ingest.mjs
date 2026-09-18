#!/usr/bin/env node
/**
 * Ingests a Warden outbox (JSONL of EventEnvelope) into the Lab database.
 *
 * Usage:
 *   node packages/lab/src/ingest.mjs --db .warden/lab.db --outbox .warden/outbox.jsonl
 */
import { mkdirSync } from "node:fs"
import { dirname, isAbsolute, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { ingestFile, openLab, summary } from "./store.mjs"

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..")
const args = {}
for (let index = 0; index < process.argv.length; index += 1) {
  const token = process.argv[index]
  if (token !== "--db" && token !== "--outbox") continue
  args[token.slice(2)] = process.argv[index + 1]
  index += 1
}

const dbPath = isAbsolute(args.db ?? "") || args.db === undefined ? resolve(process.cwd(), args.db ?? ".warden/lab.db") : join(repoRoot, args.db)
const outboxPath = resolve(process.cwd(), args.outbox ?? ".warden/outbox.jsonl")
mkdirSync(dirname(dbPath), { recursive: true })

const db = openLab(dbPath)
const result = ingestFile(db, outboxPath)
console.log(JSON.stringify({ db: dbPath, outbox: outboxPath, ...result, summary: summary(db) }, null, 2))
db.close()
