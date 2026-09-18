/**
 * Doctor report assembly. The host probes live in main.ts; this module merges
 * already-collected facts into the Core DoctorReport shape and keeps the
 * aggregate honest (a partial run never aggregates to PASSED).
 */
import {
  aggregateStatus,
  check,
  type CheckStatus,
  type DoctorCheck,
  type DoctorReport,
  type InstalledHost,
} from "@jev-warden/core"

export interface ConformanceCase {
  readonly id: string
  readonly area: DoctorCheck["area"]
  readonly requirement: string
  readonly status: CheckStatus
  readonly evidenceRefs: readonly string[]
  readonly detail?: string
  readonly observedAt?: number
}

export interface ConformanceResult {
  readonly schemaVersion: "warden.host-conformance/0.1"
  readonly host: { readonly cliVersion: string | null; readonly opencodeVersionFromServer: string | null }
  readonly cases: readonly ConformanceCase[]
  readonly artifacts?: Readonly<Record<string, string>>
  readonly startedAt?: number
  readonly finishedAt?: number
}

export function caseToCheck(item: ConformanceCase): DoctorCheck {
  return check(item.id, item.area, item.requirement, item.status, item.evidenceRefs, item.detail, item.observedAt)
}

export function buildDoctorReport(input: {
  readonly installed: InstalledHost
  readonly checks: readonly DoctorCheck[]
  readonly generatedAt: number
  readonly notes?: readonly string[]
}): DoctorReport {
  const checks = [...input.checks]
  return {
    schemaVersion: "warden.doctor/0.1",
    reportKind: "executed-partial",
    generatedAt: input.generatedAt,
    baseline: {
      repository: "anomalyco/opencode",
      commit: "a2594ddefb6557ecf7e7edb3e30ea50c71df8519",
      sourcePackageName: "@opencode/plugin",
      sourcePackageVersion: "2.0.7",
    },
    installed: input.installed,
    checks,
    aggregate: aggregateStatus(checks),
    notes: input.notes ?? [],
  }
}

export function mergeConformance(cases: readonly ConformanceCase[], prefix = ""): DoctorCheck[] {
  return cases.map((item) =>
    check(
      `${prefix}${item.id}`,
      item.area,
      item.requirement,
      item.status,
      item.evidenceRefs,
      item.detail,
      item.observedAt,
    ),
  )
}
