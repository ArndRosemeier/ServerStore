/**
 * THE LEGACY ON-DISK LAYOUT — read-only, and used by exactly ONE caller.
 *
 * Until slice 17 (ledger row 79) an entry's bytes were a content-addressed file at
 * `<dataRoot>/stores/<store>/blobs/<sha256[0:2]>/<sha256>`. That layout is GONE: the
 * item bytes live in the `objects` table now, and nothing in a running request ever
 * touches a blob file again.
 *
 * What remains here is the one thing that cannot simply be deleted: the BOOT IMPORT
 * (`src/storage/migrate.ts`) must read the old files to carry their bytes into the
 * database. So this module is the ONLY place that still knows the old paths, it is
 * READ-ONLY, and it is the only place under `src/storage/` that names `dataRoot`.
 *
 * Every path is built here from a store name that reached the import from the
 * database or from a directory listing — no caller joins a string onto the data root.
 * A missing or wrong-sized file is a LOUD error (the caller decides what to do with
 * it); nothing here ever invents a value or silently skips a row.
 */

import { readdirSync, readFileSync, rmSync, statSync, type Dirent } from "node:fs";
import { join } from "node:path";

/** `<dataRoot>/stores` — the root of the deleted layout. */
function legacyStoresRoot(dataRoot: string): string {
  return join(dataRoot, "stores");
}

/** `<dataRoot>/stores/<store>` — one store's former blob tree. */
function legacyStoreDir(dataRoot: string, store: string): string {
  return join(legacyStoresRoot(dataRoot), store);
}

/** `<dataRoot>/stores/<store>/blobs/<sha[0:2]>/<sha>` — the path of ONE entry's bytes. */
function legacyBlobPath(dataRoot: string, store: string, sha256: string): string {
  return join(legacyStoreDir(dataRoot, store), "blobs", sha256.slice(0, 2), sha256);
}

/**
 * The store names that still have a directory under the legacy root, sorted.
 *
 * A missing `<dataRoot>/stores` is the NORMAL case on a fresh data root and yields
 * `[]`; that is not a fallback, it is the absence of the layout being migrated.
 */
export function listLegacyStoreNames(dataRoot: string): string[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(legacyStoresRoot(dataRoot), { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/**
 * Read ONE entry's legacy bytes and check the FILE against the row's recorded size.
 *
 * The hash check belongs to the caller (`src/storage/migrate.ts`), which is the code
 * that decides whether a mismatch stops the boot — this function only refuses to
 * return something that is not the file the row describes.
 */
export function readLegacyBlob(
  dataRoot: string,
  store: string,
  sha256: string,
  expectedSize: number,
): Uint8Array {
  const path = legacyBlobPath(dataRoot, store, sha256);
  let info: ReturnType<typeof statSync>;
  try {
    info = statSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        `legacy blob ${path} is MISSING but an objects row names it; the boot cannot ` +
          `import the entry and will not drop or invent it`,
      );
    }
    throw error;
  }
  if (!info.isFile()) {
    throw new Error(`legacy blob is not a regular file: ${path}`);
  }
  if (info.size !== expectedSize) {
    throw new Error(
      `legacy blob ${path} is ${info.size} bytes but its objects row says ${expectedSize}`,
    );
  }
  return new Uint8Array(readFileSync(path));
}

/**
 * Remove ONE store's whole legacy tree. Called ONLY after every row of that store is
 * present in the database (the import's verify-then-delete order).
 *
 * `force` makes a second removal a no-op, which is what keeps the import idempotent.
 */
export function removeLegacyStoreTree(dataRoot: string, store: string): void {
  rmSync(legacyStoreDir(dataRoot, store), { recursive: true, force: true });
}

/**
 * Remove the now-empty `<dataRoot>/stores` root itself, and FAIL LOUDLY if anything
 * is left under it.
 *
 * A leftover entry means the root holds something the import did not account for —
 * a shape the one-page STORAGE doc does not describe — and booting on it would leave
 * stray files behind while claiming the blob layout is gone. Loud beats tidy.
 */
export function removeLegacyStoreRoot(dataRoot: string): void {
  const root = legacyStoresRoot(dataRoot);
  let left: string[];
  try {
    left = readdirSync(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  if (left.length > 0) {
    throw new Error(
      `the legacy ${root} directory still holds ${left.length} entr(y/ies) after the ` +
        `import (${left.slice(0, 5).join(", ")}); refusing to boot with an unexplained ` +
        `layout rather than deleting files no row describes`,
    );
  }
  rmSync(root, { recursive: true, force: true });
}
