/**
 * Execution scope.
 *
 * `ctx.location` describes the plugin instance's location. It never proves
 * where an individual session or event executed. A scope is only usable when
 * every field has been resolved from host data; unresolved scopes must be
 * reported as such and must not be mixed with another scope's evidence.
 */
import { nonBlank } from "./ids.ts"

export interface Scope {
  readonly serverId: string
  readonly serverEpoch: string
  readonly locationId: string
  readonly projectId: string
  readonly worktreeId: string
  readonly sessionId: string
  readonly agentId: string
}

export type SessionScope = Omit<Scope, "agentId">

export const SCOPE_FIELDS = [
  "serverId",
  "serverEpoch",
  "locationId",
  "projectId",
  "worktreeId",
  "sessionId",
  "agentId",
] as const

export function validateScope(scope: Scope): void {
  for (const key of SCOPE_FIELDS) nonBlank(scope[key], `scope.${key}`)
}

export function sameScope(a: Scope, b: Scope): boolean {
  validateScope(a)
  validateScope(b)
  return SCOPE_FIELDS.every((key) => a[key] === b[key])
}

export function sameSessionScope(a: Scope, b: Scope): boolean {
  validateScope(a)
  validateScope(b)
  return SCOPE_FIELDS.filter((key) => key !== "agentId").every((key) => a[key] === b[key])
}

/** Pins and other session-lifetime records key on the session scope, not the agent. */
export function sessionScopeOf(scope: Scope): SessionScope {
  validateScope(scope)
  return Object.freeze({
    serverId: scope.serverId,
    serverEpoch: scope.serverEpoch,
    locationId: scope.locationId,
    projectId: scope.projectId,
    worktreeId: scope.worktreeId,
    sessionId: scope.sessionId,
  })
}

export function scopeKey(scope: Scope): string {
  const session = sessionScopeOf(scope)
  return JSON.stringify([
    session.serverId,
    session.serverEpoch,
    session.locationId,
    session.projectId,
    session.worktreeId,
    session.sessionId,
  ])
}

/**
 * A resolution result that keeps "unknown" distinct from "resolved".
 * Adapters must downgrade to `scope_unresolved` instead of guessing.
 */
export type ScopeResolution =
  | { readonly kind: "resolved"; readonly scope: Scope }
  | { readonly kind: "unresolved"; readonly reason: string; readonly observed: Readonly<Record<string, unknown>> }

export function resolved(scope: Scope): ScopeResolution {
  validateScope(scope)
  return { kind: "resolved", scope }
}

export function unresolved(reason: string, observed: Readonly<Record<string, unknown>> = {}): ScopeResolution {
  nonBlank(reason, "reason")
  return { kind: "unresolved", reason, observed }
}
