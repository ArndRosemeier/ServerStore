/**
 * Access keys — the ONE place that knows what a key looks like and how it is checked.
 *
 * Format: `ssk_<id>_<secret>`.
 *   - `id`     12 base64url characters (9 random bytes) — the public lookup id.
 *   - `secret` 32 random bytes, base64url — never stored, never logged.
 *
 * What is PERSISTED: `sha256(raw)` hex, the display `prefix`, and the `id`. The raw
 * key exists only in the return value of `mintKey` — it is printed once by whoever
 * asked for it and is unrecoverable after that (ledger row 6).
 *
 * Verification compares hashes with `timingSafeEqual`, because a byte-by-byte string
 * comparison leaks how much of a guess was right.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { StoreError } from "./errors.ts";
import { parseStoreName, parseStoredPermissions } from "./validate.ts";
import type { AccessKeyRecord, MintedKey, Permission, SubjectKind } from "./types.ts";

/** The wire prefix every key carries. */
export const KEY_PREFIX = "ssk_";

/** How many leading characters are kept for display. */
export const DISPLAY_PREFIX_LENGTH = 12;

const ID_BYTES = 9;
const SECRET_BYTES = 32;

/** `*` means "every store", and is only meaningful for an admin key. */
export const ALL_STORES = "*";

interface AccessKeyRow {
  id: string;
  store: string;
  label: string;
  key_hash: string;
  prefix: string;
  perms: string;
  subject_kind: string;
  created_at: string;
  expires_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
}

function sha256Hex(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

/**
 * Mint a key and persist only its hash. The caller gets `raw` exactly once.
 *
 * `store` is a store name, or `*` for an admin key that spans every store.
 */
export function mintKey(
  db: DatabaseSync,
  options: {
    readonly store: string;
    readonly label: string;
    readonly perms: readonly Permission[];
    readonly now: () => number;
    readonly expiresAt?: string | null;
    readonly subjectKind?: SubjectKind;
  },
): MintedKey {
  if (options.label.trim().length === 0) {
    throw new StoreError("bad_request", "label is required and must not be blank");
  }
  if (options.perms.length === 0) {
    throw new StoreError("bad_request", "a key must carry at least one permission");
  }
  const store = options.store === ALL_STORES ? ALL_STORES : parseStoreName(options.store);
  const id = base64url(randomBytes(ID_BYTES));
  const secret = base64url(randomBytes(SECRET_BYTES));
  const raw = `${KEY_PREFIX}${id}_${secret}`;
  const prefix = raw.slice(0, DISPLAY_PREFIX_LENGTH);
  const createdAt = new Date(options.now()).toISOString();
  const expiresAt = options.expiresAt ?? null;
  const subjectKind: SubjectKind = options.subjectKind ?? "token";
  const perms = [...options.perms];

  db.prepare(
    `INSERT INTO access_keys
       (id, store, label, key_hash, prefix, perms, subject_kind, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    store,
    options.label,
    sha256Hex(raw),
    prefix,
    perms.join(","),
    subjectKind,
    createdAt,
    expiresAt,
  );

  return {
    raw,
    record: {
      id,
      store,
      label: options.label,
      prefix,
      perms,
      subjectKind,
      createdAt,
      expiresAt,
      lastUsedAt: null,
      revokedAt: null,
    },
  };
}

/** Pull a key id out of a presented string without touching the database. */
export function keyIdFromRaw(raw: string): string | null {
  const match = /^ssk_([A-Za-z0-9_-]{12})_[A-Za-z0-9_-]{20,}$/.exec(raw);
  return match?.[1] ?? null;
}

function rowToRecord(row: AccessKeyRow): AccessKeyRecord {
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
    store: row.store,
    label: row.label,
    prefix: row.prefix,
    perms: parseStoredPermissions(row.perms),
    subjectKind: "token" satisfies SubjectKind,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
  };
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
  if (row.expires_at !== null) {
    const expires = Date.parse(row.expires_at);
    if (Number.isNaN(expires)) {
      throw new StoreError("internal", `key ${id} has an unparseable expires_at`);
    }
    if (now() >= expires) return null;
  }

  return rowToRecord(row);
}

/** Record that a key was just used. Called only after a key VERIFIED. */
export function touchKey(db: DatabaseSync, id: string, now: () => number): void {
  db.prepare("UPDATE access_keys SET last_used_at = ? WHERE id = ?").run(
    new Date(now()).toISOString(),
    id,
  );
}

/** Revoke a key. Rotation is mint-new + revoke-old (ledger row 6). */
export function revokeKey(db: DatabaseSync, id: string, now: () => number): boolean {
  const result = db
    .prepare("UPDATE access_keys SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL")
    .run(new Date(now()).toISOString(), id);
  return result.changes > 0;
}

/** Look up a persisted key by its public id. */
export function findKeyById(db: DatabaseSync, id: string): AccessKeyRecord | null {
  const row = db.prepare("SELECT * FROM access_keys WHERE id = ?").get(id) as
    | AccessKeyRow
    | undefined;
  return row === undefined ? null : rowToRecord(row);
}
