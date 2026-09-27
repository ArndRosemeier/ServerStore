/**
 * Metadata: one SQLite database, one place that defines its shape.
 *
 * `node:sqlite` (`DatabaseSync`) ships in Node 24 and loads with NO flag (verified
 * on this box: `node -e "new (require('node:sqlite').DatabaseSync)(':memory:')"`).
 * That is why there is no native dependency here (ledger row 11, brief §3).
 *
 * The schema is applied idempotently at every boot: `CREATE TABLE IF NOT EXISTS`
 * plus an `ON CONFLICT DO NOTHING` seed. Migrations are additive-only; a schema
 * change adds a statement to MIGRATIONS and never rewrites one.
 */

import { DatabaseSync } from "node:sqlite";

/** The store kind that exists from day one, and thus the one the column defaults to. */
export const DEFAULT_STORE_KIND = "bytes";

const MIGRATIONS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS store_kinds (
     kind TEXT PRIMARY KEY
   )
   STRICT`,
  `INSERT INTO store_kinds(kind) VALUES ('bytes')
   ON CONFLICT(kind) DO NOTHING`,
  `CREATE TABLE IF NOT EXISTS stores (
     name TEXT PRIMARY KEY,
     kind TEXT NOT NULL REFERENCES store_kinds(kind),
     created_at TEXT NOT NULL
   )
   STRICT`,
  `CREATE TABLE IF NOT EXISTS objects (
     store TEXT NOT NULL,
     name TEXT NOT NULL,
     sha256 TEXT NOT NULL,
     size INTEGER NOT NULL,
     created_at TEXT NOT NULL,
     PRIMARY KEY(store, name)
   )
   STRICT`,
  `CREATE TABLE IF NOT EXISTS access_keys (
     id TEXT PRIMARY KEY,
     store TEXT,
     label TEXT NOT NULL,
     key_hash TEXT NOT NULL,
     prefix TEXT NOT NULL,
     perms TEXT NOT NULL,
     subject_kind TEXT NOT NULL,
     created_at TEXT NOT NULL,
     expires_at TEXT,
     last_used_at TEXT,
     revoked_at TEXT
   )
   STRICT`,
  `CREATE INDEX IF NOT EXISTS access_keys_hash ON access_keys(key_hash)`,
];

/**
 * Open (creating if needed) the metadata database and apply the schema.
 *
 * `dbPath` is passed in by the caller — nothing here reads `process.env`, so a test
 * can point it at a temp directory and `main.ts` can point it at the real data root.
 */
export function openDatabase(dbPath: string): DatabaseSync {
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON");
  // Rollback journal, deliberately NOT WAL: this box runs one process against one
  // file, so WAL buys nothing, and it would scatter a just-minted key's row into a
  // `-wal` sidecar. Pin 5 asserts the raw key is absent from the database BYTES; a
  // DELETE journal keeps every committed row inside that one file, so the pin tests
  // the claim rather than the journal mode.
  db.exec("PRAGMA journal_mode = DELETE");
  for (const statement of MIGRATIONS) {
    db.exec(statement);
  }
  return db;
}
