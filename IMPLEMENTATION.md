# Jev Warden / OpenCode 2 — Phase 0 implementation

This repository started as the OC2-0.1 design package (`README.md`, `jev-warden-opencode2-design-v0.1.md`, `reference/`). This file describes the **implementation** that now sits beside the design, its verified scope and its remaining gaps.

The implementation follows `appendix/implementation-brief.md`: confirm the installed host and public types first, build only the first change unit, verify on the real host, and update `appendix/acceptance-matrix.json` only for items with actual evidence.

## Verified host

| Item | Value |
|---|---|
| Installed CLI / server | `opencode 2.0.7` (Homebrew `@opencode/cli`), `/api/info` reports `2.0.7` |
| Binary digest | `checks/host-baseline-2.0.7.json` → `installedHost.binarySha256` |
| Plugin package used for types and local plugin runtime | published `@opencode/plugin@2.0.7` (npm), lockfile integrity recorded in the baseline |
| Conformance run | `checks/host-conformance-2.0.7.json` — 10 cases, 0 failed |
| Doctor report | `checks/doctor.2.0.7.json` (aggregate `PARTIAL`: runtime checks pass, Jev/Lab/TUI/executor/learning remain `NOT_RUN`) |

The compiled CLI bundles its own plugin implementation; the source commit `a2594ddefb6557ecf7e7edb3e30ea50c71df8519` and package `2.0.7` from the design remain the research baseline, not a claim about the binary internals.

## Layout

```text
packages/
  core/                pure TypeScript contracts (no host, Effect or Node imports)
  contracts/           shared RPC definition (imports @opencode/plugin/rpc only)
  opencode-server/     Effect server plugin: hooks, spool, status, RPC
  opencode-tui/        TUI plugin: status command over the read-only RPC
  doctor/              CLI that merges host facts and conformance results
fixtures/
  host-contracts/      mock model server, probe plugin, scenario runner, baseline collector
appendix/              original design artifacts (unchanged except acceptance-matrix status)
```

`packages/core` has two tsconfigs: `tsconfig.json` typechecks `src` with `types: []` so Node/DOM globals cannot leak in, and `tsconfig.test.json` adds Node types for tests only.

## What is implemented

- **Core invariants** (`packages/core`): scope validation and unresolved scope reporting, permission composition that never weakens (`deny → deny`, `ask → ask|deny`, unknown effect throws), session-scoped policy pins that ignore the active pointer and survive agent switches but not server-epoch/worktree changes, observation eligibility gates, terminal outcomes where a missing `execute.after` is `outcome_unknown`, intervention dedup keys, envelopes with explicit `unknown` host ids, data-only policy bundle validation that rejects executable keys, a dummy Jev transport that returns `unavailable` rather than a low probability, an in-memory Lab with idempotent ingestion and a contiguous ack cursor, fixed advisory rendering with role-prefix sanitising, and honest doctor aggregation (`PARTIAL` unless everything ran).
- **Server plugin** (`packages/opencode-server`, Effect API): validates `ctx.options`, registers `prompt` / `context` / `title` / `generate` / `tool.execute.before` / `tool.execute.after` / `permission.evaluate` hooks, records envelopes into a bounded spool persisted through plugin storage, exposes read-only `status`, `snapshot.get`, `review.request` and `review.list` RPC methods with a `changed` event, and subscribes to the public event stream as notification-only. Live Jev is opt-in and only reachable through `review.request`; the request is probe-checked, credential-scanned and budget-limited. Every callback is guarded: a Warden error becomes a recorded `durability_degraded` / `hostCapabilitiesDegraded` flag, never a host error. Warden never rewrites the prompt, tool input, results or errors, and never lowers an observed permission effect.
- **TUI plugin** (`packages/opencode-tui`): a minimal display client that calls `status` over the shared RPC contract and shows a toast; no inference, no learning jobs, no permission decisions.
- **Doctor** (`packages/doctor`): combines installed-host facts, the collected baseline and the conformance results into `warden.doctor/0.1`. It never marks a check as passed by itself.
- **Host-conformance harness** (`fixtures/host-contracts`): starts the installed host in a scratch project with the local OpenAI-compatible mock model on `127.0.0.1`, drives real sessions, and writes machine-readable results. No external network, no API spend, no user data leaves the machine.

## How to run

```bash
npm install                 # workspace links + @opencode/plugin@2.0.7 and effect
npm run typecheck           # every workspace
npm test                    # pure Core tests (node --test, TypeScript type stripping)
npm run conformance         # real host, local mock model (writes checks/host-conformance-2.0.7.json)
node fixtures/host-contracts/collect-host-baseline.mjs --out checks/host-baseline-2.0.7.json --conformance checks/host-conformance-2.0.7.json
node packages/doctor/src/main.ts --out checks/doctor.2.0.7.json --conformance checks/host-conformance-2.0.7.json
```

The conformance runner needs `opencode` on `PATH`. It creates and removes its own scratch directories under the OS temp directory; sessions created against the installed host are deleted at the end of each scenario.

## Executed evidence (2026-09-18, opencode 2.0.7)

| Matrix case | Result | Scope of the evidence |
|---|---|---|
| OC2-001 | PASSED | plugin load, finalizer on `location.reload`, re-load |
| OC2-004 | PASSED | later plugin rewrote the prompt draft; Warden recorded the rewritten text |
| OC2-007 | PASSED | context system part reached the model request, absent from session readback |
| OC2-009 | PASSED | Warden's own recording failed (unwritable log); tool result unchanged, durability degraded reported. Live Jev failure not exercised |
| OC2-011 | PASSED | later `execute.before` hook changed effective input; requested ≠ executed |
| OC2-015 | PASSED | configured deny skipped the permission hook, removed the tool, produced a tool error, no side effect, no `execute.after` |
| OC2-016 | PASSED | `ask` stayed pending while Warden abstained; explicit user reply required |
| OC2-017 | PASSED | `execute.before` ran before `permission.evaluate`; before is not authorization |
| HOST-RPC (extra) | PASSED | typed RPC registration and HTTP call |
| HOST-STORAGE (extra) | PASSED | plugin storage survived a location reload |

Key host facts that changed the design's assumptions are listed in `checks/host-baseline-2.0.7.json` under `observedContracts`, including: local plugin directories needed a root `index.ts` entry; a config deny removes the tool from the model-visible list and produces no `execute.after`; the permission reply body requires `{decision}`; and `execute.before` precedes permission evaluation.

## Live Jev (Phase 2 and the first Phase 3 loop, executed)

`packages/opencode-server/src/jev-live.ts` is Warden's own transport:

- reads the key at call time from the OS credential store (`security find-generic-password -s typesafe-api -w` on macOS); the key is never stored, logged, or returned in a result;
- sends one narrow `{state, questions, model}` request per call and validates every answer field (noul in `[0,1]`, choice probabilities finite/non-negative/sum≈1, no missing answers); invalid values become `invalid_response`, never silent normalisation;
- enforces a per-run request budget and a timeout, and keeps `unavailable`, `invalid_response` and `budget_exhausted` distinct;
- never changes the endpoint on an authentication failure and never turns a probability into an authorization decision.

The server plugin wires it behind an **explicit trigger**:

- `review.request` RPC: the only path that calls Jev. `options.jev.enabled` defaults to `false`; when disabled the call is rejected before any transport work.
- Only registered probes are accepted (`src/probes.ts`); callers cannot supply free-form instructions, so a learned policy cannot introduce new questions.
- State keys are checked (`test_code`, `definitions`), scanned for credential shapes (`scanForCredentials` in Core), and recorded with digests. A credential-shaped value is rejected locally; only the category and field path appear in the result.
- Raw answers are recorded in a bounded review ledger (`review.list`) and in the spool/status counters (`jevObservations`, `jevRejected`); they are observations, never authorization.

`fixtures/jev-live/run-specific-sufficiency.mjs` and `run-loop.mjs` run the thread:

1. judge a test snippet whose expected-value definition is not shown;
2. retrieve the definition through a scope-checked source read (digest + line reference);
3. re-judge with the definition present;
4. record an Episode separating decision-time inputs from the later outcome;
5. generate a data-only candidate bundle (deterministically, not by a model);
6. contract-check it and replay the fixed decision rule over recorded observations;
7. decide: `hold`, because replay does not establish work-level usefulness.

Evidence (2026-09-18, synthetic fixture only — no user, session or repository content was sent):

| run | sufficiency (definition visible) | claim (total is 3) |
|---|---|---|
| jev-crosscheck helper, definitions absent | 0.04 | 0.02 |
| jev-crosscheck helper, `EXPECTED_CALLS = 3` present | 0.88 | 0.96 |
| Warden live transport, definitions absent | 0.04 | 0.02 |
| Warden live transport, `EXPECTED_CALLS = 3` present | 0.86 | 0.96 |
| plugin review RPC on the real host, definitions absent | 0.04 | 0.02 |
| plugin review RPC on the real host, definitions present | 0.87–0.88 | 0.96 |

Artifacts: `checks/jev-live/2026-09-18-specific-sufficiency/` (`request.json` / `response.json` per variant, `state-*.json`, `transport-*.json`, `episode-live.json`, `host-review-observations.json`, `candidate-bundle.json`, `comparison.json`, `decision.json`). Model returned: `jev-1.13.0`. The conformance cases `EXTRA-JEV-DISABLED` and `EXTRA-JEV-LIVE` are in `checks/host-conformance-2.0.7.json`; live Jev is opt-in for runs (`JW_LIVE_JEV=1` or `npm run conformance:live`).

## Not implemented / not executed

- Jev fault injection (429/timeout/invalid distribution), stale-snapshot application, cold/warm and language comparisons: `NOT_RUN`.
- Lab handshake/outbox and durable episode storage: `NOT_RUN` (episodes are files here).
- TUI plugin loading and slot rendering: `NOT_RUN` (no interactive TUI session was exercised).
- Worktree/executor isolation, mutation testing, work-level comparison, promotion/rollback: `NOT_RUN`; the candidate above is held at `replay_passed`.
- Event-stream reconnect/dedup semantics, epoch change, multi-client controller lease: `NOT_RUN`.
- Real provider models: every OpenCode model call in testing went to the local mock.

## Non-goals held in this change unit

No prompt replacement, no permission weakening, no confidence-based authorization, no arbitrary code loading from learned policies, no registry reload as a policy deploy, no claim that worktree equals sandbox, no hidden fallback when host data is missing — unresolved scope, missing evidence and unobserved terminals are recorded as such.
