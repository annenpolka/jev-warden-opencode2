/**
 * Identifier and correlation helpers.
 *
 * These are Warden-internal helpers. They never mint identifiers that are
 * presented as host-originated. Host identifiers are recorded verbatim and
 * marked optional when the host does not publish them.
 */

export function nonBlank(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must be a nonempty string`)
  }
  return value
}

export function isNonBlank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

/**
 * Non-cryptographic content digest used only for dedup keys and internal
 * correlation. Policy digests and evidence hashes must be computed by the
 * adapter with an approved cryptographic hash and passed in.
 */
export function correlationDigest(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `fnv1a32:${hash.toString(16).padStart(8, "0")}:${value.length}`
}

/** Deterministic JSON with sorted object keys, for canonical digest input. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value))
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue)
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return Object.fromEntries(entries.map(([key, entry]) => [key, sortValue(entry)]))
  }
  return value
}

export function assertNever(value: never, label = "value"): never {
  throw new TypeError(`Unexpected ${label}: ${JSON.stringify(value)}`)
}
