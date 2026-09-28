/**
 * PIN Y6's victim — a CHILD PROCESS that is SIGKILLed in the middle of a multi-row
 * transaction.
 *
 * Usage: kill-mid-transaction.ts <dbPath>
 *
 * It commits ONE baseline row, opens `BEGIN IMMEDIATE`, inserts two more rows, prints
 * `IN_TRANSACTION`, and then holds the transaction open forever. The parent SIGKILLs it
 * there and asserts that the database still opens, `PRAGMA integrity_check` is `ok`, and
 * the two uncommitted rows are ABSENT while the baseline one survives — atomicity, not
 * luck (ledger row 78, requirement C3).
 */

import { openDatabase } from "../../src/core/db.ts";

const [dbPath] = process.argv.slice(2);
if (dbPath === undefined) {
  process.stderr.write("usage: kill-mid-transaction.ts <dbPath>\n");
  process.exit(2);
}

const db = openDatabase(dbPath);
db.exec("CREATE TABLE IF NOT EXISTS _kill_probe(x TEXT PRIMARY KEY)");
db.prepare("INSERT INTO _kill_probe VALUES ('committed') ON CONFLICT(x) DO NOTHING").run();
db.exec("BEGIN IMMEDIATE");
db.prepare("INSERT INTO _kill_probe VALUES ('uncommitted-a')").run();
db.prepare("INSERT INTO _kill_probe VALUES ('uncommitted-b')").run();
process.stdout.write("IN_TRANSACTION\n");
// Hold the transaction open until the parent kills this process.
setInterval(() => undefined, 1000);
