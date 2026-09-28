/**
 * Storage — the ONE place bytes touch the disk.
 *
 * Layout: `<dataRoot>/stores/<store>/blobs/<sha256[0:2]>/<sha256>`.
 * Content-addressed: the path IS the hash, so writing the same bytes twice is a
 * no-op and a half-written file is never visible under a real hash.
 *
 * Atomicity: bytes are written to a temp file in the store's own directory (same
 * filesystem, so `rename` is atomic) and only then renamed into place. A failure —
 * a body that exceeded the cap, a stream that aborted, a crash — leaves a temp file
 * at worst, never a short blob at a hashed path.
 *
 * RECLAMATION (ledger row 70(e)): `deleteBlob()` removes ONE object's blob and is called
 * by the single-object delete ONLY when no other row in that store still names the same
 * content address; `removeStoreBlobs()` removes a store's whole blob tree (the
 * EMPTY-STORE path, where every row is already gone) and `removeStoreDir()` removes the
 * store directory itself (the DELETE-STORE path). Every path under `stores/` is built
 * here from a PARSED name, and every removal is scoped to ONE store's own directory — no
 * caller joins a string onto the data root.
 */

import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** The root of every store's bytes, under the injected data root. */
export function storesRoot(dataRoot: string): string {
  return join(dataRoot, "stores");
}

/** Everything a single store owns on disk. */
export function storeDir(dataRoot: string, store: string): string {
  return join(storesRoot(dataRoot), store);
}

/** The directory holding one blob, sharded by the first two hex characters. */
export function blobDir(dataRoot: string, store: string, sha256: string): string {
  return join(storeDir(dataRoot, store), "blobs", sha256.slice(0, 2));
}

/** The path of one blob. */
export function blobPath(dataRoot: string, store: string, sha256: string): string {
  return join(blobDir(dataRoot, store, sha256), sha256);
}

/** sha256 of a byte buffer, hex. The content address. */
export function sha256Of(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Write `bytes` under their own hash and return that hash.
 *
 * The caller has already validated the store name and read the body under its cap;
 * this function only moves bytes. `randomBytes` names the temp file, so two writers
 * racing on the same content cannot collide on the temp path.
 */
export async function writeBlob(
  dataRoot: string,
  store: string,
  bytes: Uint8Array,
): Promise<string> {
  const sha256 = sha256Of(bytes);
  const dir = blobDir(dataRoot, store, sha256);
  const target = blobPath(dataRoot, store, sha256);
  await mkdir(dir, { recursive: true });
  const temp = join(dir, `.tmp-${randomBytes(8).toString("hex")}`);
  try {
    await writeFile(temp, bytes);
    await rename(temp, target);
  } catch (error) {
    // Never leave a temp file behind on a failed write; never remove the target,
    // which another writer may already own.
    await rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
  return sha256;
}

/** Read a blob back. Missing or wrong-sized bytes are a LOUD internal failure. */
export async function readBlob(
  dataRoot: string,
  store: string,
  sha256: string,
  expectedSize: number,
): Promise<Uint8Array> {
  const path = blobPath(dataRoot, store, sha256);
  const info = await stat(path);
  if (!info.isFile()) {
    throw new Error(`blob is not a regular file: ${path}`);
  }
  if (info.size !== expectedSize) {
    throw new Error(
      `blob ${path} is ${info.size} bytes but metadata says ${expectedSize} — refusing to serve it`,
    );
  }
  return new Uint8Array(await readFile(path));
}

/**
 * The directory holding every blob of one store.
 *
 * The boundary of an EMPTY-STORE: blobs are content-addressed WITHIN a store, so this
 * tree belongs to exactly one store and to no other.
 */
export function blobsRoot(dataRoot: string, store: string): string {
  return join(storeDir(dataRoot, store), "blobs");
}

/**
 * Remove a blob. Called by the single-object delete ONLY when no other row in the store
 * still names this `sha256` (ledger row 70(e)) — content-addressed storage means two
 * entries can share one blob, and deleting it under a survivor would corrupt it.
 *
 * `force` makes a second removal a no-op, which is what keeps the CALLER's correctness
 * (the reference check) the thing under test rather than filesystem trivia.
 */
export async function deleteBlob(dataRoot: string, store: string, sha256: string): Promise<void> {
  await rm(blobPath(dataRoot, store, sha256), { force: true });
}

/**
 * Remove every blob of one store, leaving the store directory itself — the EMPTY-STORE
 * path (ledger row 70(e)), valid only AFTER every object row of that store is gone: the
 * whole tree is then unreferenced, and it can only ever hold this store's bytes.
 *
 * Rows first, bytes second, deliberately: a crash in between leaves orphan bytes (space
 * to reclaim on a retry), never a row whose blob has vanished (an unreadable object).
 */
export async function removeStoreBlobs(dataRoot: string, store: string): Promise<void> {
  await rm(blobsRoot(dataRoot, store), { recursive: true, force: true });
}

/**
 * Remove a store's WHOLE directory — the DELETE-STORE path (ledger row 70(e)), valid
 * only after the store's object rows are gone and its registry row is removed. It is
 * scoped to `<dataRoot>/stores/<store>` and never touches the sibling store directories,
 * because `store` reached here through the ONE name parser (`parseStoreName`).
 */
export async function removeStoreDir(dataRoot: string, store: string): Promise<void> {
  await rm(storeDir(dataRoot, store), { recursive: true, force: true });
}
