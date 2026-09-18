/**
 * Durable Lab store.
 *
 * Ingestion is at-least-once: the outbox may re-send events after a restart,
 * and this store dedups by envelope id. The ack cursor advances only across a
 * contiguous sequence from 1 within one (server, epoch) stream.
 */
import { DatabaseSync } from "node:sqlite"
import { existsSync, readFileSync } from "node:fs"

export function openLab(path) {
  const db = new DatabaseSync(path)
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      server_id TEXT NOT NULL,
      server_epoch TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      type TEXT NOT NULL,
      origin TEXT NOT NULL,
      session_id TEXT,
      observed_at INTEGER NOT NULL,
      envelope TEXT NOT NULL,
      ingested_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS events_stream ON events (server_id, server_epoch, sequence);
    CREATE TABLE IF NOT EXISTS streams (
      server_id TEXT NOT NULL,
      server_epoch TEXT NOT NULL,
      ack_sequence INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (server_id, server_epoch)
    );
  `)
  return db
}

export function ingestLines(db, lines, now = Date.now()) {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO events
      (id, server_id, server_epoch, sequence, type, origin, session_id, observed_at, envelope, ingested_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  let inserted = 0
  let duplicates = 0
  let invalid = 0
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    let envelope
    try {
      envelope = JSON.parse(trimmed)
    } catch {
      invalid += 1
      continue
    }
    if (
      typeof envelope?.id !== "string" ||
      typeof envelope?.serverId !== "string" ||
      typeof envelope?.serverEpoch !== "string" ||
      typeof envelope?.sequence !== "number" ||
      typeof envelope?.type !== "string"
    ) {
      invalid += 1
      continue
    }
    const result = insert.run(
      envelope.id,
      envelope.serverId,
      envelope.serverEpoch,
      envelope.sequence,
      envelope.type,
      typeof envelope.origin === "string" ? envelope.origin : "unknown",
      typeof envelope.sessionId === "string" ? envelope.sessionId : null,
      typeof envelope.observedAt === "number" ? envelope.observedAt : now,
      trimmed,
      now,
    )
    if (result.changes === 1) inserted += 1
    else duplicates += 1
  }
  const ack = updateAck(db, now)
  return { inserted, duplicates, invalid, ack }
}

export function ingestFile(db, path, now = Date.now()) {
  if (!existsSync(path)) return { read: 0, inserted: 0, duplicates: 0, invalid: 0, ack: [] }
  const lines = readFileSync(path, "utf8").split("\n")
  const result = ingestLines(db, lines, now)
  return { read: lines.length, ...result }
}

function updateAck(db, now) {
  const streams = db.prepare(`SELECT DISTINCT server_id, server_epoch FROM events`).all()
  const upsert = db.prepare(`
    INSERT INTO streams (server_id, server_epoch, ack_sequence, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT (server_id, server_epoch)
    DO UPDATE SET ack_sequence = excluded.ack_sequence, updated_at = excluded.updated_at
  `)
  const acks = []
  for (const stream of streams) {
    const sequences = db
      .prepare(`SELECT sequence FROM events WHERE server_id = ? AND server_epoch = ? ORDER BY sequence`)
      .all(stream.server_id, stream.server_epoch)
      .map((row) => row.sequence)
    let ack = 0
    for (const sequence of sequences) {
      if (sequence === ack + 1) ack += 1
      else if (sequence > ack + 1) break
    }
    upsert.run(stream.server_id, stream.server_epoch, ack, now)
    acks.push({ serverId: stream.server_id, serverEpoch: stream.server_epoch, ackSequence: ack })
  }
  return acks
}

export function summary(db) {
  const totals = db.prepare(`SELECT COUNT(*) AS events FROM events`).get()
  const types = db.prepare(`SELECT type, COUNT(*) AS count FROM events GROUP BY type ORDER BY count DESC`).all()
  const streams = db.prepare(`SELECT server_id, server_epoch, ack_sequence FROM streams ORDER BY server_id, server_epoch`).all()
  const recent = db
    .prepare(`SELECT id, sequence, type, session_id, observed_at FROM events ORDER BY ingested_at DESC LIMIT 10`)
    .all()
  return { events: totals.events, types, streams, recent }
}
