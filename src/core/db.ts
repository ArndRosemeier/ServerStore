/**
 * Metadata: one SQLite database, one place that defines its shape.
 *
 * `node:sqlite` (`DatabaseSync`) ships in Node 24 and loads with NO flag (verified
 * on this box: `node -e "new (require('node:sqlite').DatabaseSync)(':memory:')"`).
 * That is why there is no native dependency here (ledger row 11, brief §3).
 *
 * The schema is applied idempotently at every boot: `CREATE TABLE IF NOT EXISTS`
 * plus an `ON CONFLICT DO NOTHING` seed. Migrations are additive-only; a schema
 * change adds a statement to MIGRATIONS and never rewrites one — EXCEPT the
 * pre-slice-8 scope migration below, which rewrites the ONE table whose shape it
 * replaces and is guarded by the presence of the old column, so it runs exactly once.
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
  // THE SHAPE OF A KEY'S SCOPE (ledger row 41, slice 8). A key spans a SET of
  // stores, and `*` (every store) cannot be an FK value because `*` is not a row in
  // `stores` — so the two cases are modelled separately ON PURPOSE:
  //   - `scope_all = 1` is the master case (`["*"]`), expressible with no row here;
  //   - every OTHER scope is one `key_stores` row per store, which keeps the foreign
  //     key MEANINGFUL: a scope can never name a store that does not exist.
  // The pre-slice-8 `access_keys.store` column is GONE (dropped by the migration
  // below, absent from this shape), so no code can read it as a second source of
  // truth — there is exactly one place a scope is stored (here) and one place it is
  // read (`src/core/keys.ts`).
  `CREATE TABLE IF NOT EXISTS access_keys (
     id TEXT PRIMARY KEY,
     scope_all INTEGER NOT NULL DEFAULT 0,
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
  `CREATE TABLE IF NOT EXISTS key_stores (
     key_id TEXT NOT NULL REFERENCES access_keys(id) ON DELETE CASCADE,
     store TEXT NOT NULL REFERENCES stores(name),
     PRIMARY KEY (key_id, store)
   )
   STRICT`,
];

/**
 * The statements that carry a PRE-slice-8 database (one nullable `access_keys.store`)
 * onto the set model. Applied only while the old column exists, inside ONE
 * transaction: a crash mid-migration rolls back to the old shape rather than leaving
 * a key with a half-copied scope.
 *
 * `store = '*'` becomes `scope_all = 1` (the master case, which no FK can hold);
 * every other row becomes exactly one `key_stores` row. The last statement DROPS the
 * old column, which is what makes this migration idempotent AND makes the old value
 * unreadable afterwards. A legacy row naming a store that does not exist makes the
 * INSERT fail the foreign key — LOUDLY, at boot, rather than silently minting a key
 * with no scope (AGENTS.md rule 1).
 */
const LEGACY_SCOPE_MIGRATION: readonly string[] = [
  `ALTER TABLE access_keys ADD COLUMN scope_all INTEGER NOT NULL DEFAULT 0`,
  `UPDATE access_keys SET scope_all = 1 WHERE store = '*'`,
  `INSERT INTO key_stores(key_id, store) SELECT id, store FROM access_keys WHERE store IS NOT NULL AND store <> '*'`,
  `ALTER TABLE access_keys DROP COLUMN store`,
];

/** Does `table` currently have a column named `column`? */
function hasColumn(db: DatabaseSync, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as unknown as { name: string }[];
  return rows.some((row) => row.name === column);
}

function migrateLegacyKeyScope(db: DatabaseSync): void {
  // A fresh database is created in the new shape, so there is nothing to carry over.
  if (!hasColumn(db, "access_keys", "store")) return;
  db.exec("BEGIN");
  try {
    for (const statement of LEGACY_SCOPE_MIGRATION) db.exec(statement);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw new Error(
      `could not migrate the pre-slice-8 access_keys.store column to key_stores: ` +
        `${(error as Error).message}. A key scoped to a store that no longer exists is ` +
        `refused rather than given an empty scope.`,
    );
  }
}

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
  migrateLegacyKeyScope(db);
  return db;
}
