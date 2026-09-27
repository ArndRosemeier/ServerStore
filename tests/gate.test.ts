import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

/**
 * Pins on the PROCESS itself, not on a feature.
 *
 * This project's rules are load-bearing: a brief names ONE gate command, and the
 * gate's exit codes are the vocabulary every report quotes. Both rot silently —
 * deleting a line of documentation changes no behaviour — so they are pinned here.
 * Each test's NAME says what it protects.
 *
 * Renamed from `tests/process/gate-contract.test.ts` when the feature slice landed;
 * the suite is one directory (`tests/**`) so there is one fixture set, not two.
 */

const REPO = fileURLToPath(new URL("../", import.meta.url));
const GATE = join(REPO, "scripts", "gate.sh");
const BOARD = join(REPO, "scripts", "board.sh");
const TSCONFIG = join(REPO, "tsconfig.json");

describe("the process machinery this repo depends on", () => {
  test("the cheap tier typechecks the SOURCE tree, not only the tests", () => {
    const config = JSON.parse(readFileSync(TSCONFIG, "utf8")) as { include?: string[] };
    expect(config.include ?? []).toContain("src/**/*.ts");
    expect(config.include ?? []).toContain("tests/**/*.ts");
  });

  test("the gate documents its exit-code vocabulary (0 green · 1 red · 2 cheap · 9 refused)", () => {
    const source = readFileSync(GATE, "utf8");
    const vocabulary = [
      ["0", "GREEN"],
      ["1", "RED"],
      ["2", "CHEAP"],
      ["9", "REFUSED"],
    ] as const;
    for (const [code, word] of vocabulary) {
      expect(
        new RegExp(`^#\\s+${code}\\s+${word}\\b`, "m").test(source),
        `gate.sh must document exit ${code} = ${word} in its header`,
      ).toBe(true);
    }
  });

  test("the gate is executable, so a brief can name it as one command", () => {
    expect(statSync(GATE).mode & 0o111, "scripts/gate.sh must carry the execute bit").not.toBe(0);
  });

  test("a concurrent run is REFUSED by the lock (exit 9, VOID) rather than racing it", () => {
    const dir = mkdtempSync(join(tmpdir(), "serverstore-gate-lock-"));
    const lockDir = join(dir, "lock");
    try {
      // A live owner, so the lock is held and NOT stale. pid = this test process.
      mkdirSync(lockDir);
      writeFileSync(
        join(lockDir, "owner"),
        `pid=${process.pid}\nstarted=${new Date().toISOString()}\ntier=full\nrepo=${REPO}\n`,
      );
      const result = spawnSync("bash", [GATE], {
        cwd: REPO,
        encoding: "utf8",
        env: {
          ...process.env,
          GATE_LOCK_DIR: lockDir,
          GATE_LOG_DIR: join(dir, "logs"),
          GATE_TESTS: "1",
          GATE_CHEAP_CMD: "true",
          GATE_FULL_CMD: "true",
        },
      });
      expect(result.status, `expected exit 9, got ${result.status}:\n${result.stdout}${result.stderr}`).toBe(9);
      expect(result.stdout).toContain("VOID");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a check that cannot look reports CANNOT LOOK and exits 1, never passing silently", () => {
    const result = spawnSync("bash", [BOARD], {
      cwd: REPO,
      encoding: "utf8",
      env: { ...process.env, BOARD_REMOTE: "no-such-remote" },
    });
    expect(result.status, `expected exit 1:\n${result.stdout}${result.stderr}`).toBe(1);
    expect(result.stdout).toContain("CANNOT LOOK");
  });

  test("PROSE about a retirement OWED is not a claim (no false BOARD STALE)", () => {
    // Measured 2026-09-27: the prose-matching parser read "retired=NOT yet … branch
    // feat/owed" as a CLAIM and reported BOARD STALE while the branch still existed — it
    // blamed the record for a sentence saying the opposite. This pin holds that direction.
    const fixture = boardFixture(
      "LANDED | row=1 | retired=NOT yet — worktree and branch feat/owed are the dispatcher's to retire\n",
    );
    try {
      const result = runBoard(fixture.dir);
      expect(result.status, `expected 0 (reconciled):\n${result.stdout}${result.stderr}`).toBe(0);
      expect(result.stdout).toContain("BOARD RECONCILED");
    } finally {
      fixture.cleanup();
    }
  });

  test("an explicit retired_branch key IS a claim, and a live branch makes the board STALE", () => {
    // The other direction: the key that IS a claim must actually be checked, or the
    // vocabulary change would have bought a false pass instead of a true one.
    const fixture = boardFixture("retired_branch=feat/owed\n");
    try {
      const result = runBoard(fixture.dir);
      expect(result.status, `expected 1 (stale):\n${result.stdout}${result.stderr}`).toBe(1);
      expect(result.stdout).toContain("claimed retired but still exists");
    } finally {
      fixture.cleanup();
    }
  });
});

/**
 * A throwaway repo with a resolvable `origin/main`, a board carrying `prose`, and a LIVE
 * branch `feat/owed` — the smallest thing that exercises the reconciler's retirement check
 * rather than its other verdicts.
 */
function boardFixture(prose: string): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "serverstore-board-"));
  const remote = mkdtempSync(join(tmpdir(), "serverstore-remote-"));
  const git = (args: string[]): void => {
    const result = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  };
  spawnSync("git", ["init", "-q", "--bare", remote], { encoding: "utf8" });
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "test@example.invalid"]);
  git(["config", "user.name", "Board Test"]);
  git(["remote", "add", "origin", remote]);
  const board = join(dir, "docs", "BOARD.md");
  mkdirSync(join(dir, "docs"));
  writeFileSync(board, `reconciled: 0000000\n${prose}`);
  git(["add", "-A"]);
  git(["commit", "-q", "-m", "seed"]);
  git(["branch", "feat/owed"]);
  const seed = spawnSync("git", ["rev-parse", "--short=7", "HEAD"], { cwd: dir, encoding: "utf8" })
    .stdout.trim();
  writeFileSync(board, `reconciled: ${seed}\n${prose}`);
  git(["add", "-A"]);
  git(["commit", "-q", "-m", "set the reconciled marker"]);
  git(["push", "-q", "origin", "main"]);
  return {
    dir,
    cleanup: () => {
      rmSync(dir, { recursive: true, force: true });
      rmSync(remote, { recursive: true, force: true });
    },
  };
}

function runBoard(dir: string): ReturnType<typeof spawnSync> {
  return spawnSync("bash", [BOARD], {
    cwd: dir,
    encoding: "utf8",
    env: {
      ...process.env,
      BOARD_FILE: join(dir, "docs", "BOARD.md"),
      BOARD_REMOTE: "origin",
    },
  });
}
