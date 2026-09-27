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
  list(db: DatabaseSync, store: string): StoredObject[];
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

/** The `bytes` kind: an object is a content-addressed blob, keyed by its name. */
const bytesHandler: StoreKindHandler = {
  kind: "bytes",

  list(db, store) {
    const rows = db
      .prepare("SELECT store, name, sha256, size, created_at FROM objects WHERE store = ? ORDER BY name")
      .all(store) as unknown as ObjectRow[];
    return rows.map(rowToObject);
  },

  async read(db, dataRoot, store, name) {
    const row = db
      .prepare("SELECT store, name, sha256, size, created_at FROM objects WHERE store = ? AND name = ?")
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
