# Lab (minimal, durable)

The Lab owns durable records. This package is the smallest useful step: a SQLite store and an outbox ingester.

- The server plugin appends observed `EventEnvelope` JSON lines to `options.outboxPath` (relative paths resolve against the location directory). Delivery is at-least-once: after a restart the in-memory spool is re-sent and the Lab dedups by envelope id.
- `src/store.mjs` opens/creates the database, ingests lines idempotently, and advances a per-`(server, epoch)` ack cursor only across a contiguous sequence from 1.
- `src/ingest.mjs` ingests one outbox file; `src/report.mjs` prints totals, per-type counts, stream cursors and recent events.

```bash
node packages/lab/src/ingest.mjs --db .warden/lab.db --outbox .warden/outbox.jsonl
node packages/lab/src/report.mjs --db .warden/lab.db
node --test "packages/lab/test/*.test.mjs"
```

Not implemented here: jobs, lease, retry scheduling, episode tables, candidate storage, deletion/export tracking. Those are Phase 3+ work. The outbox file grows until the Lab acks; ack-back and rotation are not implemented yet.
