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
  opencode-server/     Effect server plugin: hooks, spool, outbox, status, RPC, live Jev
  opencode-tui/        TUI plugin: status command over the read-only RPC
  lab/                 SQLite store and outbox ingester
  doctor/              CLI that merges host facts and conformance results
fixtures/
  host-contracts/      mock model server, probe plugin, scenario runner, baseline collector
  jev-live/            episode runner and candidate/replay loop
  work-comparison/     control / baseline / candidate work comparison
opencode.json          load the server plugin in this repository (observe-only)
appendix/              original design artifacts (unchanged except acceptance-matrix status)
```

`packages/core` has two tsconfigs: `tsconfig.json` typechecks `src` with `types: []` so Node/DOM globals cannot leak in, and `tsconfig.test.json` adds Node types for tests only.

## What is implemented

- **Core invariants** (`packages/core`): scope validation and unresolved scope reporting, permission composition that never weakens (`deny → deny`, `ask → ask|deny`, unknown effect throws), session-scoped policy pins that ignore the active pointer and survive agent switches but not server-epoch/worktree changes, observation eligibility gates, terminal outcomes where a missing `execute.after` is `outcome_unknown`, intervention dedup keys, envelopes with explicit `unknown` host ids, data-only policy bundle validation that rejects executable keys, a dummy Jev transport that returns `unavailable` rather than a low probability, an in-memory Lab with idempotent ingestion and a contiguous ack cursor, fixed advisory rendering with role-prefix sanitising, and honest doctor aggregation (`PARTIAL` unless everything ran).
- **Server plugin** (`packages/opencode-server`, Effect API): validates `ctx.options`, registers `prompt` / `context` / `title` / `generate` / `tool.execute.before` / `tool.execute.after` / `permission.evaluate` hooks, records envelopes into a bounded spool persisted through plugin storage, exposes read-only `status`, `snapshot.get`, `review.request` and `review.list` RPC methods with a `changed` event, and subscribes to the public event stream as notification-only. Live Jev is opt-in and only reachable through `review.request`; the request is probe-checked, credential-scanned and budget-limited. Every callback is guarded: a Warden error becomes a recorded `durability_degraded` / `hostCapabilitiesDegraded` flag, never a host error. Warden never rewrites the prompt, tool input, results or errors, and never lowers an observed permission effect.
- **TUI plugin** (`packages/opencode-tui`): a minimal display client that calls `status` over the shared RPC contract and shows a toast; no inference, no learning jobs, no permission decisions.
- **Lab** (`packages/lab`): SQLite store with idempotent ingestion by envelope id and a per-`(server, epoch)` ack cursor that only advances across a contiguous sequence. The server plugin appends a JSONL outbox; the Lab ingests it at-least-once.
- **Doctor** (`packages/doctor`): combines installed-host facts, the collected baseline and the conformance results into `warden.doctor/0.1`. It never marks a check as passed by itself.
- **Host-conformance harness** (`fixtures/host-contracts`): starts the installed host in a scratch project with the local OpenAI-compatible mock model on `127.0.0.1`, drives real sessions, and writes machine-readable results. No external network, no API spend, no user data leaves the machine.

## How to run

```bash
npm install                 # workspace links + @opencode/plugin@2.0.7 and effect
npm run typecheck           # every workspace
npm test                    # Core 14 + server 15 + Lab 3
npm run conformance         # real host, local mock model (writes checks/host-conformance-2.0.7.json)
npm run conformance:live    # same plus live Jev review cases (uses the OS credential store)
npm run lab:ingest          # ingest .warden/outbox.jsonl into .warden/lab.db
npm run lab:report          # print Lab totals, streams and recent events
npm run work:compare        # 3-arm work comparison with deepseek-flash (real provider calls)
node fixtures/host-contracts/collect-host-baseline.mjs --out checks/host-baseline-2.0.7.json --conformance checks/host-conformance-2.0.7.json
node packages/doctor/src/main.ts --out checks/doctor.2.0.7.json --conformance checks/host-conformance-2.0.7.json
```

In this repository, ordinary OpenCode sessions load Warden through `opencode.json` in observe-only mode; `.warden/outbox.jsonl` accumulates the durable outbox.

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

## Daily connection and durable Lab (executed)

`opencode.json` in this repository loads the server plugin in observe-only mode with `jev.enabled: false` and `outboxPath: ".warden/outbox.jsonl"` (relative to the location). This makes Warden run in ordinary sessions in this repository.

Evidence from the first live session after connecting:

- `opencode plugin list` shows `jev-warden` active for this location.
- The outbox filled while this conversation itself was running (tool requested/completed, permission evaluated, context observed), and this session's own id is in the records.
- `node packages/lab/src/ingest.mjs` stored the outbox with contiguous per-epoch ack cursors; re-ingesting inserted 0 and reported only duplicates. Snapshot: `checks/lab-report-2026-09-18.json`.
- The RPC status endpoint works from the running service (`opencode api POST /api/rpc/jev-warden/status -H "x-opencode-directory: <repo>"`), showing live counters for this session.

Reload-loop incident and fix: writing the outbox inside the location directory originally fed the host's config watcher, and each append triggered a location reload (dozens of plugin generations, outbox inflated to ~180 KB). The plugin now refuses an inside-location outbox unless `allowOutboxInLocation` is explicitly set, and this repository additionally sets `watcher.ignore: [".warden/**"]`. Before the fix the log showed a load every ~8 s; after it, loads align only with deliberate file edits.

This is still observe-only: no Jev call fires from hooks, prompt/tool/permission behavior is unchanged, and `.warden/` is git-ignored runtime data.

## Spec fidelity crosschecks (jev-crosscheck, executed)

Against `jev-warden-opencode2-design-v0.1.md`, using allowlisted excerpts only (design text + implementation code, no user content). Files: `checks/jev-live/2026-09-18-fidelity/`. Model returned `jev-1.13.0`.

| assertion | before | after fix |
|---|---|---|
| scope fidelity (4.1: do not decide scope from `ctx.location` alone; mark unresolved) | 0.20 (sufficiency 0.38) | **0.91** (sufficiency 0.56) |
| session policy pin (16.1: pin per session) | 0.06 (sufficiency 0.13) | **0.87** (sufficiency 0.92) |
| guidance envelope (8.1: quoted data, not instructions) | 0.97 (sufficiency 0.74) | unchanged |

The low answers matched code inspection, so two behaviors were changed rather than papered over:

- `EventEnvelope` gained `unresolvedFields`; session events without their own verified location now record `["projectId","worktreeId"]` as unresolved instead of presenting location-derived values as session scope.
- The runtime binds the built-in `baseline-observe-only` policy to a session at first observation through Core `SessionPins`; envelopes for that session carry the pinned id/digest, the pin is stable across agent switches, and `snapshot.get` reports `pinnedSessions`, `unresolvedScopeEvents` and the baseline policy. Adopted-bundle application is still not implemented.

Probabilities are not acceptance: the fixes are confirmed by the Core and server tests (15 + 23) and by code review; the second crosscheck only guided where to look.

## Work comparison (executed, small n)

`fixtures/work-comparison/run.mjs` solves a fixed task with a real model in three arms and scores correctness with a deterministic sentinel, separately from tool-call count and duration. Thresholds are pre-registered in the script.

Run of 2026-09-18 with `deepseek/deepseek-flash`, 3 trials per arm:

| arm | correct | mean tool calls | mean duration |
|---|---|---|---|
| control (no Warden) | 3/3 | 4.0 | 6.6s |
| baseline (Warden observe-only) | 3/3 | 5.67 | 9.3s |
| candidate (Warden + fixed advisory) | 3/3 | 4.67 | 7.8s |

Decision: **hold** — correctness did not separate, the tool-call difference is within noise at n=3, and the pre-registered minimum is 8 trials per arm. Artifacts: `checks/work-comparison/2026-09-18/`.

## Not implemented / not executed

- Jev fault injection (429/timeout/invalid distribution), stale-snapshot application, cold/warm and language comparisons: `NOT_RUN`.
- Adopted PolicyBundle application (fetch/validate/replace the baseline pin), bundle promotion and rollback: `NOT_RUN`; only the built-in baseline pin is bound.
- Episode/candidate storage in the Lab (episodes are still files) and outbox ack-back to the plugin: `NOT_RUN`.
- TUI plugin loading and slot rendering: `NOT_RUN` (no interactive TUI session was exercised).
- Work comparison at the pre-registered volume, adoption, rollback, retirement: `NOT_RUN`; the candidate from the episode is held.
- Worktree/executor isolation and mutation testing: `NOT_RUN`.
- Event-stream reconnect/dedup semantics, epoch change, multi-client controller lease: `NOT_RUN`.
- Real provider models beyond the small `deepseek-flash` work comparison: not used.

## Non-goals held in this change unit

No prompt replacement, no permission weakening, no confidence-based authorization, no arbitrary code loading from learned policies, no registry reload as a policy deploy, no claim that worktree equals sandbox, no hidden fallback when host data is missing — unresolved scope, missing evidence and unobserved terminals are recorded as such.
