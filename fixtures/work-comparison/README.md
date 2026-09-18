# Work comparison fixture

Compares three arms on a fixed task with a real model:

- **control** — no Warden;
- **baseline** — Warden observe-only;
- **candidate** — Warden plus one operator-fixed advisory line injected through the context hook.

Correctness is scored by a deterministic sentinel (`ANSWER: <n>`), and tool-call counts plus duration are recorded per arm. Thresholds (primary metric, minimum trials per arm for adoption) are pre-registered in the script before any run.

```bash
node fixtures/work-comparison/run.mjs --model deepseek/deepseek-flash --trials 3
```

This makes real provider calls. Results and the decision live under `checks/work-comparison/<date>/`. With fewer than the pre-registered 8 trials per arm the decision is always `hold`; a small run demonstrates the pipeline, not adoption.
