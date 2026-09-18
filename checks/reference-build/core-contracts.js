function nonBlank(value, label) {
    if (typeof value !== "string" || value.trim().length === 0) {
        throw new TypeError(`${label} must be a nonempty string`);
    }
}
function nativeEffect(value) {
    if (value !== "allow" && value !== "ask" && value !== "deny") {
        throw new TypeError("Unknown native permission effect");
    }
    return value;
}
/** The caller is a trusted fixed-policy layer, not an untrusted model response. */
export function composePermission(native, decision) {
    const initial = nativeEffect(native);
    if (decision.kind === "abstain")
        return initial;
    if (decision.kind !== "ask_permission" && decision.kind !== "deny_by_rule") {
        throw new TypeError("Unknown kernel decision");
    }
    nonBlank(decision.ruleId, "ruleId");
    if (initial === "deny" || decision.kind === "deny_by_rule")
        return "deny";
    return "ask"; // never ask -> allow
}
const SCOPE_FIELDS = [
    "serverId", "serverEpoch", "locationId", "projectId", "worktreeId", "sessionId", "agentId",
];
export function validateScope(scope) {
    for (const key of SCOPE_FIELDS)
        nonBlank(scope[key], `scope.${key}`);
}
export function sameScope(a, b) {
    validateScope(a);
    validateScope(b);
    return SCOPE_FIELDS.every((key) => a[key] === b[key]);
}
/** This is a freshness/applicability gate, not a semantic truth or acceptance gate. */
export function observationEligibility(current, observed) {
    validateScope(current.scope);
    validateScope(observed.scope);
    for (const [label, value] of [
        ["current.snapshotId", current.snapshotId], ["current.policyDigest", current.policyDigest],
        ["observed.snapshotId", observed.snapshotId], ["observed.policyDigest", observed.policyDigest],
        ["observation.id", observed.id],
    ])
        nonBlank(value, label);
    if (observed.status !== "completed")
        return { eligible: false, reason: "not_completed" };
    if (!sameScope(current.scope, observed.scope))
        return { eligible: false, reason: "scope_mismatch" };
    if (current.snapshotId !== observed.snapshotId)
        return { eligible: false, reason: "stale_snapshot" };
    if (current.policyDigest !== observed.policyDigest)
        return { eligible: false, reason: "policy_mismatch" };
    if (observed.requiredEvidence !== "available")
        return { eligible: false, reason: "evidence_missing" };
    return { eligible: true };
}
/** In-memory example only. Production pins and revocations require durable storage. */
export class SessionPins {
    pins = new Map();
    revoked = new Map();
    key(scope) {
        validateScope(scope);
        // Keep the same pin across agents within a session; do not cross server epochs or worktrees.
        return JSON.stringify([
            scope.serverId, scope.serverEpoch, scope.locationId, scope.projectId,
            scope.worktreeId, scope.sessionId,
        ]);
    }
    pin(scope, policy) {
        nonBlank(policy.id, "policy.id");
        nonBlank(policy.digest, "policy.digest");
        const key = this.key(scope);
        const existing = this.pins.get(key);
        if (existing)
            return existing; // active-pointer updates cannot silently replace a pin
        const { agentId: _agentId, ...sessionScope } = scope;
        const value = Object.freeze({
            scope: Object.freeze(sessionScope), policyId: policy.id, policyDigest: policy.digest,
        });
        this.pins.set(key, value);
        return value;
    }
    revokeDigest(digest, reason) {
        nonBlank(digest, "digest");
        nonBlank(reason, "reason");
        this.revoked.set(digest, reason);
    }
    read(scope) {
        const pin = this.pins.get(this.key(scope));
        if (!pin)
            return { kind: "missing" };
        const reason = this.revoked.get(pin.policyDigest);
        return reason === undefined ? { kind: "active", pin } : { kind: "revoked", pin, reason };
    }
}
/** Key construction only; production ingestion must persist the unique key atomically. */
export function interventionKey(stamp, findingId, evidenceDigest, channel) {
    validateScope(stamp.scope);
    for (const [label, value] of [
        ["snapshotId", stamp.snapshotId], ["policyDigest", stamp.policyDigest],
        ["findingId", findingId], ["evidenceDigest", evidenceDigest],
    ])
        nonBlank(value, label);
    if (channel !== "context" && channel !== "tui")
        throw new TypeError("Invalid channel");
    return JSON.stringify([
        ...SCOPE_FIELDS.map((key) => stamp.scope[key]), stamp.snapshotId,
        stamp.policyDigest, findingId, evidenceDigest, channel,
    ]);
}
export function operationOutcome(signal) {
    switch (signal.kind) {
        case "tool_completed": return "observed_completed";
        case "tool_error": return "observed_error";
        case "denied_before_dispatch": return "denied_before_dispatch";
        case "interrupted":
        case "missing_result": return "outcome_unknown";
    }
}
/** Suppresses recursive optimization scheduling, NOT authorization or audit recording. */
export function mayScheduleNewLearning(origin, isAuthorizedScheduler) {
    return isAuthorizedScheduler && origin === "main_work";
}
/** No-match in an incomplete excerpt must not become a specification-wide absence claim. */
export function mayAssertAbsenceInDeclaredScope(coverage) {
    return coverage.inspectedScope === "complete_declared_scope" && !coverage.hasMissingReference;
}
