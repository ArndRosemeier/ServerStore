/**
 * The vocabulary the whole core shares.
 *
 * Defined once, here, and imported everywhere: a second copy of "what permissions
 * exist" or "what a key looks like" is the defect this file exists to prevent.
 */

/** The only permissions that exist. A subset is stored per key. */
export const PERMISSIONS = ["read", "write", "delete", "admin"] as const;

export type Permission = (typeof PERMISSIONS)[number];

/** The store kind implemented by this slice. A second kind is an addition. */
export const STORE_KINDS = ["bytes"] as const;

export type StoreKind = (typeof STORE_KINDS)[number];

/** The only subject kind implemented. `user` is a later subject (ledger row 8). */
export const SUBJECT_KINDS = ["token"] as const;

export type SubjectKind = (typeof SUBJECT_KINDS)[number];

/** A declared store: a name plus the kind that says how its bytes are handled. */
export interface Store {
  readonly name: string;
  readonly kind: StoreKind;
  readonly createdAt: string;
}

/** A persisted access key. The raw key is NEVER in this record. */
export interface AccessKeyRecord {
  readonly id: string;
  readonly store: string;
  readonly label: string;
  readonly prefix: string;
  readonly perms: readonly Permission[];
  readonly subjectKind: SubjectKind;
  readonly createdAt: string;
  readonly expiresAt: string | null;
  readonly lastUsedAt: string | null;
  readonly revokedAt: string | null;
}

/** What a successful key resolution yields. */
export interface ResolvedKey {
  readonly id: string;
  readonly store: string;
  readonly perms: readonly Permission[];
  readonly subjectKind: SubjectKind;
}

/** A minted key: the raw string plus the record that was persisted. */
export interface MintedKey {
  readonly raw: string;
  readonly record: AccessKeyRecord;
}
