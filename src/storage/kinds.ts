/**
 * The store-kind dispatch point. THIS is how a second store kind is added.
 *
 * The pipeline resolves a key, authorizes it against a NAMED store, then hands the
 * work to the handler registered for that store's `kind` (brief, "the ONE seam").
 * Adding a kind means writing one handler and registering it here — not editing the
 * auth middleware, the routes, or the storage layer.
 *
 * `assertSupportedKind` fails LOUDLY on an unknown kind. It is not a fallback to
 * `bytes`: a database row this process cannot honour is a 500, never a guess.
 */

import type { DatabaseSync } from "node:sqlite";
import { StoreError } from "../core/errors.ts";
import type { StoreKind } from "../core/types.ts";
import { readBlob, writeBlob } from "./fs.ts";

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
   * seam only decides how to ASK the database for the rows.
   */
  list(db: DatabaseSync, store: string, prefix?: string): StoredObject[];
  read(
    db: DatabaseSync,
    dataRoot: string,
    store: string,
    name: string,
  ): Promise<{ metadata: ObjectMetadata; bytes: Uint8Array } | null>;
  write(
    db: DatabaseSync,
    dataRoot: string,
    store: string,
    name: string,
    bytes: Uint8Array,
    now: () => number,
  ): Promise<ObjectMetadata>;
}

interface ObjectRow {
  store: string;
  name: string;
  sha256: string;
  size: number;
  created_at: string;
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

/** The `bytes` kind: an object is a content-addressed blob, keyed by its name. */
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

  async read(db, dataRoot, store, name) {
    const row = db
      .prepare(`SELECT ${OBJECT_COLUMNS} FROM objects WHERE store = ? AND name = ?`)
      .get(store, name) as ObjectRow | undefined;
    if (row === undefined) return null;
    const bytes = await readBlob(dataRoot, store, row.sha256, row.size);
    return {
      metadata: { sha256: row.sha256, size: row.size, createdAt: row.created_at },
      bytes,
    };
  },

  async write(db, dataRoot, store, name, bytes, now) {
    const sha256 = await writeBlob(dataRoot, store, bytes);
    const createdAt = new Date(now()).toISOString();
    // An existing object of the same name is replaced: the primary key decides, so
    // this is an upsert rather than a read-then-branch race.
    db.prepare(
      `INSERT INTO objects (store, name, sha256, size, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(store, name) DO UPDATE SET sha256 = excluded.sha256,
                                              size = excluded.size,
                                              created_at = excluded.created_at`,
    ).run(store, name, sha256, bytes.byteLength, createdAt);
    return { sha256, size: bytes.byteLength, createdAt };
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
