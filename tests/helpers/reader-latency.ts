/**
 * PIN Y5's reader — a SECOND PROCESS that answers reads on the REAL connection
 * configuration (`openDatabase`, i.e. WAL + `busy_timeout` + `synchronous = FULL`) while
 * another process writes.
 *
 * Usage: reader-latency.ts <dbPath> <durationMs> <boundMs> <goFile>
 *
 * It OPENS the connection first and prints `READY`, then waits for `<goFile>` to appear
 * before it starts measuring. That order is load-bearing: opening a connection runs the
 * boot DDL, which is a WRITE, so a reader that connected in rollback-journal mode while
 * a writer held the lock would block in its OPEN — outside the measurement — and the
 * pin would silently stop measuring the read it is about.
 *
 * Prints `READS n MAX <ms> ERRORS n`; exit 0 only when EVERY read answered and the
 * worst one stayed within the bound. A blocked reader therefore exits non-zero, which
 * is what PIN Y5 asserts.
 */

import { existsSync } from "node:fs";
import { openDatabase } from "../../src/core/db.ts";

const [dbPath, durationRaw, boundRaw, goFile] = process.argv.slice(2);
if (
  dbPath === undefined ||
  durationRaw === undefined ||
  boundRaw === undefined ||
  goFile === undefined
) {
  process.stderr.write("usage: reader-latency.ts <dbPath> <durationMs> <boundMs> <goFile>\n");
  process.exit(2);
}
const durationMs = Number(durationRaw);
const boundMs = Number(boundRaw);

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

const db = openDatabase(dbPath);
process.stdout.write("READY\n");
while (!existsSync(goFile)) sleep(5);

const startedAt = Date.now();
let reads = 0;
let maxMs = 0;
let errors = 0;
while (Date.now() - startedAt < durationMs) {
  const before = Date.now();
  try {
    db.prepare("SELECT COUNT(*) AS n FROM objects").get();
  } catch {
    errors += 1;
  }
  const elapsed = Date.now() - before;
  reads += 1;
  if (elapsed > maxMs) maxMs = elapsed;
  sleep(5);
}
db.close();

process.stdout.write(`READS ${reads} MAX ${maxMs} ERRORS ${errors}\n`);
process.exitCode = errors === 0 && maxMs <= boundMs ? 0 : 1;
