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
- **Server plugin** (`packages/opencode-server`, Effect API): validates `ctx.options`, registers `prompt` / `context` / `title` / `generate` / `tool.execute.before` / `tool.execute.after` / `permission.evaluate` hooks, records envelopes into a bounded spool persisted through plugin storage, exposes read-only `status` and `snapshot.get` RPC methods with a `changed` event, and subscribes to the public event stream as notification-only. Every callback is guarded: a Warden error becomes a recorded `durability_degraded` / `hostCapabilitiesDegraded` flag, never a host error. Warden never rewrites the prompt, tool input, results or errors, and never lowers an observed permission effect.
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

## Not implemented / not executed

- Live Jev evaluation, Lab handshake/outbox, and any semantic probe: `NOT_RUN` (no credential or endpoint was used).
- TUI plugin loading and slot rendering: `NOT_RUN` (no interactive TUI session was exercised).
- Worktree/executor isolation, mutation testing, candidate generation, promotion/rollback loops: `NOT_RUN` (roadmap Phases 2–4).
- Event-stream reconnect/dedup semantics, epoch change, multi-client controller lease: `NOT_RUN`.
- Real provider models: every model call in testing went to the local mock.

## Non-goals held in this change unit

No prompt replacement, no permission weakening, no confidence-based authorization, no arbitrary code loading from learned policies, no registry reload as a policy deploy, no claim that worktree equals sandbox, no hidden fallback when host data is missing — unresolved scope, missing evidence and unobserved terminals are recorded as such.
