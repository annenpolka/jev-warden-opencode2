/**
 * Doctor records.
 *
 * passed / failed / not_run / blocked are distinct. A check that was not
 * executed against the installed host is never rendered as a pass, and a
 * successful offline typecheck is not host compatibility.
 */
export type CheckStatus = "PASSED" | "FAILED" | "NOT_RUN" | "BLOCKED"

export interface DoctorCheck {
  readonly id: string
  readonly area:
    | "host"
    | "plugin"
    | "prompt"
    | "context"
    | "tool"
    | "permission"
    | "scope"
    | "jev"
    | "rpc"
    | "storage"
    | "policy"
    | "registry"
    | "tui"
    | "worktree"
    | "executor"
    | "learning"
  readonly requirement: string
  readonly status: CheckStatus
  readonly detail?: string
  readonly evidenceRefs: readonly string[]
  readonly observedAt?: number
}

export interface InstalledHost {
  readonly cliVersion: string | null
  readonly serverVersion: string | null
  readonly channel: string | null
  readonly pluginPackageVersion: string | null
  readonly pluginPackageIntegrity: string | null
  readonly binaryPath: string | null
  readonly binarySha256: string | null
  readonly runtime: string | null
  readonly platform: string | null
  readonly platformRelease: string | null
}

export interface DoctorReport {
  readonly schemaVersion: "warden.doctor/0.1"
  readonly reportKind: "executed-partial" | "template-not-executed"
  readonly generatedAt: number
  readonly baseline: {
    readonly repository: string
    readonly commit: string
    readonly sourcePackageName: string
    readonly sourcePackageVersion: string
  }
  readonly installed: InstalledHost
  readonly checks: readonly DoctorCheck[]
  readonly aggregate: AggregateStatus
  readonly notes: readonly string[]
}

export type AggregateStatus = "PASSED" | "PARTIAL" | "FAILED"

/**
 * Aggregate rule: any failed check fails the report. Otherwise any check that
 * is not_run or blocked keeps the report partial. "PASSED" requires every
 * listed check to have executed and passed.
 */
export function aggregateStatus(checks: readonly DoctorCheck[]): AggregateStatus {
  if (checks.some((check) => check.status === "FAILED")) return "FAILED"
  if (checks.some((check) => check.status === "NOT_RUN" || check.status === "BLOCKED")) return "PARTIAL"
  return checks.length === 0 ? "PARTIAL" : "PASSED"
}

export function check(
  id: string,
  area: DoctorCheck["area"],
  requirement: string,
  status: CheckStatus,
  evidenceRefs: readonly string[] = [],
  detail?: string,
  observedAt?: number,
): DoctorCheck {
  return {
    id,
    area,
    requirement,
    status,
    evidenceRefs,
    ...(detail === undefined ? {} : { detail }),
    ...(observedAt === undefined ? {} : { observedAt }),
  }
}
