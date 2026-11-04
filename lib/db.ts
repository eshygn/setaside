// SQLite (better-sqlite3), seeded on first use. One file under data/ (git-ignored); delete it
// or press "Reset demo" to start over. Server-side only.

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS tx (
  id TEXT PRIMARY KEY,
  datetime TEXT NOT NULL,
  date TEXT NOT NULL,
  event_code TEXT,
  status TEXT,
  amount_minor INTEGER NOT NULL,
  fee_minor INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL,
  payer_name TEXT,
  payer_email TEXT,
  subject TEXT,
  note TEXT,
  invoice_id TEXT,
  balance_minor INTEGER,
  origin TEXT NOT NULL,          -- 'seed' (demo history) or 'sandbox' (live PayPal)
  raw TEXT NOT NULL              -- the transaction_details item exactly as PayPal returned it
);
CREATE INDEX IF NOT EXISTS tx_date ON tx(date);

CREATE TABLE IF NOT EXISTS classification (
  tx_id TEXT PRIMARY KEY REFERENCES tx(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  confidence INTEGER NOT NULL,   -- 0..100
  reason TEXT NOT NULL,
  method TEXT NOT NULL,          -- 'ai' | 'recorded' | 'heuristic' | 'rule' | 'manual'
  state TEXT NOT NULL,           -- review state machine, see lib/review.ts
  rule_id TEXT,
  model TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rule (
  id TEXT PRIMARY KEY,
  payer_email TEXT,
  payer_name TEXT,
  note_contains TEXT,
  event_code TEXT,
  category TEXT NOT NULL,
  created_from TEXT NOT NULL,
  description TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS invoice (
  id TEXT PRIMARY KEY,
  number TEXT,
  status TEXT NOT NULL,
  recipient TEXT,
  amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL,
  tx_id TEXT,
  invoice_date TEXT,
  origin TEXT NOT NULL,          -- 'seed' | 'sandbox' | 'mock' (created by SetAside without live Invoicing)
  raw TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_cache (key TEXT PRIMARY KEY, value TEXT NOT NULL, created_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS layout (id TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
`;

let db: Database.Database | undefined;

export function getDb(): Database.Database {
  if (db) return db;
  const file = process.env.SETASIDE_DB ?? path.join(process.cwd(), 'data', 'setaside.db');
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

export function kvGet(key: string): string | undefined {
  const row = getDb().prepare('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value;
}

export function kvSet(key: string, value: string) {
  getDb().prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

/** Wipe everything except the AI cache (which keeps Gemini calls down across resets). */
export function wipe() {
  const d = getDb();
  d.exec('DELETE FROM classification; DELETE FROM tx; DELETE FROM rule; DELETE FROM invoice; DELETE FROM kv; DELETE FROM layout;');
}
