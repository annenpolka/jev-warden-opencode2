/**
 * Plugin options are untrusted input. Every value is narrowed here; unknown
 * values are reported instead of being trusted. Nothing in options can widen
 * authorization: there is no grant, no allow-list of actions, and no way to
 * turn Jev observations into approvals.
 */
import { isNonBlank } from "@jev-warden/core"

export interface WardenOptions {
  readonly mode: "observe" | "advise"
  readonly policyActivation: "session-pinned"
  readonly skillSelection: "recommend-only"
  readonly learningEnabled: boolean
  readonly labEndpoint: string | null
  /** Operator-provided fixed advisory note. Never learned, never an instruction. */
  readonly advisoryNote: string | null
  /** Fixed actions that Warden escalates to deny. Empty by default. */
  readonly denyActions: readonly string[]
  /** Optional JSONL path for host-conformance evidence. Not for production use. */
  readonly probeLog: string | null
  /** Optional JSONL outbox that the Lab ingests. Relative paths resolve against the location directory. */
  readonly outboxPath: string | null
  /** Explicitly allow the outbox inside the location directory (watch for reload loops). */
  readonly allowOutboxInLocation: boolean
  /** Optional server id override for remote deployments. */
  readonly serverId: string | null
  /** Live Jev evaluation through the explicit review RPC. Disabled by default. */
  readonly jev: JevOptions
}

export interface JevOptions {
  readonly enabled: boolean
  readonly maxRequests: number
  readonly timeoutMs: number
  readonly endpoint: string
  readonly model: string
}

export interface ParsedOptions {
  readonly options: WardenOptions
  readonly errors: readonly string[]
}

export const DEFAULT_OPTIONS: WardenOptions = {
  mode: "observe",
  policyActivation: "session-pinned",
  skillSelection: "recommend-only",
  learningEnabled: false,
  labEndpoint: null,
  advisoryNote: null,
  denyActions: [],
  probeLog: null,
  outboxPath: null,
  allowOutboxInLocation: false,
  serverId: null,
  jev: {
    enabled: false,
    maxRequests: 8,
    timeoutMs: 30_000,
    endpoint: "https://api.typesafe.ai/v1/systemone",
    model: "jev-latest",
  },
}

export function parseOptions(raw: Readonly<Record<string, unknown>> | undefined): ParsedOptions {
  const errors: string[] = []
  const record = raw ?? {}
  const mode = record.mode === "advise" ? "advise" : record.mode === "observe" ? "observe" : undefined
  if (record.mode !== undefined && mode === undefined) errors.push("mode must be observe or advise")

  const labEndpoint = optionalString(record.labEndpoint, "labEndpoint", errors)
  const advisoryNote = optionalString(record.advisoryNote, "advisoryNote", errors)
  const probeLog = optionalString(record.probeLog, "probeLog", errors)
  const outboxPath = optionalString(record.outboxPath, "outboxPath", errors)
  const allowOutboxInLocation = record.allowOutboxInLocation === true
  if (record.allowOutboxInLocation !== undefined && typeof record.allowOutboxInLocation !== "boolean") {
    errors.push("allowOutboxInLocation must be a boolean")
  }
  const serverId = optionalString(record.serverId, "serverId", errors)

  const denyActions: string[] = []
  if (record.denyActions !== undefined) {
    if (Array.isArray(record.denyActions)) {
      for (const entry of record.denyActions) {
        if (isNonBlank(entry)) denyActions.push(entry)
        else errors.push("denyActions entries must be nonempty strings")
      }
    } else {
      errors.push("denyActions must be an array")
    }
  }

  const learning = record.learning
  let learningEnabled = false
  if (learning !== undefined) {
    if (learning !== null && typeof learning === "object" && typeof (learning as Record<string, unknown>).enabled === "boolean") {
      learningEnabled = (learning as Record<string, unknown>).enabled === true
    } else if (typeof learning === "boolean") {
      learningEnabled = learning
    } else {
      errors.push("learning must be a boolean or an object with a boolean enabled")
    }
  }

  const jev = parseJevOptions(record.jev, errors)

  const options: WardenOptions = {
    mode: mode ?? DEFAULT_OPTIONS.mode,
    policyActivation: "session-pinned",
    skillSelection: "recommend-only",
    learningEnabled,
    labEndpoint,
    advisoryNote,
    denyActions,
    probeLog,
    outboxPath,
    allowOutboxInLocation,
    serverId,
    jev,
  }
  return { options, errors }
}

function parseJevOptions(value: unknown, errors: string[]): JevOptions {
  const defaults = DEFAULT_OPTIONS.jev
  if (value === undefined || value === null) return defaults
  if (typeof value !== "object" || Array.isArray(value)) {
    errors.push("jev must be an object")
    return defaults
  }
  const record = value as Record<string, unknown>
  const enabled = typeof record.enabled === "boolean" ? record.enabled : defaults.enabled
  if (record.enabled !== undefined && typeof record.enabled !== "boolean") errors.push("jev.enabled must be a boolean")
  let maxRequests = defaults.maxRequests
  if (record.maxRequests !== undefined) {
    if (typeof record.maxRequests === "number" && Number.isInteger(record.maxRequests) && record.maxRequests >= 0) {
      maxRequests = record.maxRequests
    } else {
      errors.push("jev.maxRequests must be a non-negative integer")
    }
  }
  let timeoutMs = defaults.timeoutMs
  if (record.timeoutMs !== undefined) {
    if (typeof record.timeoutMs === "number" && Number.isFinite(record.timeoutMs) && record.timeoutMs > 0) {
      timeoutMs = record.timeoutMs
    } else {
      errors.push("jev.timeoutMs must be a positive number")
    }
  }
  const endpoint = typeof record.endpoint === "string" && record.endpoint.startsWith("https://")
    ? record.endpoint
    : defaults.endpoint
  if (record.endpoint !== undefined && endpoint !== record.endpoint) {
    errors.push("jev.endpoint must be an https URL")
  }
  const model = isNonBlank(record.model) ? record.model : defaults.model
  if (record.model !== undefined && !isNonBlank(record.model)) errors.push("jev.model must be a nonempty string")
  return { enabled, maxRequests, timeoutMs, endpoint, model }
}

function optionalString(value: unknown, label: string, errors: string[]): string | null {
  if (value === undefined || value === null) return null
  if (isNonBlank(value)) return value
  errors.push(`${label} must be a nonempty string when present`)
  return null
}
