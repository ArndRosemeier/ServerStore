/**
 * A CHILD PROCESS that HOLDS A WRITE LOCK on the real database, for PIN Y5 (a reader's
 * latency while a writer is working) and PIN Y7 (a mutation must WAIT for a lock
 * another process holds, then succeed).
 *
 * Usage: lock-holder.ts <dbPath> <holdMs> <exclusive|immediate>
 *
 * The child opens the database through the REAL open path (so it takes the same
 * journal mode the build under test configures), writes a row inside the transaction,
 * prints `LOCKED`, and keeps writing small rows every 50 ms until `holdMs` has passed
 * — then ROLLS BACK, so a probe never leaves anything behind.
 *
 * `exclusive` is what makes the probe FALSIFIABLE: in rollback-journal mode
 * `BEGIN EXCLUSIVE` blocks readers for the whole hold, in WAL it does not. That is the
 * mechanism PIN Y5's differential arm reddens.
 */

import { openDatabase } from "../../src/core/db.ts";

const [dbPath, holdRaw, mode] = process.argv.slice(2);
if (dbPath === undefined || holdRaw === undefined) {
  process.stderr.write("usage: lock-holder.ts <dbPath> <holdMs> <exclusive|immediate>\n");
  process.exit(2);
}
const holdMs = Number(holdRaw);

/** A synchronous sleep, so the transaction is held WITHOUT the event loop running. */
function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

const db = openDatabase(dbPath);
db.exec("CREATE TABLE IF NOT EXISTS _lock_probe(x INTEGER)");
db.exec(mode === "immediate" ? "BEGIN IMMEDIATE" : "BEGIN EXCLUSIVE");
db.prepare("INSERT INTO _lock_probe VALUES (?)").run(1);
process.stdout.write("LOCKED\n");

for (let elapsed = 0; elapsed < holdMs; elapsed += 50) {
  db.prepare("INSERT INTO _lock_probe VALUES (?)").run(elapsed);
  sleep(50);
}

db.exec("ROLLBACK");
process.stdout.write("RELEASED\n");
db.close();
