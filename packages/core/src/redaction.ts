/**
 * Credential-shaped text detection.
 *
 * Warden never sends raw material it has not classified. This scanner returns
 * only categories and locations, never the matched value, and it is a guard
 * against accidents rather than a guarantee: an allowlist of fields is still
 * the primary control.
 */

export type CredentialCategory =
  | "private_key_block"
  | "jwt"
  | "aws_access_key"
  | "openai_style_key"
  | "bearer_token"
  | "key_value_secret"

export interface CredentialFinding {
  readonly category: CredentialCategory
  /** Field path where the pattern was found, for example `state.definitions`. */
  readonly location: string
}

const PATTERNS: ReadonlyArray<{ readonly category: CredentialCategory; readonly pattern: RegExp }> = [
  { category: "private_key_block", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { category: "jwt", pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  { category: "aws_access_key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { category: "openai_style_key", pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { category: "bearer_token", pattern: /\bBearer\s+[A-Za-z0-9._-]{20,}\b/ },
  {
    category: "key_value_secret",
    pattern: /\b(?:api[_-]?key|secret|token|password)\s*[:=]\s*["']?[A-Za-z0-9/+=_-]{16,}/i,
  },
]

/**
 * Scans every string in a JSON-like value. Returns findings sorted by location.
 */
export function scanForCredentials(value: unknown, path = "value"): readonly CredentialFinding[] {
  const findings: CredentialFinding[] = []
  scan(value, path, findings)
  return findings
}

function scan(value: unknown, path: string, findings: CredentialFinding[]): void {
  if (typeof value === "string") {
    for (const { category, pattern } of PATTERNS) {
      if (pattern.test(value)) findings.push({ category, location: path })
    }
    return
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => scan(entry, `${path}[${index}]`, findings))
    return
  }
  if (value !== null && typeof value === "object") {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      scan(entry, `${path}.${key}`, findings)
    }
  }
}
