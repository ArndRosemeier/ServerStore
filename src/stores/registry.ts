/**
 * The store registry — the ONE place that knows which stores exist.
 *
 * A store is `{ name, kind }`. `kind` is what the dispatch point keys on, so a new
 * store KIND is an addition (a handler in `src/storage/kinds.ts` plus a seed) and a
 * new store INSTANCE is a row. The `master` store is seeded idempotently at every
 * boot (ledger row 10) — a second boot finds it and does nothing.
 *
 * A store that is not registered is a 404, never an empty listing and never an
 * implicit creation.
 */

import type { DatabaseSync } from "node:sqlite";
import { StoreError } from "../core/errors.ts";
import { DEFAULT_STORE_KIND } from "../core/db.ts";
import { parseStoreKind, parseStoreName } from "../core/validate.ts";
import type { Store, StoreKind } from "../core/types.ts";
import { handlerFor } from "../storage/kinds.ts";

interface StoreRow {
  name: string;
  kind: string;
  created_at: string;
}

function rowToStore(row: StoreRow): Store {
  // Parsing the kind through the dispatcher here means a store row this process
  // cannot honour fails at the boundary where it is read, not deep inside a route.
  handlerFor(row.kind);
  return { name: row.name, kind: row.kind as StoreKind, createdAt: row.created_at };
}

/** Seed the master store. Idempotent: the second boot inserts nothing. */
export function ensureMasterStore(db: DatabaseSync, now: () => number): void {
  db.prepare(
    `INSERT INTO stores (name, kind, created_at) VALUES ('master', ?, ?)
     ON CONFLICT(name) DO NOTHING`,
  ).run(DEFAULT_STORE_KIND, new Date(now()).toISOString());
}

export function createStore(
  db: DatabaseSync,
  rawName: unknown,
  rawKind: unknown,
  now: () => number,
): Store {
  const name = parseStoreName(rawName);
  // An absent kind means the default kind; a present but unknown kind is refused by
  // the same parser the wire uses, so the schema lives in exactly one place.
  const kind = rawKind === undefined ? DEFAULT_STORE_KIND : parseStoreKind(rawKind);
  // Fail before the INSERT if this process has no handler for the kind.
  handlerFor(kind);
  try {
    db.prepare("INSERT INTO stores (name, kind, created_at) VALUES (?, ?, ?)").run(
      name,
      kind,
      new Date(now()).toISOString(),
    );
  } catch (error) {
    if (error instanceof Error && /UNIQUE constraint failed/.test(error.message)) {
      throw new StoreError("store_exists", `store ${JSON.stringify(name)} already exists`);
    }
    throw error;
  }
  return getStore(db, name);
}

export function getStore(db: DatabaseSync, name: string): Store {
  const row = db.prepare("SELECT name, kind, created_at FROM stores WHERE name = ?").get(name) as
    | StoreRow
    | undefined;
  if (row === undefined) {
    throw new StoreError("not_found", `no store named ${JSON.stringify(name)}`);
  }
  return rowToStore(row);
}

/**
 * Remove a store's REGISTRY ROW — the last write of `DELETE /stores/:store` (ledger row
 * 70(c)). The route owns the whole boundary (a master admin, the server-side confirm
 * token, and the 409 while any key's scope names the store); this is the ONE place the
 * `stores` row goes, beside `ensureMasterStore`/`createStore`, which are the ONE places
 * it is written.
 *
 * It does NOT cascade anything: `key_stores.store REFERENCES stores(name)` with
 * `PRAGMA foreign_keys = ON` makes a DELETE with a scope row still naming the store fail
 * LOUDLY (an internal 500), which is the correct failure for a caller that skipped the
 * route's refusal — never a silent rewrite of someone's credential. Object rows and bytes
 * are removed by the store kind's `empty()` BEFORE this is called.
 */
export function deleteStore(db: DatabaseSync, name: string): boolean {
  const result = db.prepare("DELETE FROM stores WHERE name = ?").run(name);
  return result.changes > 0;
}

/** Resolve a requested store name to a registered store, or throw 404. */
export function requireStore(db: DatabaseSync, rawName: unknown): Store {
  return getStore(db, parseStoreName(rawName));
}

export function listStores(db: DatabaseSync): Store[] {
  const rows = db
    .prepare("SELECT name, kind, created_at FROM stores ORDER BY name")
    .all() as unknown as StoreRow[];
  return rows.map(rowToStore);
}
