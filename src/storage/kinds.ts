/**
 * The store-kind dispatch point. THIS is how a second store kind is added.
 *
 * The pipeline resolves a key, authorizes it against a NAMED store, then hands the
 * work to the handler registered for that store's `kind` (brief, "the ONE seam").
 * Adding a kind means writing one handler and registering it here — not editing the
 * auth middleware, the routes, or the storage layer.
 *
 * ## THE MEDIUM IS INVISIBLE HERE (ledger row 78)
 *
 * Since slice 17 the `bytes` kind stores an entry's bytes in the `objects.content`
 * column of the SAME SQLite database that holds keys and stores. The `kind` vocabulary
 * did NOT change: `bytes` still means "an entry is opaque bytes" and the API/console
 * see exactly what they saw before. What moved is the MEDIUM, and this file is the
 * only place that knows it: every statement against `objects` lives here or in
 * `src/storage/migrate.ts`, and no route, core module or console names a table, a
 * column or a path.
 *
 * ## Why the operations are SYNCHRONOUS
 *
 * The medium is an embedded database driven by `node:sqlite`, which is synchronous, so
 * there is nothing to await and an `async` signature would be a lie. It is also what
 * makes `BEGIN IMMEDIATE` possible at all: `src/core/db.ts withImmediateTransaction`
 * requires a synchronous body (an `await` inside a transaction on a shared connection
 * would let another request's statement run inside it). The route call sites are
 * unchanged — `await handler.read(...)` on a value is the same expression it always
 * was. A future ASYNC medium (Postgres, object storage) would reintroduce promises, and
 * the transaction seam would have to be re-derived with it; that trade is recorded in
 * docs/SEAM-INDEX.md rather than hidden.
 */

import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { StoreError } from "../core/errors.ts";
import type { StoreKind } from "../core/types.ts";

export interface StoredObject {
  readonly store: string;
  readonly name: string;
  readonly sha256: string;
  readonly size: number;
  readonly createdAt: string;
}

export interface ObjectMetadata {
  readonly sha256: string;
  readonly size: number;
  readonly createdAt: string;
}

export interface StoreKindHandler {
  readonly kind: StoreKind;
  /**
   * List this store's objects, ordered by name.
   *
   * `prefix` is OPTIONAL and is the ONLY filter that exists (ledger row 61): omitted
   * means every object in the store, exactly as before the filter was added. The
   * caller (the route) has already validated it through `parseObjectPrefix()`; this
   * seam only decides how to ASK the database for the rows. `content` is deliberately
   * NOT projected here — a listing must never pull every entry's bytes into memory.
   */
  list(db: DatabaseSync, store: string, prefix?: string): StoredObject[];
  /**
   * Read ONE entry: its metadata plus its bytes, or `null` when the name is not there.
   *
   * `dataRoot` is part of the handler contract so a FILE-BACKED medium remains a
   * drop-in; this medium is the database and does not use it.
   */
  read(
    db: DatabaseSync,
    dataRoot: string,
    store: string,
    name: string,
  ): { metadata: ObjectMetadata; bytes: Uint8Array } | null;
  /**
   * Write `bytes` under `name` and return the metadata the route reports. An existing
   * name is REPLACED — the primary key decides, so this is one upsert rather than a
   * read-then-branch race. The content hash is computed from the bytes in hand.
   */
  write(
    db: DatabaseSync,
    dataRoot: string,
    store: string,
    name: string,
    bytes: Uint8Array,
    now: () => number,
  ): ObjectMetadata;
  /**
   * Delete ONE object. Returns whether a row was removed; the route turns `false` into
   * a 404.
   *
   * THE SHARED-BLOB CHECK IS GONE (ledger rows 70(e), 79): each row carries its own
   * bytes now, so there is nothing to share and no way to delete a survivor's content
   * by accident. That removes the orphan-blob class of bug — a file left by an
   * overwrite or a failed reclamation — entirely, not merely its symptoms.
   */
  remove(db: DatabaseSync, dataRoot: string, store: string, name: string): boolean;
  /**
   * Delete EVERY object of a store. Returns the number of rows removed, so the route
   * can report an idempotent `0` for an already-empty store. There is no byte tree to
   * reclaim afterwards: the rows ARE the bytes.
   */
  empty(db: DatabaseSync, dataRoot: string, store: string): number;
}

interface ObjectRow {
  store: string;
  name: string;
  sha256: string;
  size: number;
  created_at: string;
}

/** A row plus its bytes — the point read, and only the point read. */
interface ObjectRowWithContent extends ObjectRow {
  content: Uint8Array | null;
}

function rowToObject(row: ObjectRow): StoredObject {
  return {
    store: row.store,
    name: row.name,
    sha256: row.sha256,
    size: row.size,
    createdAt: row.created_at,
  };
}

/**
 * The upper bound of a prefix range (ledger row 61).
 *
 * A filter must stay a **RANGE on the objects primary key** so SQLite can answer it
 * from the index without reading the store: `name >= :p AND name < :upper`. The upper
 * bound has to be "the prefix followed by something greater than every character a
 * name can contain", and U+FFFF is that something:
 *
 *   - the name charset is ASCII (`[a-z0-9._-]`), whose greatest code point is `z`
 *     (U+007A), and U+FFFF is far above it;
 *   - SQLite compares TEXT with the BINARY collation, byte-wise on UTF-8, and U+FFFF
 *     encodes as `EF BF BF`, whose first byte exceeds every ASCII byte — so
 *     `prefix + "\uffff"` sorts after EVERY name that starts with `prefix`;
 *   - no legal name can contain U+FFFF, so it also sorts before every name that does
 *     NOT start with the prefix (any string ≥ the prefix and < prefix+U+FFFF must
 *     begin with the prefix). The bound is therefore EXACT, not approximate.
 */
export const PREFIX_RANGE_HIGH_SENTINEL = "\uffff";

/**
 * The objects column list, in ONE place: the three SELECTs of this kind (list-all,
 * list-prefix, point read) project the SAME row shape, and a column added to one of
 * them without the others is exactly the drift `rowToObject` exists to absorb
 * (AGENTS.md rule 4 — this was three copies before slice 13 touched two of them).
 *
 * `content` is NOT in this list: it is added explicitly by the one statement that
 * needs the bytes, so a listing can never load them by accident.
 */
const OBJECT_COLUMNS = "store, name, sha256, size, created_at";

/**
 * The SQL `list` runs, EXPORTED so PIN P7 can `EXPLAIN QUERY PLAN` the REAL statement
 * instead of a re-typed copy of it — a pin against a copy proves nothing about what
 * the server executes.
 */
export const OBJECT_LIST_ALL_SQL =
  `SELECT ${OBJECT_COLUMNS} FROM objects WHERE store = ? ORDER BY name`;

export const OBJECT_LIST_PREFIX_SQL =
  `SELECT ${OBJECT_COLUMNS} FROM objects WHERE store = ? AND name >= ? AND name < ? ORDER BY name`;

/**
 * The bind parameters of {@link OBJECT_LIST_PREFIX_SQL}: the store, the prefix, and
 * the exclusive upper bound.
 *
 * ONE place computes the bound, so the handler and PIN P7 cannot disagree about what
 * the range IS (the pin binds the production parameters, not its own arithmetic).
 * Deliberately NOT `LIKE` (SQLite's default `LIKE` is case-INsensitive for ASCII, so
 * the BINARY index cannot be used) and NOT `substr(name, 1, length(?)) = ?` (a
 * store-only index probe followed by a row-by-row filter). PIN P7 is what makes that
 * falsifiable.
 */
export function objectPrefixRange(store: string, prefix: string): string[] {
  return [store, prefix, `${prefix}${PREFIX_RANGE_HIGH_SENTINEL}`];
}

/** sha256 of a byte buffer, hex. The content address the API exposes. */
export function sha256Of(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * The `bytes` kind: an object is opaque bytes held IN the objects row, keyed by name.
 *
 * Every statement below is the whole medium; `dataRoot` is unused because this medium
 * is the database (see the interface note).
 */
const bytesHandler: StoreKindHandler = {
  kind: "bytes",

  list(db, store, prefix) {
    // Absent prefix: today's statement, untouched (pin P5). Present prefix: a RANGE on
    // `(store, name)`, which EXPLAINs as `SEARCH objects USING INDEX … (store=? AND
    // name>? AND name<?)` — the index does the narrowing, the store is never scanned
    // (pin P7). The route has already parsed the prefix, so a refusal can never reach
    // this line.
    const rows = (
      prefix === undefined
        ? db.prepare(OBJECT_LIST_ALL_SQL).all(store)
        : db.prepare(OBJECT_LIST_PREFIX_SQL).all(...objectPrefixRange(store, prefix))
    ) as unknown as ObjectRow[];
    return rows.map(rowToObject);
  },

  read(db, _dataRoot, store, name) {
    const row = db
      .prepare(`SELECT ${OBJECT_COLUMNS}, content FROM objects WHERE store = ? AND name = ?`)
      .get(store, name) as ObjectRowWithContent | undefined;
    if (row === undefined) return null;
    const bytes = row.content;
    if (bytes === null || bytes === undefined) {
      // The boot import guarantees every row has content; reaching here means a row
      // was written around the storage layer. LOUD, never empty bytes (AGENTS.md
      // rule 1) — and the route's error surface turns it into a 500.
      throw new StoreError(
        "internal",
        `object ${JSON.stringify(name)} in store ${JSON.stringify(store)} has no content ` +
          `in the database; the boot import did not cover it`,
      );
    }
    if (bytes.byteLength !== row.size) {
      throw new StoreError(
        "internal",
        `object ${JSON.stringify(name)} in store ${JSON.stringify(store)} holds ` +
          `${bytes.byteLength} bytes but its row says ${row.size} — refusing to serve it`,
      );
    }
    return {
      metadata: { sha256: row.sha256, size: row.size, createdAt: row.created_at },
      bytes: new Uint8Array(bytes),
    };
  },

  write(db, _dataRoot, store, name, bytes, now) {
    // The content hash is computed from the bytes in hand, so `sha256` can never
    // drift from `content` (pin Y1).
    const sha256 = sha256Of(bytes);
    const createdAt = new Date(now()).toISOString();
    // An existing object of the same name is replaced: the primary key decides, so
    // this is an upsert rather than a read-then-branch race. One statement, so SQLite
    // makes it atomic on its own; a concurrent writer queues under `busy_timeout`.
    db.prepare(
      `INSERT INTO objects (store, name, sha256, size, created_at, content)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(store, name) DO UPDATE SET sha256 = excluded.sha256,
                                             size = excluded.size,
                                             created_at = excluded.created_at,
                                             content = excluded.content`,
    ).run(store, name, sha256, bytes.byteLength, createdAt, bytes);
    return { sha256, size: bytes.byteLength, createdAt };
  },

  remove(db, _dataRoot, store, name) {
    // ONE statement, and the row IS the bytes: there is no second place that could
    // still reference the content, so no sharing check and no orphan left behind.
    const result = db.prepare("DELETE FROM objects WHERE store = ? AND name = ?").run(store, name);
    return Number(result.changes) > 0;
  },

  empty(db, _dataRoot, store) {
    // The rows ARE the bytes: deleting them reclaims everything, with no tree to walk
    // and no ordering between rows and files to get wrong.
    const result = db.prepare("DELETE FROM objects WHERE store = ?").run(store);
    return Number(result.changes);
  },
};

const HANDLERS: Record<StoreKind, StoreKindHandler> = {
  bytes: bytesHandler,
};

/** The kind registered for `kind`, or a 500 if this process cannot honour it. */
export function handlerFor(kind: string): StoreKindHandler {
  const handler = HANDLERS[kind as StoreKind];
  if (handler === undefined) {
    throw new StoreError(
      "unsupported_store_kind",
      `no handler registered for store kind ${JSON.stringify(kind)}`,
    );
  }
  return handler;
}
