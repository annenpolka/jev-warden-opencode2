#!/usr/bin/env node
/**
 * Stores a Warden episode file in the Lab.
 *
 *   node packages/lab/src/episode.mjs --db .warden/lab.db --episode episode.json
 */
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { openLab, saveEpisode } from "./store.mjs"

const argv = process.argv.slice(2)
const args = {}
for (let index = 0; index < argv.length; index += 1) {
  if (!argv[index].startsWith("--")) continue
  args[argv[index].slice(2)] = argv[index + 1]
  index += 1
}

if (args.db === undefined || args.episode === undefined) {
  console.error("usage: episode.mjs --db <lab.db> --episode <episode.json>")
  process.exitCode = 2
} else {
  const episodePath = resolve(process.cwd(), args.episode)
  const episode = JSON.parse(readFileSync(episodePath, "utf8"))
  const db = openLab(resolve(process.cwd(), args.db))
  const stored = saveEpisode(db, {
    id: episode.episodeId,
    decisionInputs: {
      at: episode.decisionTime?.at ?? null,
      inputs: episode.decisionTime?.inputs ?? null,
      sufficiency: episode.decisionTime?.sufficiency ?? null,
      claim: episode.decisionTime?.claim ?? null,
      observationSource: episode.decisionTime?.observation?.source ?? null,
    },
    outcome: {
      at: episode.outcome?.at ?? null,
      sufficiency: episode.outcome?.sufficiency ?? null,
      claim: episode.outcome?.claim ?? null,
      retrieval: episode.retrieval ?? null,
    },
    resolution: episode.resolution ?? null,
  })
  db.close()
  console.log(JSON.stringify({ stored, episodeId: episode.episodeId, file: episodePath }, null, 2))
}
