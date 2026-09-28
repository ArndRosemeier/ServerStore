/**
 * Boundary validation. Names are PARSED, never sanitised.
 *
 * The rule (brief §11): a name matching `[a-z0-9][a-z0-9._-]{0,63}` is accepted;
 * everything else — including `..`, a leading `/` or a leading `.`, uppercase, a
 * slash, a traversal segment — is REFUSED with a named 400 code. Nothing is
 * silently rewritten into a "safer" name; a refused name has no path at all.
 *
 * Both store names and object names use this one parser, so a second naming rule
 * cannot drift in beside the first.
 */

import { StoreError } from "./errors.ts";
import { ALL_STORES, PERMISSIONS, STORE_KINDS, type Permission, type StoreKind } from "./types.ts";

/** 64 characters total: the leading char plus 0-63 more. */
export const NAME_MAX_LENGTH = 64;

const NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export type NameKind = "store name" | "object name" | "object name prefix" | "key id";

/**
 * Parse a name from the wire against the explicit schema. Throws 400 on refusal.
 *
 * The refused set is precise, and each refusal has a reason:
 *   - empty, non-string, over 64 chars, or outside `[a-z0-9][a-z0-9._-]{0,63}`;
 *   - `.` or `..` as the WHOLE name (path semantics, not a name);
 *   - a leading `/` (a path) or a leading `.` (hidden-file convention).
 *
 * `a..b` is NOT a traversal segment and is accepted: refusing every name that
 * contains two dots would refuse legal data to leave a hole that the segment rules
 * already close.
 */
export function parseName(raw: unknown, what: NameKind): string {
  if (typeof raw !== "string" || raw.length === 0) {
    throw new StoreError("invalid_name", `${what} is required and must be a non-empty string`);
  }
  if (raw === "." || raw === "..") {
    throw new StoreError("invalid_name", `${what} may not be '.' or '..'`);
  }
  if (raw.startsWith("/") || raw.startsWith(".")) {
    throw new StoreError("invalid_name", `${what} may not start with '/' or '.'`);
  }
  if (raw.length > NAME_MAX_LENGTH) {
    throw new StoreError("invalid_name", `${what} may be at most ${NAME_MAX_LENGTH} characters`);
  }
  if (!NAME_PATTERN.test(raw)) {
    throw new StoreError(
      "invalid_name",
      `${what} must match [a-z0-9][a-z0-9._-]{0,63}; got ${JSON.stringify(raw)}`,
    );
  }
  return raw;
}

/** Parse a store name (the label used in error messages). */
export function parseStoreName(raw: unknown): string {
  return parseName(raw, "store name");
}

/** Parse an object name. */
export function parseObjectName(raw: unknown): string {
  return parseName(raw, "object name");
}

/**
 * Parse the optional `prefix=` filter of the object listing (ledger row 61).
 *
 * **A prefix must ITSELF be a valid object name**, and that one rule is exactly the
 * right one: the legal-name language `[a-z0-9][a-z0-9._-]{0,63}` is **prefix-closed**
 * (every prefix of a legal name is legal), so this parser ACCEPTS exactly the strings
 * that can match at least one stored name and REFUSES every string that can never
 * match one — empty or whitespace, uppercase, a `/`, a leading `.`, `.`/`..`, or more
 * than 64 characters — with the EXISTING `invalid_name` (400).
 *
 * It is deliberately {@link parseName}, not a second charset regex: a prefix rule that
 * drifted from the name rule would accept a string that names nothing (a silent empty
 * listing hiding a client bug — AGENTS.md rule 1) or refuse one that names something.
 *
 * There is no second error code and no empty-string fallback: an absent `prefix=` is
 * the caller's business (it means "the whole store") and never reaches this parser.
 */
export function parseObjectPrefix(raw: unknown): string {
  return parseName(raw, "object name prefix");
}

/**
 * Parse a key SCOPE from the wire: the set of stores the key may touch.
 *
 * This is the ONE place a scope is parsed, and the only thing that produces the
 * canonical shape `AccessKeyRecord.stores` holds (ledger row 41):
 *   - `["*"]` alone is the MASTER case — every store, including ones created later;
 *   - anything else is a non-empty list of real store NAMES, returned de-duplicated
 *     and sorted, so two requests that mean the same set produce the same scope.
 *
 * Refused, each LOUDLY with a named code and before anything is minted:
 *   - not an array, or an empty array  → `invalid_scope` (a key with no store can do
 *     nothing; an empty list is far more likely to be a bug than an intent);
 *   - `*` combined with anything else  → `invalid_scope` (mixing "every store" with
 *     names has no meaning that is not just "every store");
 *   - the same store twice             → `invalid_scope` (the stored set would differ
 *     from the requested list);
 *   - a malformed name                 → `invalid_name` from the ONE name parser.
 *
 * `*` must never reach the name parser, which would refuse it as invalid and turn a
 * scope decision into a confusing 400.
 */
export function parseStores(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new StoreError(
      "invalid_scope",
      `stores must be a non-empty array of store names; use ["${ALL_STORES}"] for every store`,
    );
  }
  const wildcards = raw.filter((entry) => entry === ALL_STORES).length;
  if (wildcards > 0) {
    if (raw.length > 1) {
      throw new StoreError(
        "invalid_scope",
        `stores may not combine '${ALL_STORES}' with other entries: send ["${ALL_STORES}"] alone for ` +
          `every store, or a list of store names`,
      );
    }
    return [ALL_STORES];
  }
  const seen = new Set<string>();
  for (const entry of raw) {
    const name = parseStoreName(entry);
    if (seen.has(name)) {
      throw new StoreError("invalid_scope", `stores lists ${JSON.stringify(name)} more than once`);
    }
    seen.add(name);
  }
  return [...seen].sort();
}

/** Refuse a path that carries a traversal segment anywhere, before any routing. */
export function assertNoTraversalSegments(path: string): void {
  for (const segment of path.split("/")) {
    if (segment === ".." || segment === ".") {
      throw new StoreError("invalid_name", `path may not contain a '${segment}' segment`);
    }
  }
}

/** Parse a store kind against the explicit list. */
export function parseStoreKind(raw: unknown): StoreKind {
  if (typeof raw !== "string" || !(STORE_KINDS as readonly string[]).includes(raw)) {
    throw new StoreError(
      "bad_request",
      `store kind must be one of: ${STORE_KINDS.join(", ")}; got ${JSON.stringify(raw)}`,
    );
  }
  return raw as StoreKind;
}

/** Parse a permission list from a JSON body. A non-array or unknown entry is a 400. */
export function parsePermissions(raw: unknown): Permission[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new StoreError("bad_request", "perms must be a non-empty array of permissions");
  }
  const seen = new Set<Permission>();
  for (const entry of raw) {
    if (typeof entry !== "string" || !(PERMISSIONS as readonly string[]).includes(entry)) {
      throw new StoreError(
        "bad_request",
        `unknown permission ${JSON.stringify(entry)}; allowed: ${PERMISSIONS.join(", ")}`,
      );
    }
    seen.add(entry as Permission);
  }
  return PERMISSIONS.filter((perm) => seen.has(perm));
}

/**
 * The label a key carries when none was supplied.
 *
 * ONE constant, because BOTH granting doors — `POST /keys` (mint) and
 * `PATCH /keys/:id` (edit) — normalise an absent or blank label through
 * {@link parseLabel}, and "blank means unlabelled" must not mean two different
 * things on the two doors.
 */
export const DEFAULT_LABEL = "unlabelled";

/**
 * Parse an optional `label` field from the wire.
 *
 * Returns `undefined` when the field was **absent**, which is what lets an edit
 * leave the label UNCHANGED (an omitted field is not a change); a field that IS
 * present is normalised exactly as mint has always normalised it — a non-string or
 * a blank/whitespace-only string becomes {@link DEFAULT_LABEL}.
 */
export function parseLabel(raw: unknown): string | undefined {
  if (raw === undefined) return undefined;
  return typeof raw === "string" && raw.trim() !== "" ? raw : DEFAULT_LABEL;
}

/** Parse a permissions string as stored in SQLite (`read,write`). */
export function parseStoredPermissions(raw: string): Permission[] {
  const out: Permission[] = [];
  for (const entry of raw.split(",")) {
    if (entry.length === 0) continue;
    if (!(PERMISSIONS as readonly string[]).includes(entry)) {
      // A row that cannot be parsed is a LOUD failure, never an empty grant.
      throw new StoreError("internal", `database holds unknown permission ${JSON.stringify(entry)}`);
    }
    out.push(entry as Permission);
  }
  return out;
}

/** Parse an optional ISO expiry timestamp from a JSON body. */
export function parseExpiresAt(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string") {
    throw new StoreError("bad_request", "expiresAt must be an ISO-8601 string or null");
  }
  const millis = Date.parse(raw);
  if (Number.isNaN(millis)) {
    throw new StoreError("bad_request", `expiresAt is not a parseable timestamp: ${raw}`);
  }
  return new Date(millis).toISOString();
}
