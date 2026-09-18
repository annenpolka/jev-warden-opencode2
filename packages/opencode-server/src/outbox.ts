/**
 * Outbox path policy.
 *
 * Writing the outbox inside the location directory can feed the host's config
 * watcher and cause repeated location reloads. Relative paths are resolved
 * against the location, and an inside-location target is refused unless the
 * operator explicitly opts in (for example together with a watcher ignore).
 */
import { isAbsolute, join, sep } from "node:path"

export interface ResolvedOutbox {
  readonly path: string | null
  readonly skippedInsideLocation: boolean
  readonly requested: string | null
}

export function resolveOutboxPath(
  locationDirectory: string,
  requested: string | null,
  allowInsideLocation: boolean,
): ResolvedOutbox {
  if (requested === null) return { path: null, skippedInsideLocation: false, requested: null }
  const resolved = isAbsolute(requested) ? requested : join(locationDirectory, requested)
  const inside =
    resolved === locationDirectory ||
    resolved.startsWith(locationDirectory.endsWith(sep) ? locationDirectory : `${locationDirectory}${sep}`)
  if (inside && !allowInsideLocation) {
    return { path: null, skippedInsideLocation: true, requested }
  }
  return { path: resolved, skippedInsideLocation: false, requested }
}
