/**
 * Policy bundles are data. They cannot contain executable code, imports,
 * shell strings, provider endpoints or grant changes. Validation rejects those
 * shapes instead of ignoring them.
 */
import { canonicalJson, nonBlank } from "./ids.ts"

export type PolicyStatus = "candidate" | "shadow" | "active" | "retired" | "revoked"

export interface PolicyScope {
  readonly kind: "project" | "server" | "location"
  readonly projectRef: string
}

export interface PolicyCompatibility {
  readonly coreContract: string
  readonly requiredCapabilities: readonly string[]
}

export interface PolicySelector {
  readonly id: string
  readonly options: Readonly<Record<string, unknown>>
}

export type ProbeType = "noul" | "choice" | "score"

export interface PolicyProbe {
  readonly id: string
  readonly type: ProbeType
  readonly instructions: string
  readonly criteria?: Readonly<Record<string, string>>
  readonly inputs: readonly string[]
  readonly role: string
}

export interface PolicyGuidance {
  readonly kind: string
  readonly delivery: "advisory" | "status_only"
  readonly maxItems: number
  readonly repeatOnlyOnNewEvidence: boolean
}

export interface PolicyPromotion {
  readonly evaluationPolicyRef: string
  readonly reportRefs: readonly string[]
}

export interface PolicyBundle {
  readonly schemaVersion: "warden.policy/0.1"
  readonly id: string
  readonly parentId?: string
  readonly status: PolicyStatus
  readonly scope: PolicyScope
  readonly compatibility: PolicyCompatibility
  readonly selectors: readonly PolicySelector[]
  readonly probes: readonly PolicyProbe[]
  readonly guidance: PolicyGuidance
  readonly promotion: PolicyPromotion
}

export const POLICY_SCHEMA_VERSION = "warden.policy/0.1" as const
export const CORE_CONTRACT_VERSION = "warden.core/0.1" as const

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function rejectExecutableKeys(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => rejectExecutableKeys(entry, `${path}[${index}]`))
    return
  }
  if (value === null || typeof value !== "object") {
    if (typeof value === "function") throw new TypeError(`${path} must not contain functions`)
    return
  }
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (key === "code" || key === "eval" || key === "exec" || key === "shell" || key === "import" || key === "require") {
      throw new TypeError(`${path}.${key} is not allowed in a policy bundle`)
    }
    rejectExecutableKeys(entry, `${path}.${key}`)
  }
}

export function validatePolicyBundle(input: unknown): PolicyBundle {
  rejectExecutableKeys(input, "policy")
  const root = asRecord(input, "policy")
  if (root.schemaVersion !== POLICY_SCHEMA_VERSION) {
    throw new TypeError(`policy.schemaVersion must be ${POLICY_SCHEMA_VERSION}`)
  }
  nonBlank(root.id, "policy.id")
  if (root.status !== "candidate" && root.status !== "shadow" && root.status !== "active" &&
      root.status !== "retired" && root.status !== "revoked") {
    throw new TypeError("policy.status is invalid")
  }
  const scope = asRecord(root.scope, "policy.scope")
  if (scope.kind !== "project" && scope.kind !== "server" && scope.kind !== "location") {
    throw new TypeError("policy.scope.kind is invalid")
  }
  nonBlank(scope.projectRef, "policy.scope.projectRef")
  const compatibility = asRecord(root.compatibility, "policy.compatibility")
  if (compatibility.coreContract !== CORE_CONTRACT_VERSION) {
    throw new TypeError(`policy.compatibility.coreContract must be ${CORE_CONTRACT_VERSION}`)
  }
  const capabilities = compatibility.requiredCapabilities
  if (!Array.isArray(capabilities)) throw new TypeError("policy.compatibility.requiredCapabilities must be an array")
  capabilities.forEach((entry, index) => nonBlank(entry, `policy.compatibility.requiredCapabilities[${index}]`))

  const selectors = root.selectors
  if (!Array.isArray(selectors)) throw new TypeError("policy.selectors must be an array")
  selectors.forEach((entry, index) => {
    const selector = asRecord(entry, `policy.selectors[${index}]`)
    nonBlank(selector.id, `policy.selectors[${index}].id`)
    asRecord(selector.options, `policy.selectors[${index}].options`)
  })

  const probes = root.probes
  if (!Array.isArray(probes)) throw new TypeError("policy.probes must be an array")
  probes.forEach((entry, index) => {
    const probe = asRecord(entry, `policy.probes[${index}]`)
    nonBlank(probe.id, `policy.probes[${index}].id`)
    if (probe.type !== "noul" && probe.type !== "choice" && probe.type !== "score") {
      throw new TypeError(`policy.probes[${index}].type is invalid`)
    }
    nonBlank(probe.instructions, `policy.probes[${index}].instructions`)
    if (!Array.isArray(probe.inputs)) throw new TypeError(`policy.probes[${index}].inputs must be an array`)
    probe.inputs.forEach((input, inputIndex) => nonBlank(input, `policy.probes[${index}].inputs[${inputIndex}]`))
    nonBlank(probe.role, `policy.probes[${index}].role`)
  })

  const guidance = asRecord(root.guidance, "policy.guidance")
  nonBlank(guidance.kind, "policy.guidance.kind")
  if (guidance.delivery !== "advisory" && guidance.delivery !== "status_only") {
    throw new TypeError("policy.guidance.delivery is invalid")
  }
  if (!Number.isInteger(guidance.maxItems) || (guidance.maxItems as number) < 0) {
    throw new TypeError("policy.guidance.maxItems must be a non-negative integer")
  }
  if (typeof guidance.repeatOnlyOnNewEvidence !== "boolean") {
    throw new TypeError("policy.guidance.repeatOnlyOnNewEvidence must be a boolean")
  }

  const promotion = asRecord(root.promotion, "policy.promotion")
  nonBlank(promotion.evaluationPolicyRef, "policy.promotion.evaluationPolicyRef")
  if (!Array.isArray(promotion.reportRefs)) throw new TypeError("policy.promotion.reportRefs must be an array")

  return input as PolicyBundle
}

/** Canonical data used to compute a cryptographic policy digest in the adapter. */
export function policyDigestInput(bundle: PolicyBundle): string {
  return canonicalJson(bundle)
}
