/**
 * PINS Y4–Y7 — the SQLite core's CONCURRENCY, asserted across PROCESSES.
 *
 * `node:sqlite` is synchronous, so two writers inside ONE Node process can never
 * actually race: "2 things happening at the same time" (the owner's words, ledger row
 * 78) has to be two PROCESSES. Every pin here therefore spawns real child processes
 * against a real database, and every child is reaped in `afterEach`/`afterAll` and by
 * the synchronous net in `tests/helpers/child.ts`.
 *
 *   PIN Y4  two processes writing at once — both complete, every row present,
 *           `PRAGMA integrity_check` = ok
 *   PIN Y5  a reader in a second process is never BLOCKED while a writer works
 *   PIN Y6  a SIGKILL mid-transaction cannot corrupt: the database opens,
 *           `integrity_check` is ok, and the uncommitted rows are ABSENT
 *   PIN Y7  the configuration the claim rests on: WAL, a non-zero `busy_timeout`,
 *           `synchronous = FULL`, and a mutation that WAITS for another process's
 *           write lock instead of failing `database is locked`
 *
 * No pin binds a port, touches the live data root, or writes outside
 * `<worktree>/.concurrency-scratch/`.
 */

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { afterAll, afterEach, describe, expect, test } from "vitest";
import { BUSY_TIMEOUT_MS, openDatabase } from "../src/core/db.ts";
import { ensureMasterStore } from "../src/stores/registry.ts";
import { cleanupTestServers, createTestServer } from "./helpers/server.ts";
import {
  REPO_ROOT,
  reapChildren,
  removeScratch,
  scratchDir,
  spawnChild,
  type NodeChild,
} from "./helpers/child.ts";

/** Every test's children, so the teardown can kill them even on an assertion throw. */
const spawned: NodeChild[] = [];
function spawn(script: string, args: readonly string[]): NodeChild {
  const child = spawnChild(script, args);
  spawned.push(child);
  return child;
}

afterEach(() => {
  // A failure path must not leak a child: SIGKILL whatever this test started.
  for (const child of spawned.splice(0)) child.kill();
  reapChildren();
  cleanupTestServers();
});
afterAll(() => {
  reapChildren();
  removeScratch("concurrency");
});

/**
 * A fresh data root UNDER THE WORKTREE with a real database already created, so the
 * child processes race on an existing schema rather than on boot DDL.
 */
function freshDatabase(name: string): { dataRoot: string; dbPath: string } {
  const dataRoot = scratchDir("concurrency", name);
  const dbPath = join(dataRoot, "serverstore.db");
  const db = openDatabase(dbPath);
  ensureMasterStore(db, () => Date.now());
  db.close();
  return { dataRoot, dbPath };
}

/** Count `objects` rows and run `integrity_check` on a connection opened afresh. */
function inspect(dbPath: string): { rows: number; integrity: string } {
  const db = openDatabase(dbPath);
  try {
    const rows = Number(
      (db.prepare("SELECT COUNT(*) AS n FROM objects").get() as { n: number }).n,
    );
    const integrity = String(
      (db.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check,
    );
    return { rows, integrity };
  } finally {
    db.close();
  }
}

/** Every `.ts` file under `src/`, for the grep-level half of PIN Y7. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    else if (entry.name.endsWith(".ts")) out.push(path);
  }
  return out.sort();
}

describe("the SQLite core under concurrency (pins Y4-Y7, ledger rows 77/78)", () => {
  test("PIN Y4: two PROCESSES writing at once both complete, every committed row is present, and integrity_check is ok", async () => {
    const { dataRoot, dbPath } = freshDatabase("y4");
    const alpha = spawn("concurrency-writer.ts", [dbPath, dataRoot, "alpha", "60"]);
    const beta = spawn("concurrency-writer.ts", [dbPath, dataRoot, "beta", "60"]);

    const [alphaCode, betaCode] = await Promise.all([alpha.exited, beta.exited]);
    expect(alphaCode, `writer alpha:\n${alpha.stdout()}${alpha.stderr()}`).toBe(0);
    expect(betaCode, `writer beta:\n${beta.stdout()}${beta.stderr()}`).toBe(0);
    expect(alpha.stdout(), "alpha did not report a full run").toContain("WROTE 60/60");
    expect(beta.stdout(), "beta did not report a full run").toContain("WROTE 60/60");

    // EVERY committed row is present, and the file is sound. A writer that had failed
    // with `database is locked` would leave its names missing while its process still
    // exited non-zero — both halves are asserted.
    const { rows, integrity } = inspect(dbPath);
    expect(rows, "a committed row is missing after two processes wrote").toBe(120);
    expect(integrity).toBe("ok");
  });

  test("PIN Y5: a reader in a second process is never BLOCKED while a writer is working", async () => {
    const { dataRoot, dbPath } = freshDatabase("y5");
    // The bound is 250 ms — a >200x margin over the ~1 ms a WAL read costs, and far
    // below the ~900 ms a rollback-journal reader waits for the writer's lock (that is
    // the differential arm).
    const BOUND_MS = 250;
    const HOLD_MS = 900;
    const goFile = join(dataRoot, "go");

    // The reader connects FIRST and only starts measuring once the writer holds the
    // lock, so its own connect (which runs the boot DDL — a write) cannot be the thing
    // that blocked.
    const reader = spawn("reader-latency.ts", [dbPath, "600", String(BOUND_MS), goFile]);
    await reader.waitForLine("READY");
    const holder = spawn("lock-holder.ts", [dbPath, String(HOLD_MS), "exclusive"]);
    await holder.waitForLine("LOCKED");
    writeFileSync(goFile, "go");

    const [readerCode, holderCode] = await Promise.all([reader.exited, holder.exited]);
    const measurement = reader.stdout();
    expect(holderCode, `lock holder:\n${holder.stdout()}${holder.stderr()}`).toBe(0);
    const match = /MAX (\d+) ERRORS (\d+)/.exec(measurement);
    expect(
      match,
      `the reader printed no measurement: ${JSON.stringify(measurement)}${reader.stderr()}`,
    ).not.toBeNull();
    expect(Number(match![2]), `a read was BLOCKED (errored): ${measurement}`).toBe(0);
    expect(
      readerCode,
      `the reader was blocked while a writer worked (bound ${BOUND_MS} ms): ${measurement}`,
    ).toBe(0);
    expect(Number(match![1]), `worst read latency: ${measurement}`).toBeLessThanOrEqual(BOUND_MS);
  });

  test("PIN Y6: a SIGKILL mid-transaction leaves an openable, uncorrupted database with the uncommitted rows ABSENT", async () => {
    const { dbPath } = freshDatabase("y6");
    const victim = spawn("kill-mid-transaction.ts", [dbPath]);
    await victim.waitForLine("IN_TRANSACTION");
    // SIGKILL, deliberately: no handler, no graceful close, mid-transaction.
    victim.kill();
    const exit = await victim.exited;
    expect(exit, "the victim must have been KILLED, not have exited cleanly").toBeNull();

    const db = openDatabase(dbPath);
    try {
      const integrity = (
        db.prepare("PRAGMA integrity_check").get() as { integrity_check: string }
      ).integrity_check;
      expect(integrity).toBe("ok");
      // The committed baseline survives; the two uncommitted rows are GONE — atomicity,
      // not a partially applied transaction.
      const rows = (
        db.prepare("SELECT x FROM _kill_probe ORDER BY x").all() as unknown as { x: string }[]
      ).map((row) => row.x);
      expect(rows).toEqual(["committed"]);
      // …and the database is usable immediately afterwards.
      db.prepare("INSERT INTO _kill_probe VALUES ('after-recovery')").run();
      expect(
        Number((db.prepare("SELECT COUNT(*) AS n FROM _kill_probe").get() as { n: number }).n),
      ).toBe(2);
    } finally {
      db.close();
    }
  });

  test("PIN Y7: the configuration is what the claim rests on", async () => {
    // (a) STATIC: the open path sets the three pragmas, the timeout is a positive named
    //     constant, and no plain `BEGIN` exists anywhere — every multi-statement
    //     mutation goes through the ONE `BEGIN IMMEDIATE` seam.
    const dbSource = readFileSync(join(REPO_ROOT, "src/core/db.ts"), "utf8");
    expect(dbSource).toContain("PRAGMA journal_mode = WAL");
    expect(dbSource).toContain("PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}");
    expect(dbSource).toContain("PRAGMA synchronous = FULL");
    expect(BUSY_TIMEOUT_MS, "the busy timeout must be non-zero").toBeGreaterThan(0);
    for (const file of sourceFiles(join(REPO_ROOT, "src"))) {
      expect(
        readFileSync(file, "utf8"),
        `${relative(REPO_ROOT, file)} opens a transaction without IMMEDIATE`,
      ).not.toMatch(/\.exec\(\s*[`"']BEGIN[`"']\s*\)/);
    }

    // (b) the real database FILE is WAL (persistent across connections)…
    const server = createTestServer({ dataRoot: scratchDir("concurrency", "y7") });
    const fromFile = server.direct(
      (db) => db.prepare("PRAGMA journal_mode").get() as { journal_mode: string },
    );
    expect(fromFile.journal_mode).toBe("wal");
    // …and a connection produced by the REAL open path reports the timeout and the
    // sync level. `synchronous` is per connection, so it is read back from one.
    const probe = openDatabase(server.dbPath);
    try {
      expect(
        (probe.prepare("PRAGMA busy_timeout").get() as { timeout: number }).timeout,
      ).toBe(BUSY_TIMEOUT_MS);
      // 2 = FULL (0 = OFF, 1 = NORMAL, 2 = FULL, 3 = EXTRA).
      expect(
        (probe.prepare("PRAGMA synchronous").get() as { synchronous: number }).synchronous,
      ).toBe(2);
    } finally {
      probe.close();
    }

    // (c) BEHAVIOURAL: with a WRITE LOCK HELD BY ANOTHER PROCESS, a real multi-statement
    //     mutation (minting a key writes the key row plus its scope rows) WAITS and then
    //     succeeds — never `database is locked`.
    const master = server.mint({ stores: ["*"], perms: ["admin"] });
    const holder = spawn("lock-holder.ts", [server.dbPath, "700", "exclusive"]);
    await holder.waitForLine("LOCKED");
    const startedAt = Date.now();
    const response = await server.postJson(
      "/keys",
      { stores: ["master"], perms: ["read"], label: "y7" },
      master,
    );
    const waitedMs = Date.now() - startedAt;
    const body = await response.text();
    expect(await holder.exited, holder.stderr()).toBe(0);
    expect(response.status, `the mutation did not wait and succeed: ${body}`).toBe(201);
    expect(
      waitedMs,
      `the mutation must have QUEUED for the lock, not slipped past it (waited ${waitedMs} ms)`,
    ).toBeGreaterThanOrEqual(150);
  });
});
