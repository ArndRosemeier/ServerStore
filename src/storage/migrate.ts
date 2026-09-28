/**
 * THE BOOT IMPORT — the ONE migration slice 17 needs (ledger rows 42/53, 78, 79).
 *
 * Slice 17 moved an entry's bytes INTO the database. A data root written by the
 * previous code has rows in `objects` whose `content` column is NULL and whose bytes
 * are a legacy blob file; this module carries those bytes across ONCE, at boot,
 * BEFORE the service serves anything.
 *
 * ## The shape, and why it is per store
 *
 * ONE `BEGIN IMMEDIATE` transaction PER STORE, then the store's blob tree is removed.
 * Per store, not per row: a failure anywhere in a store rolls back every row of that
 * store and the tree is left untouched, so a data root is either fully migrated or
 * fully un-migrated — never "half the entries imported, half the files deleted". Per
 * store, not one transaction for everything, because a failure names the store it
 * happened in and the successful stores stay migrated (the migration is idempotent, so
 * a re-run resumes exactly where it stopped).
 *
 * ## Verify then delete, per row
 *
 * For each pending row: read its blob, **hash the bytes and require the hash to equal
 * the row's `sha256`**, and only then write the bytes into the row. The tree goes only
 * after the transaction COMMITTED. A missing blob, a wrong size or a hash mismatch is
 * a LOUD throw: it stops the boot, rolls the store back and leaves the files in place.
 * There is no skip, no invented value and no partial store (AGENTS.md rule 1).
 *
 * ## Idempotence
 *
 * A row is pending iff `content IS NULL`, so a second boot finds nothing to do. A
 * store directory with NO pending rows is removed too — after the migration an item
 * file is unreachable by definition, and the leftover is exactly the orphan-blob class
 * (a file left by an overwrite or a pre-reclamation delete) that this slice deletes
 * along with the layout.
 */

import type { DatabaseSync } from "node:sqlite";
import { withImmediateTransaction } from "../core/db.ts";
import {
  listLegacyStoreNames,
  readLegacyBlob,
  removeLegacyStoreRoot,
  removeLegacyStoreTree,
} from "./legacy-blobs.ts";
import { sha256Of } from "./kinds.ts";

/** The columns the import needs from a pending row. `content` is NULL by definition. */
interface PendingRow {
  name: string;
  sha256: string;
  size: number;
}

/**
 * Carry every legacy blob into the database and remove the layout.
 *
 * `dataRoot` is the directory the database lives in; it is where the legacy
 * `<dataRoot>/stores/...` tree lived. Called by `createApp` on every boot (and thus by
 * `main.ts` before the port is bound); a failure propagates and the process never
 * serves.
 */
export function importLegacyObjects(db: DatabaseSync, dataRoot: string): void {
  // The store set is the UNION of "a directory still exists" and "a row still needs
  // its bytes": a directory with no pending row is an orphan tree to reclaim, and a
  // pending row with no directory is a missing blob the read below refuses loudly.
  const stores = new Set<string>(listLegacyStoreNames(dataRoot));
  const pendingStores = db
    .prepare("SELECT DISTINCT store FROM objects WHERE content IS NULL")
    .all() as unknown as { store: string }[];
  for (const row of pendingStores) stores.add(row.store);

  for (const store of [...stores].sort()) {
    const pending = db
      .prepare(
        "SELECT name, sha256, size FROM objects WHERE store = ? AND content IS NULL ORDER BY name",
      )
      .all(store) as unknown as PendingRow[];

    if (pending.length > 0) {
      withImmediateTransaction(db, () => {
        for (const row of pending) {
          const bytes = readLegacyBlob(dataRoot, store, row.sha256, row.size);
          const actual = sha256Of(bytes);
          if (actual !== row.sha256) {
            throw new Error(
              `legacy blob for store ${JSON.stringify(store)} entry ${JSON.stringify(row.name)} ` +
                `hashes to ${actual} but the objects row names ${row.sha256}; the boot is ` +
                `stopped rather than importing bytes that are not the entry`,
            );
          }
          const result = db
            .prepare(
              "UPDATE objects SET content = ? WHERE store = ? AND name = ? AND content IS NULL",
            )
            .run(bytes, store, row.name);
          if (Number(result.changes) !== 1) {
            // Two boots racing, or a row that changed under us: loud, never a silent
            // "already done" for a row this transaction was told to import.
            throw new Error(
              `importing store ${JSON.stringify(store)} entry ${JSON.stringify(row.name)} ` +
                `changed ${result.changes} rows instead of exactly 1`,
            );
          }
        }
      });
    }

    // AFTER the commit: every row of this store now carries its bytes, so the tree is
    // unreachable. A failure above never reaches this line.
    removeLegacyStoreTree(dataRoot, store);
  }

  // The root itself only goes once every store is migrated, and only if nothing
  // unexplained is left under it.
  removeLegacyStoreRoot(dataRoot);
}
