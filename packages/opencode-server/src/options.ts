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
  /** Optional server id override for remote deployments. */
  readonly serverId: string | null
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
  serverId: null,
}

export function parseOptions(raw: Readonly<Record<string, unknown>> | undefined): ParsedOptions {
  const errors: string[] = []
  const record = raw ?? {}
  const mode = record.mode === "advise" ? "advise" : record.mode === "observe" ? "observe" : undefined
  if (record.mode !== undefined && mode === undefined) errors.push("mode must be observe or advise")

  const labEndpoint = optionalString(record.labEndpoint, "labEndpoint", errors)
  const advisoryNote = optionalString(record.advisoryNote, "advisoryNote", errors)
  const probeLog = optionalString(record.probeLog, "probeLog", errors)
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

  const options: WardenOptions = {
    mode: mode ?? DEFAULT_OPTIONS.mode,
    policyActivation: "session-pinned",
    skillSelection: "recommend-only",
    learningEnabled,
    labEndpoint,
    advisoryNote,
    denyActions,
    probeLog,
    serverId,
  }
  return { options, errors }
}

function optionalString(value: unknown, label: string, errors: string[]): string | null {
  if (value === undefined || value === null) return null
  if (isNonBlank(value)) return value
  errors.push(`${label} must be a nonempty string when present`)
  return null
}
