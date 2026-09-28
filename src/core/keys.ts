/**
 * Access keys — the ONE place that knows what a key looks like and how it is checked.
 *
 * Format: `ssk_<id>_<secret>`.
 *   - `id`     12 base64url characters (9 random bytes) — the public lookup id.
 *   - `secret` 32 random bytes, base64url — never stored, never logged.
 *
 * What is PERSISTED: `sha256(raw)` hex, the display `prefix`, the `id`, and the key's
 * SCOPE (ledger row 41): `access_keys.scope_all` for the master case, plus one
 * `key_stores` row per store for every other scope. The raw key exists only in the
 * return value of `mintKey` — it is printed once by whoever asked for it and is
 * unrecoverable after that (ledger row 6).
 *
 * Verification compares hashes with `timingSafeEqual`, because a byte-by-byte string
 * comparison leaks how much of a guess was right.
 *
 * This file is ALSO the key LIFECYCLE (ledger row 46): `listKeys()` is the read seam
 * the admin route serves, and `revokeKey()`/`findKeyById()` are the revoke seam. The
 * route decides WHO may see or revoke a key; what a key IS stays here, in one place.
 *
 * `editKey()` is the EDIT seam (ledger rows 51, 52) — the SECOND way to grant
 * permissions, and deliberately here beside `mintKey`, not in the route: an edit
 * rewrites `label`/`perms`/scope IN PLACE and never the key's VALUE, so the raw key a
 * holder already has keeps working. The route decides who may edit and to what; what
 * a key HOLDS stays here.
 *
 * `deleteKey()` is the HARD DELETE (ledger row 70(a)), beside `revokeKey()`: revoke sets
 * a timestamp and keeps the credential visible in the inventory, delete removes the row
 * (and, by the schema's `ON DELETE CASCADE`, its scope). `isLiveAdminKey()` /
 * `countLiveAdminKeys()` are the ONE predicate behind the "last live admin key cannot be
 * deleted" rule, and `keysHoldingStore()` is the referrer set that blocks deleting a
 * store a key's scope names.
 *
 * The scope is loaded HERE, once per resolved key, together with the row (no N+1 in
 * `authorize`, which only ever reads the record it was handed).
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { StoreError } from "./errors.ts";
import { parsePermissions, parseStoredPermissions, parseStores } from "./validate.ts";
import {
  ALL_STORES,
  type AccessKeyRecord,
  type MintedKey,
  type Permission,
  type SubjectKind,
} from "./types.ts";

/** The wire prefix every key carries. */
export const KEY_PREFIX = "ssk_";

/** How many leading characters are kept for display. */
export const DISPLAY_PREFIX_LENGTH = 12;

const ID_BYTES = 9;
const SECRET_BYTES = 32;

interface AccessKeyRow {
  id: string;
  scope_all: number;
  label: string;
  key_hash: string;
  prefix: string;
  perms: string;
  subject_kind: string;
  created_at: string;
  expires_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
  updated_at: string | null;
  updated_by: string | null;
}

/**
 * THE label rule, shared by `mintKey` and `editKey` (ledger row 52).
 *
 * Through the HTTP routes an absent or blank label is normalised to
 * `DEFAULT_LABEL` by `parseLabel` BEFORE it reaches here, so this refusal is what a
 * DIRECT caller (the CLI, a test) gets for whitespace — the same refusal on both
 * granting doors, rather than a copy per door.
 */
function assertLabel(label: string): void {
  if (label.trim().length === 0) {
    throw new StoreError("bad_request", "label is required and must not be blank");
  }
}

function sha256Hex(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

/**
 * Build the raw string for a new key.
 *
 * The ONE place the wire format is assembled: `mintKey` uses it, and the test
 * fixture uses it to write a key row in the PRE-slice-8 shape (pin G6) without
 * knowing the format itself.
 */
export function newRawKey(): string {
  return `${KEY_PREFIX}${base64url(randomBytes(ID_BYTES))}_${base64url(randomBytes(SECRET_BYTES))}`;
}

/**
 * Render a key's scope for a human-readable message (a refusal, the CLI's stderr).
 *
 * `["*"]` reads as "every store", never as the literal name `*`, and an empty list
 * says so instead of printing nothing.
 */
export function describeStores(stores: readonly string[]): string {
  if (stores.length === 1 && stores[0] === ALL_STORES) return `every store (${ALL_STORES})`;
  if (stores.length === 0) return "no stores";
  return stores.map((store) => JSON.stringify(store)).join(", ");
}

/**
 * Mint a key and persist only its hash.
 *
 * `stores` is the key's SCOPE, canonical as `parseStores()` returns it: `["*"]` for a
 * master key, or a non-empty list of existing store names. The row and its
 * `key_stores` rows are written in ONE transaction, so a scope that names a store
 * that does not exist (a foreign-key failure) mints NOTHING rather than a key with a
 * partial scope.
 */
export function mintKey(
  db: DatabaseSync,
  options: {
    readonly stores: readonly string[];
    readonly label: string;
    readonly perms: readonly Permission[];
    readonly now: () => number;
    readonly expiresAt?: string | null;
    readonly subjectKind?: SubjectKind;
  },
): MintedKey {
  assertLabel(options.label);
  if (options.perms.length === 0) {
    throw new StoreError("bad_request", "a key must carry at least one permission");
  }
  // The ONE scope parser: a direct caller (the CLI, a test) gets the same refusals
  // the HTTP route does, and cannot write a mixed or empty scope.
  const stores = parseStores(options.stores);
  const scopeAll = stores.length === 1 && stores[0] === ALL_STORES;
  const raw = newRawKey();
  const id = keyIdFromRaw(raw);
  if (id === null) {
    // Unreachable unless `newRawKey` drifts from the parser; loud rather than a key
    // that can never be resolved.
    throw new StoreError("internal", "minted a key whose id does not parse");
  }
  const prefix = raw.slice(0, DISPLAY_PREFIX_LENGTH);
  const createdAt = new Date(options.now()).toISOString();
  const expiresAt = options.expiresAt ?? null;
  const subjectKind: SubjectKind = options.subjectKind ?? "token";
  const perms = [...options.perms];

  db.exec("BEGIN");
  try {
    db.prepare(
      `INSERT INTO access_keys
         (id, scope_all, label, key_hash, prefix, perms, subject_kind, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      scopeAll ? 1 : 0,
      options.label,
      sha256Hex(raw),
      prefix,
      perms.join(","),
      subjectKind,
      createdAt,
      expiresAt,
    );
    if (!scopeAll) {
      const insertStore = db.prepare("INSERT INTO key_stores(key_id, store) VALUES (?, ?)");
      for (const store of stores) insertStore.run(id, store);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return {
    raw,
    record: {
      id,
      stores,
      label: options.label,
      prefix,
      perms,
      subjectKind,
      createdAt,
      expiresAt,
      lastUsedAt: null,
      revokedAt: null,
      // A freshly minted key has never been EDITED: the audit columns are NULL and
      // stay NULL until `editKey` stamps them (ledger row 52). Never back-filled.
      updatedAt: null,
      updatedBy: null,
    },
  };
}

/** Pull a key id out of a presented string without touching the database. */
export function keyIdFromRaw(raw: string): string | null {
  const match = /^ssk_([A-Za-z0-9_-]{12})_[A-Za-z0-9_-]{20,}$/.exec(raw);
  return match?.[1] ?? null;
}

/** Read a key's scope: the master flag, or its `key_stores` rows. */
function loadStores(db: DatabaseSync, row: AccessKeyRow): string[] {
  if (row.scope_all === 1) return [ALL_STORES];
  const rows = db
    .prepare("SELECT store FROM key_stores WHERE key_id = ? ORDER BY store")
    .all(row.id) as unknown as { store: string }[];
  if (rows.length === 0) {
    // Not a valid key in this model: every key spans all stores OR at least one named
    // store. A row that is neither is corruption, and a silent empty scope would make
    // it a key that can do nothing while looking healthy (AGENTS.md rule 1).
    throw new StoreError(
      "internal",
      `key ${row.id} has scope_all = 0 and no key_stores rows; its scope was never written`,
    );
  }
  return rows.map((entry) => entry.store);
}

/**
 * Project a row plus its SCOPE into the record the routes serve.
 *
 * THE row→record projection: `resolveKey`, `findKeyById` and `listKeys` all go through
 * it, so a field added to the record cannot appear on one read path and not another.
 */
function recordFrom(row: AccessKeyRow, stores: readonly string[]): AccessKeyRecord {
  if (row.subject_kind !== "token") {
    // This slice implements `token` only. A row this process cannot interpret is a
    // loud failure, not a silent coercion into the one kind we do know.
    throw new StoreError(
      "internal",
      `key ${row.id} has subject_kind ${JSON.stringify(row.subject_kind)}, which this slice does not implement`,
    );
  }
  return {
    id: row.id,
    stores,
    label: row.label,
    prefix: row.prefix,
    perms: parseStoredPermissions(row.perms),
    subjectKind: "token" satisfies SubjectKind,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

function rowToRecord(db: DatabaseSync, row: AccessKeyRow): AccessKeyRecord {
  return recordFrom(row, loadStores(db, row));
}

/**
 * Resolve a presented raw key to its record, or `null` when it is missing, unknown,
 * revoked or expired.
 *
 * The status split the routes depend on: an unverifiable key is a 401 (this
 * function returns null); a VERIFIED key that is not allowed to do the thing is a
 * 403 (the caller has the record and can decide). Revoked and expired keys are
 * deliberately indistinguishable from unknown ones.
 */
export function resolveKey(
  db: DatabaseSync,
  raw: string | null,
  now: () => number,
): AccessKeyRecord | null {
  if (raw === null) return null;
  const id = keyIdFromRaw(raw);
  if (id === null) return null;

  const row = db.prepare("SELECT * FROM access_keys WHERE id = ?").get(id) as
    | AccessKeyRow
    | undefined;
  if (row === undefined) return null;

  const expected = Buffer.from(row.key_hash, "hex");
  const presented = Buffer.from(sha256Hex(raw), "hex");
  if (expected.length !== presented.length || !timingSafeEqual(expected, presented)) {
    return null;
  }

  if (row.revoked_at !== null) return null;
  if (isExpired(row.expires_at, now, id)) return null;

  // The scope is loaded ONCE, here, with the key — `authorize()` never queries.
  return rowToRecord(db, row);
}

/**
 * Record that a key was just used, and return the timestamp written.
 *
 * Called only after a key VERIFIED. Returning the value lets the caller keep the
 * in-memory record in step with the row it just wrote, so `GET /whoami` reports the
 * use it is part of rather than the previous one.
 */
export function touchKey(db: DatabaseSync, id: string, now: () => number): string {
  const usedAt = new Date(now()).toISOString();
  db.prepare("UPDATE access_keys SET last_used_at = ? WHERE id = ?").run(usedAt, id);
  return usedAt;
}

/**
 * Is a stored ISO-8601 expiry in the past at `now()`?
 *
 * THE expiry rule, and the only one (ledger row 70(b)): `resolveKey` (is this key still
 * usable?) and `isLiveAdminKey` (does this key still count as an administrator?) must
 * not disagree about what "expired" means. An absent expiry never expires. A stored
 * timestamp that cannot be parsed is a LOUD internal failure, never a silent reading in
 * either direction (AGENTS.md rule 1).
 */
function isExpired(expiresAt: string | null, now: () => number, id: string): boolean {
  if (expiresAt === null) return false;
  const expires = Date.parse(expiresAt);
  if (Number.isNaN(expires)) {
    throw new StoreError("internal", `key ${id} has an unparseable expires_at`);
  }
  return now() >= expires;
}

/**
 * Is this key a LIVE ADMIN key — holding `admin`, not revoked and not expired?
 *
 * THE predicate behind the "last admin key cannot be deleted" rule (ledger row 70(b)).
 * A REVOKED or EXPIRED admin key is not an administrator: it cannot authenticate, so it
 * cannot administer anything, and counting it would let the operator delete the last key
 * that actually works. The fields it reads are on every record, so the route can ask the
 * question about the key it already loaded, and `countLiveAdminKeys` asks the same
 * question of every stored row through this ONE predicate.
 */
export function isLiveAdminKey(
  key: Pick<AccessKeyRecord, "id" | "perms" | "revokedAt" | "expiresAt">,
  now: () => number,
): boolean {
  if (!key.perms.includes("admin")) return false;
  if (key.revokedAt !== null) return false;
  return !isExpired(key.expiresAt, now, key.id);
}

/**
 * How many keys can still administer the store — the population the LAST-ADMIN rule
 * protects (ledger row 70(b)).
 *
 * One query over `access_keys`, every row judged by {@link isLiveAdminKey}, so this
 * count and the route's check on the TARGET cannot drift. No scope is loaded: the rule is
 * about administrators, not about what they may touch, and the population is the
 * operator's keys (the same small set `listKeys()` reads whole).
 */
export function countLiveAdminKeys(db: DatabaseSync, now: () => number): number {
  const rows = db
    .prepare("SELECT id, perms, revoked_at, expires_at FROM access_keys")
    .all() as unknown as {
    id: string;
    perms: string;
    revoked_at: string | null;
    expires_at: string | null;
  }[];
  return rows.filter((row) =>
    isLiveAdminKey(
      {
        id: row.id,
        perms: parseStoredPermissions(row.perms),
        revokedAt: row.revoked_at,
        expiresAt: row.expires_at,
      },
      now,
    ),
  ).length;
}

/**
 * The keys whose SCOPE NAMES `store` — exactly the `key_stores` rows that block deleting
 * it (ledger row 70(c)).
 *
 * This is the referrer set of the `key_stores.store REFERENCES stores(name)` foreign key,
 * which is why the store-delete route refuses (409) rather than cascading: with
 * `PRAGMA foreign_keys = ON` the DELETE would fail anyway, and a silent cascade would
 * mutate credentials — a key scoped only to this store would be left with an EMPTY scope,
 * which the model forbids (`loadStores` refuses it). A `["*"]` master scope is not here:
 * it does not NAME the store, and a store deleted and re-created is still spanned by it.
 */
export function keysHoldingStore(
  db: DatabaseSync,
  store: string,
): { id: string; label: string }[] {
  return db
    .prepare(
      `SELECT k.id AS id, k.label AS label
         FROM key_stores ks
         JOIN access_keys k ON k.id = ks.key_id
        WHERE ks.store = ?
        ORDER BY k.id`,
    )
    .all(store) as unknown as { id: string; label: string }[];
}

/** Revoke a key. Rotation is mint-new + revoke-old (ledger row 6). */
export function revokeKey(db: DatabaseSync, id: string, now: () => number): boolean {
  const result = db
    .prepare("UPDATE access_keys SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL")
    .run(new Date(now()).toISOString(), id);
  return result.changes > 0;
}

/**
 * HARD-DELETE a key row — the write seam of `DELETE /keys/:id` (ledger row 70(a)).
 *
 * The route decides WHO may delete and whether the last live administrator would be
 * destroyed; this is the one place the row goes. Its `key_stores` rows go WITH it through
 * `ON DELETE CASCADE` (the schema declares it), so no scope row can outlive its key, and
 * a later re-mint cannot inherit one. A deleted key stops authenticating on the NEXT
 * request because `resolveKey` finds no row at all — the same no-cache fact revocation
 * relies on. Returns whether a row was actually removed.
 */
export function deleteKey(db: DatabaseSync, id: string): boolean {
  const result = db.prepare("DELETE FROM access_keys WHERE id = ?").run(id);
  return result.changes > 0;
}

/** Look up a persisted key by its public id. */
export function findKeyById(db: DatabaseSync, id: string): AccessKeyRecord | null {
  const row = db.prepare("SELECT * FROM access_keys WHERE id = ?").get(id) as
    | AccessKeyRow
    | undefined;
  return row === undefined ? null : rowToRecord(db, row);
}

/**
 * EDIT a key IN PLACE — the second way to GRANT permissions, which is why it lives
 * HERE beside `mintKey` and not beside the route that calls it (ledger rows 51, 52).
 *
 * What it does NOT touch is the point: `id`, `key_hash`, `prefix` and `created_at` are
 * absent from the UPDATE and no new raw key is generated, so the credential its holder
 * already has keeps working after its grant changes (pin E6). Widening therefore takes
 * effect on whoever holds the key, and narrowing is the only way to take something back
 * short of revoke-and-mint.
 *
 * `label`, `stores` and `perms` are the RESOLVED next state: the route merges an
 * omitted field with the row it read, because only the route knows the difference
 * between "omitted" and "given". Each value then goes through the SAME parser minting
 * uses (`assertLabel`, `parseStores`, `parsePermissions`), so the two granting doors
 * cannot validate differently. The row and its `key_stores` rows are rewritten in ONE
 * transaction, so a scope change can never land half-applied.
 *
 * The stamp is `now()` at this instant plus the EDITING key's id (pin E4): when and by
 * which key the grant changed — an id the inventory already lists, never a secret.
 */
export function editKey(
  db: DatabaseSync,
  options: {
    readonly id: string;
    readonly label: string;
    readonly stores: readonly string[];
    readonly perms: readonly Permission[];
    readonly by: string;
    readonly now: () => number;
  },
): AccessKeyRecord {
  assertLabel(options.label);
  // The ONE parsers: an edit cannot write a scope or a permission set that minting
  // would have refused, and `parsePermissions` also returns the canonical order.
  const stores = parseStores(options.stores);
  const perms = parsePermissions([...options.perms]);
  const scopeAll = stores.length === 1 && stores[0] === ALL_STORES;
  const updatedAt = new Date(options.now()).toISOString();

  db.exec("BEGIN");
  try {
    db.prepare(
      "UPDATE access_keys SET label = ?, perms = ?, scope_all = ?, updated_at = ?, updated_by = ? WHERE id = ?",
    ).run(options.label, perms.join(","), scopeAll ? 1 : 0, updatedAt, options.by, options.id);
    db.prepare("DELETE FROM key_stores WHERE key_id = ?").run(options.id);
    if (!scopeAll) {
      const insertStore = db.prepare("INSERT INTO key_stores(key_id, store) VALUES (?, ?)");
      for (const store of stores) insertStore.run(options.id, store);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  // Re-read the row rather than trusting `changes`: the record served back is the
  // STORED one, which is what proves the write landed AND that the key's value
  // (`key_hash`, `prefix`, `created_at`) survived the edit untouched.
  const updated = findKeyById(db, options.id);
  if (updated === null) {
    throw new StoreError("internal", `key ${options.id} vanished while it was being edited`);
  }
  return updated;
}

/**
 * Every key, ordered by creation then id — the read half of the key lifecycle.
 *
 * REVOKED keys are included on purpose: a console needs to show what was revoked and
 * when, and `revoked_at` is exactly what tells them apart (ledger row 46).
 *
 * NO PAGINATION (the brief says so explicitly rather than leaving it unstated): the
 * population is the operator's keys, small by construction, and one page is the whole
 * inventory. If that ever stops being true, the route grows a cursor IN THE ROUTE —
 * this function stays "every key" or is renamed.
 *
 * The scope of every key is loaded in ONE extra query, not one per key, so a listing is
 * two queries whatever the population. `ORDER BY created_at, id` is total because `id`
 * is the primary key, so the order is stable even when two keys share a timestamp (the
 * test fixture's frozen clock makes every key in a test share one).
 */
export function listKeys(db: DatabaseSync): AccessKeyRecord[] {
  const rows = db
    .prepare("SELECT * FROM access_keys ORDER BY created_at, id")
    .all() as unknown as AccessKeyRow[];
  const scopeRows = db
    .prepare("SELECT key_id, store FROM key_stores ORDER BY key_id, store")
    .all() as unknown as { key_id: string; store: string }[];
  const scopes = new Map<string, string[]>();
  for (const entry of scopeRows) {
    const list = scopes.get(entry.key_id);
    if (list === undefined) scopes.set(entry.key_id, [entry.store]);
    else list.push(entry.store);
  }
  return rows.map((row) => {
    if (row.scope_all === 1) return recordFrom(row, [ALL_STORES]);
    const stores = scopes.get(row.id);
    if (stores === undefined || stores.length === 0) {
      // The same corruption `loadStores` refuses: a key that is neither the master case
      // nor scoped to a real store must fail LOUDLY, never list as an empty scope.
      throw new StoreError(
        "internal",
        `key ${row.id} has scope_all = 0 and no key_stores rows; its scope was never written`,
      );
    }
    return recordFrom(row, stores);
  });
}
