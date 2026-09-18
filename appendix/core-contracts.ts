/**
 * Jev Warden / OpenCode 2 — offline reference contracts.
 * These are OUR INTERNAL types, not the OpenCode Plugin API.
 * The adapter must validate public host payloads before constructing these values.
 * Local non-weakening does not prove host-wide authorization or sandboxing.
 */
export type NativeEffect = "allow" | "ask" | "deny";
export type KernelDecision =
  | { readonly kind: "abstain" }
  | { readonly kind: "ask_permission"; readonly ruleId: string }
  | { readonly kind: "deny_by_rule"; readonly ruleId: string };

function nonBlank(value: string, label: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must be a nonempty string`);
  }
}

function nativeEffect(value: unknown): NativeEffect {
  if (value !== "allow" && value !== "ask" && value !== "deny") {
    throw new TypeError("Unknown native permission effect");
  }
  return value;
}

/** The caller is a trusted fixed-policy layer, not an untrusted model response. */
export function composePermission(native: NativeEffect, decision: KernelDecision): NativeEffect {
  const initial = nativeEffect(native);
  if (decision.kind === "abstain") return initial;
  if (decision.kind !== "ask_permission" && decision.kind !== "deny_by_rule") {
    throw new TypeError("Unknown kernel decision");
  }
  nonBlank(decision.ruleId, "ruleId");
  if (initial === "deny" || decision.kind === "deny_by_rule") return "deny";
  return "ask"; // never ask -> allow
}

export interface Scope {
  readonly serverId: string;
  readonly serverEpoch: string;
  readonly locationId: string;
  readonly projectId: string;
  readonly worktreeId: string;
  readonly sessionId: string;
  readonly agentId: string;
}
const SCOPE_FIELDS = [
  "serverId", "serverEpoch", "locationId", "projectId", "worktreeId", "sessionId", "agentId",
] as const;

export function validateScope(scope: Scope): void {
  for (const key of SCOPE_FIELDS) nonBlank(scope[key], `scope.${key}`);
}
export function sameScope(a: Scope, b: Scope): boolean {
  validateScope(a);
  validateScope(b);
  return SCOPE_FIELDS.every((key) => a[key] === b[key]);
}

export interface ViewStamp {
  readonly scope: Scope;
  readonly snapshotId: string;
  readonly policyDigest: string;
}
export type ObservationStatus =
  | "completed" | "unavailable" | "invalid_response" | "budget_exhausted"
  | "cancelled" | "superseded";
export interface ObservationEnvelope extends ViewStamp {
  readonly id: string;
  readonly status: ObservationStatus;
  readonly requiredEvidence: "available" | "missing" | "unknown";
}
export type Eligibility =
  | { readonly eligible: true }
  | { readonly eligible: false; readonly reason:
      "not_completed" | "scope_mismatch" | "stale_snapshot" | "policy_mismatch" | "evidence_missing" };

/** This is a freshness/applicability gate, not a semantic truth or acceptance gate. */
export function observationEligibility(current: ViewStamp, observed: ObservationEnvelope): Eligibility {
  validateScope(current.scope);
  validateScope(observed.scope);
  for (const [label, value] of [
    ["current.snapshotId", current.snapshotId], ["current.policyDigest", current.policyDigest],
    ["observed.snapshotId", observed.snapshotId], ["observed.policyDigest", observed.policyDigest],
    ["observation.id", observed.id],
  ] as const) nonBlank(value, label);
  if (observed.status !== "completed") return { eligible: false, reason: "not_completed" };
  if (!sameScope(current.scope, observed.scope)) return { eligible: false, reason: "scope_mismatch" };
  if (current.snapshotId !== observed.snapshotId) return { eligible: false, reason: "stale_snapshot" };
  if (current.policyDigest !== observed.policyDigest) return { eligible: false, reason: "policy_mismatch" };
  if (observed.requiredEvidence !== "available") return { eligible: false, reason: "evidence_missing" };
  return { eligible: true };
}

export type SessionScope = Omit<Scope, "agentId">;
export interface PolicyPin {
  readonly scope: SessionScope;
  readonly policyId: string;
  readonly policyDigest: string;
}
export type PinRead =
  | { readonly kind: "missing" }
  | { readonly kind: "active"; readonly pin: PolicyPin }
  | { readonly kind: "revoked"; readonly pin: PolicyPin; readonly reason: string };

/** In-memory example only. Production pins and revocations require durable storage. */
export class SessionPins {
  private readonly pins = new Map<string, PolicyPin>();
  private readonly revoked = new Map<string, string>();
  private key(scope: Scope): string {
    validateScope(scope);
    // Keep the same pin across agents within a session; do not cross server epochs or worktrees.
    return JSON.stringify([
      scope.serverId, scope.serverEpoch, scope.locationId, scope.projectId,
      scope.worktreeId, scope.sessionId,
    ]);
  }
  pin(scope: Scope, policy: { readonly id: string; readonly digest: string }): PolicyPin {
    nonBlank(policy.id, "policy.id");
    nonBlank(policy.digest, "policy.digest");
    const key = this.key(scope);
    const existing = this.pins.get(key);
    if (existing) return existing; // active-pointer updates cannot silently replace a pin
    const { agentId: _agentId, ...sessionScope } = scope;
    const value: PolicyPin = Object.freeze({
      scope: Object.freeze(sessionScope), policyId: policy.id, policyDigest: policy.digest,
    });
    this.pins.set(key, value);
    return value;
  }
  revokeDigest(digest: string, reason: string): void {
    nonBlank(digest, "digest");
    nonBlank(reason, "reason");
    this.revoked.set(digest, reason);
  }
  read(scope: Scope): PinRead {
    const pin = this.pins.get(this.key(scope));
    if (!pin) return { kind: "missing" };
    const reason = this.revoked.get(pin.policyDigest);
    return reason === undefined ? { kind: "active", pin } : { kind: "revoked", pin, reason };
  }
}

/** Key construction only; production ingestion must persist the unique key atomically. */
export function interventionKey(
  stamp: ViewStamp, findingId: string, evidenceDigest: string, channel: "context" | "tui",
): string {
  validateScope(stamp.scope);
  for (const [label, value] of [
    ["snapshotId", stamp.snapshotId], ["policyDigest", stamp.policyDigest],
    ["findingId", findingId], ["evidenceDigest", evidenceDigest],
  ] as const) nonBlank(value, label);
  if (channel !== "context" && channel !== "tui") throw new TypeError("Invalid channel");
  return JSON.stringify([
    ...SCOPE_FIELDS.map((key) => stamp.scope[key]), stamp.snapshotId,
    stamp.policyDigest, findingId, evidenceDigest, channel,
  ]);
}

export type TerminalSignal =
  | { readonly kind: "tool_completed" }
  | { readonly kind: "tool_error" }
  | { readonly kind: "denied_before_dispatch" }
  | { readonly kind: "interrupted" }
  | { readonly kind: "missing_result" };
export type OperationOutcome =
  | "observed_completed" | "observed_error" | "denied_before_dispatch" | "outcome_unknown";
export function operationOutcome(signal: TerminalSignal): OperationOutcome {
  switch (signal.kind) {
    case "tool_completed": return "observed_completed";
    case "tool_error": return "observed_error";
    case "denied_before_dispatch": return "denied_before_dispatch";
    case "interrupted":
    case "missing_result": return "outcome_unknown";
  }
}

export type WorkOrigin = "main_work" | "warden" | "experiment" | "audit";
/** Suppresses recursive optimization scheduling, NOT authorization or audit recording. */
export function mayScheduleNewLearning(origin: WorkOrigin, isAuthorizedScheduler: boolean): boolean {
  return isAuthorizedScheduler && origin === "main_work";
}

export interface EvidenceCoverage {
  readonly inspectedScope: "complete_declared_scope" | "partial" | "unknown";
  readonly hasMissingReference: boolean;
}
/** No-match in an incomplete excerpt must not become a specification-wide absence claim. */
export function mayAssertAbsenceInDeclaredScope(coverage: EvidenceCoverage): boolean {
  return coverage.inspectedScope === "complete_declared_scope" && !coverage.hasMissingReference;
}
