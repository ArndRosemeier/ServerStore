/**
 * The database: one SQLite file, one place that defines its shape.
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
 * A column ADDED to an existing table cannot come from `CREATE TABLE IF NOT EXISTS`
 * (which is a no-op once the table exists), so it lands as an add-if-absent step:
 * `migrateKeyAuditColumns` for the slice-11 edit audit columns, and
 * `migrateObjectContentColumn` for slice 17's item bytes (ledger row 79).
 *
 * ## The concurrency settings, and why each one is here (ledger rows 77, 78)
 *
 * `journal_mode = WAL` is what makes a reader NEVER wait on a writer — measured on
 * this box (row 77): in `DELETE` mode a reader hit the writer's lock on ~22% of reads,
 * in WAL on 0%. `busy_timeout` makes a second WRITER QUEUE instead of failing with
 * `database is locked` (SQLite still serialises writers). `synchronous = FULL` fsyncs
 * the WAL on every commit: corruption-safety over write speed, which is the trade the
 * owner chose. And every multi-statement mutation runs inside `BEGIN IMMEDIATE`
 * ({@link withImmediateTransaction}) so the write lock is taken UP FRONT rather than
 * on an upgrade, which is the one case SQLite does not retry under `busy_timeout`.
 *
 * The three settings are pinned by PIN Y4–Y7 (`tests/concurrency.test.ts`).
 */

import { DatabaseSync } from "node:sqlite";

/** The store kind that exists from day one, and thus the one the column defaults to. */
export const DEFAULT_STORE_KIND = "bytes";

/**
 * How long a connection waits for a lock another connection holds, in milliseconds.
 *
 * 5000 ms is chosen to be far longer than any write this service performs (its
 * largest mutation is a store delete, and the whole gate's write burst is bounded by
 * seconds) while still finite: a deadlock ends in a loud error after five seconds
 * rather than hanging a request forever. Named here because PIN Y7 asserts it is
 * non-zero and the docs quote it; there is no second place it is written.
 */
export const BUSY_TIMEOUT_MS = 5000;

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
  // ONE ROW PER ENTRY, and since slice 17 (ledger row 79) the row CARRIES the bytes:
  // `content` is the object's content, `sha256`/`size` are the hash and length of those
  // very bytes, and `created_at` is when this name was last written. `content` is
  // nullable in BOTH the fresh shape and the migrated one — SQLite cannot add a NOT NULL
  // column without inventing a default, and a default value for content would be a lie —
  // so "content is not NULL for every row" is an invariant enforced by the boot import
  // (`src/storage/migrate.ts`) and checked loudly on every read, never by a silent
  // fallback. `store`, `name`, `sha256`, `size` and `created_at` are UNCHANGED: the
  // `sha256` column is still the content hash the API exposes as `x-serverstore-sha256`.
  `CREATE TABLE IF NOT EXISTS objects (
     store TEXT NOT NULL,
     name TEXT NOT NULL,
     sha256 TEXT NOT NULL,
     size INTEGER NOT NULL,
     created_at TEXT NOT NULL,
     content BLOB,
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
     revoked_at TEXT,
     updated_at TEXT,
     updated_by TEXT
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
 * The audit columns of an EDIT (ledger row 52, slice 11): when a key was last changed
 * and by WHICH key. Add-if-absent, one step per column, so the guard is the column's
 * own absence — the B1 pattern. A never-edited key keeps NULL, which is what the
 * console renders as "never changed"; nothing is ever back-filled from `created_at`
 * (that would be a lie about when the grant changed).
 *
 * `updated_by` holds the EDITING key's **id** — the public lookup id the inventory
 * already lists — never its raw value or its hash, so no secret can reach a stored
 * audit field through a database read.
 */
const KEY_AUDIT_MIGRATION: readonly { readonly column: string; readonly statement: string }[] = [
  { column: "updated_at", statement: "ALTER TABLE access_keys ADD COLUMN updated_at TEXT" },
  { column: "updated_by", statement: "ALTER TABLE access_keys ADD COLUMN updated_by TEXT" },
];

/**
 * Run `fn` inside ONE `BEGIN IMMEDIATE` … `COMMIT`, rolling back on any throw.
 *
 * THIS is the ONE transaction seam (ledger rows 77/78): every multi-statement
 * mutation in this codebase goes through it — minting a key (the key row plus its
 * scope rows), editing one, the two-step store delete, and each store's slice of the
 * boot import. `IMMEDIATE` takes the write lock when the transaction BEGINS rather
 * than when the first statement needs it, so a second writer QUEUES under
 * `busy_timeout` instead of failing `database is locked` on a lock upgrade — the one
 * failure `busy_timeout` does not retry in WAL.
 *
 * The body must be SYNCHRONOUS: `node:sqlite` is synchronous, so an `await` inside
 * would let another request's statement run INSIDE this transaction on the same
 * connection. Callers do not await inside the callback, and the callback's return
 * value is passed through.
 *
 * A failed ROLLBACK is reported too, never swallowed: it means the connection is in a
 * state the caller must know about, and a bare rethrow would hide it (AGENTS.md rule 1).
 */
export function withImmediateTransaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch (rollbackError) {
      throw new Error(
        `transaction failed (${(error as Error).message}) and ROLLBACK also failed ` +
          `(${(rollbackError as Error).message})`,
      );
    }
    throw error;
  }
}

/**
 * Apply {@link KEY_AUDIT_MIGRATION} to a database that predates it. Idempotent (the
 * column's absence is the guard, so a second boot adds nothing) and atomic (both
 * columns land together or neither does), and LOUD on failure rather than booting a
 * process whose edit route would then die on a missing column.
 */
function migrateKeyAuditColumns(db: DatabaseSync): void {
  const missing = KEY_AUDIT_MIGRATION.filter((step) => !hasColumn(db, "access_keys", step.column));
  if (missing.length === 0) return;
  try {
    withImmediateTransaction(db, () => {
      for (const step of missing) db.exec(step.statement);
    });
  } catch (error) {
    throw new Error(
      `could not add the key-audit columns (${missing.map((step) => step.column).join(", ")}) ` +
        `to access_keys: ${(error as Error).message}`,
    );
  }
}

/**
 * The slice-17 add-if-absent step (ledger row 79), in the shape rows 42/53 established:
 * the guard is the COLUMN'S OWN ABSENCE, so a second boot adds nothing and a fresh
 * database (whose `CREATE TABLE` already carries `content`) is untouched.
 *
 * Nullable on purpose, in the fresh shape AND the migrated one: SQLite cannot add a
 * NOT NULL column without a default, and any default for object content would be an
 * invented value. The invariant "every row's content is present and hashes to its
 * `sha256`" is established by the boot import (`src/storage/migrate.ts`) and enforced
 * loudly at read time, never by a fallback.
 */
function migrateObjectContentColumn(db: DatabaseSync): void {
  if (hasColumn(db, "objects", "content")) return;
  try {
    withImmediateTransaction(db, () => {
      db.exec("ALTER TABLE objects ADD COLUMN content BLOB");
    });
  } catch (error) {
    throw new Error(
      `could not add the objects.content column: ${(error as Error).message}. The item ` +
        `bytes cannot be stored without it, so the boot is refused rather than serving ` +
        `a database whose rows would fail on every read.`,
    );
  }
}

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
  try {
    withImmediateTransaction(db, () => {
      for (const statement of LEGACY_SCOPE_MIGRATION) db.exec(statement);
    });
  } catch (error) {
    throw new Error(
      `could not migrate the pre-slice-8 access_keys.store column to key_stores: ` +
        `${(error as Error).message}. A key scoped to a store that no longer exists is ` +
        `refused rather than given an empty scope.`,
    );
  }
}

/**
 * Open (creating if needed) the database and apply the schema and the pragmas.
 *
 * `dbPath` is passed in by the caller — nothing here reads `process.env`, so a test
 * can point it at a temp directory and `main.ts` can point it at the real data root.
 *
 * The pragmas are the concurrency contract (ledger rows 77/78) and their ORDER
 * matters: `busy_timeout` first, so even the journal-mode change queues rather than
 * failing on a lock; then `foreign_keys`; then `journal_mode = WAL` (persisted in the
 * FILE, so it is set once and stays); then `synchronous = FULL` (per connection, so it
 * is set on every open). PIN Y7 asserts all four values on a connection this function
 * produced.
 */
export function openDatabase(dbPath: string): DatabaseSync {
  const db = new DatabaseSync(dbPath);
  db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
  db.exec("PRAGMA foreign_keys = ON");
  // WAL, deliberately (ledger rows 77, 78): a reader must never be blocked by a
  // writer. The cost, said plainly in docs/STORAGE.md: a database now has `-wal` and
  // `-shm` sidecars, so a backup must copy all three files or use SQLite's own backup
  // — a plain copy of `serverstore.db` alone can miss the newest commits.
  db.exec("PRAGMA journal_mode = WAL");
  // Corruption-safety over write speed: fsync the WAL on every commit.
  db.exec("PRAGMA synchronous = FULL");
  for (const statement of MIGRATIONS) {
    db.exec(statement);
  }
  migrateLegacyKeyScope(db);
  migrateKeyAuditColumns(db);
  migrateObjectContentColumn(db);
  return db;
}
