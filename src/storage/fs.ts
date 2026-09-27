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
 * Not here yet, and said out loud: garbage collection. `deleteBlob` is never called
 * and a deleted object leaves its blob behind (brief §4, ledger row 19).
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
 * Remove a blob. Deliberately UNUSED in this slice: deletion removes the row and
 * leaves the blob for now (GC is out of scope, brief §4). Kept so the seam exists
 * and the omission is visible rather than accidental.
 */
export async function deleteBlob(dataRoot: string, store: string, sha256: string): Promise<void> {
  await rm(blobPath(dataRoot, store, sha256), { force: true });
}
