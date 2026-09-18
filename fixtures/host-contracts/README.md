# Host-conformance fixtures

These fixtures verify Warden's assumptions against the **installed** OpenCode host. They are not Warden itself and they are not a substitute for the pure Core tests.

## Pieces

- `mock-model-server.mjs` — a local OpenAI-compatible chat-completions server implementing streaming responses and scripted tool calls. It binds only to `127.0.0.1` and never contacts a provider.
- `probe/` — a fixture plugin (Effect API) that registers the mock provider, logs hook ordering as JSONL, optionally rewrites a prompt draft or mutates tool input, registers a small RPC, and checks storage durability.
- `run-host-conformance.mjs` — starts the installed host against a scratch project, waits for the location to boot, reloads, activates the plugins, drives sessions, asserts observable behavior, and (when live Jev is enabled) exercises the `review.request` RPC against synthetic fixture state.
- `collect-host-baseline.mjs` — records installed versions, digests, package-lock integrity, and the contract statements the conformance run produced.

## Safety

- OpenCode provider calls: none. The only model endpoint is the local mock on `127.0.0.1`.
- Live Jev: opt-in only (`JW_LIVE_JEV=1` or `npm run conformance:live`). It sends the synthetic `test_code` / `definitions` fixture state to TypeSafe through the plugin's `review.request` RPC; no user, session or repository content is sent. Two requests per live run.
- Scratch projects live in the OS temp directory and are deleted unless `--keep true` is passed.
- Sessions created in the installed host are deleted at the end of each scenario.
- The harness changes nothing in the user's global OpenCode config.

## Usage

```bash
node fixtures/host-contracts/run-host-conformance.mjs --out checks/host-conformance.json
node fixtures/host-contracts/run-host-conformance.mjs --filter OC2-015 --keep true
node fixtures/host-contracts/collect-host-baseline.mjs --out checks/host-baseline.json --conformance checks/host-conformance.json
```

`--filter` runs cases whose id contains the value. `--keep true` leaves the scratch directory and JSONL evidence for inspection.
