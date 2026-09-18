/**
 * Active-policy file loader.
 *
 * The Lab (or an operator CLI) exports the active pointer and bundle as one
 * JSON file; the server plugin reads it at session start. The bundle is
 * validated as data, its digest is recomputed, and a retired/revoked/mismatched
 * bundle falls back to the built-in baseline instead of being applied.
 * Existing sessions keep their pin: a pointer move affects new sessions.
 */
import { createHash } from "node:crypto"
import { readFileSync, statSync } from "node:fs"
import { policyDigestInput, validatePolicyBundle, type PolicyBundle } from "@jev-warden/core"

export interface ActivePolicyFile {
  readonly schemaVersion?: unknown
  readonly bundleId?: unknown
  readonly digest?: unknown
  readonly status?: unknown
  readonly evaluationRef?: unknown
  readonly revokedDigests?: unknown
  readonly bundle?: unknown
}

export interface LoadedPolicy {
  readonly bundle: PolicyBundle | null
  readonly digest: string | null
  readonly revoked: readonly string[]
  readonly guidanceEnabled: boolean
  readonly source: "file" | "baseline"
  readonly error?: string
  readonly fileMtimeMs?: number
}

export interface PolicyLoader {
  load(): LoadedPolicy
  describe(): Record<string, unknown>
}

export const BASELINE_LOADED: LoadedPolicy = {
  bundle: null,
  digest: null,
  revoked: [],
  guidanceEnabled: false,
  source: "baseline",
}

export function policyDigest(bundle: PolicyBundle): string {
  return createHash("sha256").update(policyDigestInput(bundle)).digest("hex")
}

/** Loads and validates once per file mtime change. */
export function createPolicyLoader(path: string): PolicyLoader {
  let cached: LoadedPolicy | undefined
  let cachedMtime = -1
  const load = (): LoadedPolicy => {
    let mtime = -1
    try {
      mtime = statSync(path).mtimeMs
    } catch {
      return { ...BASELINE_LOADED, error: "policy_file_missing" }
    }
    if (cached !== undefined && mtime === cachedMtime) return cached
    cachedMtime = mtime
    cached = readPolicyFile(path, mtime)
    return cached
  }
  return {
    load,
    describe: () => {
      const loaded = load()
      return {
        source: loaded.source,
        bundleId: loaded.bundle?.id ?? null,
        digest: loaded.digest,
        guidanceEnabled: loaded.guidanceEnabled,
        revokedCount: loaded.revoked.length,
        error: loaded.error ?? null,
      }
    },
  }
}

function readPolicyFile(path: string, mtime: number): LoadedPolicy {
  let parsed: ActivePolicyFile
  try {
    parsed = JSON.parse(readFileSync(path, "utf8")) as ActivePolicyFile
  } catch {
    return { ...BASELINE_LOADED, error: "policy_file_unreadable", fileMtimeMs: mtime }
  }
  const revoked = Array.isArray(parsed.revokedDigests)
    ? parsed.revokedDigests.filter((entry): entry is string => typeof entry === "string")
    : []

  if (parsed.bundle === undefined || parsed.bundle === null) {
    return { ...BASELINE_LOADED, revoked, fileMtimeMs: mtime }
  }
  let bundle: PolicyBundle
  try {
    bundle = validatePolicyBundle(parsed.bundle)
  } catch (error) {
    return {
      ...BASELINE_LOADED,
      revoked,
      error: `policy_bundle_invalid:${error instanceof Error ? error.message : "unknown"}`,
      fileMtimeMs: mtime,
    }
  }
  if (bundle.status === "retired" || bundle.status === "revoked") {
    return { ...BASELINE_LOADED, revoked, error: `policy_status_${bundle.status}`, fileMtimeMs: mtime }
  }
  const digest = policyDigest(bundle)
  if (typeof parsed.digest === "string" && parsed.digest !== digest) {
    return { ...BASELINE_LOADED, revoked, error: "policy_digest_mismatch", fileMtimeMs: mtime }
  }
  if (revoked.includes(digest)) {
    return { ...BASELINE_LOADED, revoked, error: "policy_revoked", fileMtimeMs: mtime }
  }
  return {
    bundle,
    digest,
    revoked,
    guidanceEnabled: bundle.guidance.delivery === "advisory" && bundle.guidance.kind !== "none",
    source: "file",
    fileMtimeMs: mtime,
  }
}
