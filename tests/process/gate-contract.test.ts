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
 */

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const GATE = join(REPO, "scripts", "gate.sh");
const BOARD = join(REPO, "scripts", "board.sh");

describe("the process machinery this repo depends on", () => {
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
});
