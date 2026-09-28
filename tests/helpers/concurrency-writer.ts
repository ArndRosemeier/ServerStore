/**
 * PIN Y4's writer — a CHILD PROCESS that writes many small objects through the REAL
 * storage path (`openDatabase` → `handlerFor("bytes").write`), so the contention two
 * processes create is the contention the service creates.
 *
 * Usage: concurrency-writer.ts <dbPath> <dataRoot> <namePrefix> <count>
 *
 * Prints `FAILED <message>` for every write that throws, then `WROTE n/total`; exit 0
 * only when every write succeeded. It never retries: a queued writer must succeed on
 * the connection's own `busy_timeout`, and a failure is the thing the pin is about.
 */

import { openDatabase } from "../../src/core/db.ts";
import { ensureMasterStore } from "../../src/stores/registry.ts";
import { handlerFor } from "../../src/storage/kinds.ts";

const [dbPath, dataRoot, prefix, countRaw] = process.argv.slice(2);
if (dbPath === undefined || dataRoot === undefined || prefix === undefined || countRaw === undefined) {
  process.stderr.write("usage: concurrency-writer.ts <dbPath> <dataRoot> <prefix> <count>\n");
  process.exit(2);
}

const count = Number(countRaw);
const db = openDatabase(dbPath);
ensureMasterStore(db, () => Date.now());
const handler = handlerFor("bytes");
const encoder = new TextEncoder();

let failed = 0;
for (let i = 0; i < count; i += 1) {
  try {
    handler.write(db, dataRoot, "master", `${prefix}-${i}`, encoder.encode(`${prefix}:${i}`), () =>
      Date.now(),
    );
  } catch (error) {
    failed += 1;
    process.stdout.write(`FAILED ${(error as Error).message}\n`);
  }
}
db.close();
process.stdout.write(`WROTE ${count - failed}/${count}\n`);
process.exitCode = failed === 0 ? 0 : 1;
