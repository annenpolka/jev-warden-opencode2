#!/usr/bin/env node
/**
 * Prints a Lab summary: totals, per-type counts, stream ack cursors, recent events.
 *
 * Usage:
 *   node packages/lab/src/report.mjs --db .warden/lab.db
 */
import { resolve } from "node:path"
import { openLab, summary } from "./store.mjs"

const args = {}
for (let index = 0; index < process.argv.length; index += 1) {
  if (process.argv[index] !== "--db") continue
  args.db = process.argv[index + 1]
  index += 1
}

const dbPath = resolve(process.cwd(), args.db ?? ".warden/lab.db")
const db = openLab(dbPath)
console.log(JSON.stringify({ db: dbPath, ...summary(db) }, null, 2))
db.close()
