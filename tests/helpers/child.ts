/**
 * THE test-side PROCESS seam for the slice-17 concurrency pins (Y4–Y7).
 *
 * `node:sqlite` is SYNCHRONOUS, so two writers inside one Node process can never
 * actually race: "2 things happening at the same time" has to be two PROCESSES
 * (ledger rows 77/78). These pins therefore spawn small child scripts, and this module
 * is the ONE place they are spawned, awaited and — above all — KILLED.
 *
 * Nothing outlives the pins (AGENTS.md §Host hygiene, a turn that ends does not kill
 * its processes):
 *   - every child is registered here the moment it is spawned;
 *   - `reapChildren()` SIGKILLs whatever is still alive and is called from the test
 *     file's own `afterAll` AND from a failure path;
 *   - a synchronous `process.once("exit")` net catches an abrupt exit, where no hook
 *     runs — the same three-layer shape `tests/helpers/browser.ts` uses for Chrome.
 *
 * Scratch lives UNDER the worktree (`<repo>/.sqlite-scratch/`, gitignored), never
 * `/tmp`. `scratchDir()` is also used by the in-process boot-import pins, which build a
 * legacy data root the same way.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** The checkout/worktree the tests run from. Child scripts are resolved from here. */
export const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

/**
 * Where the slice-17 pins keep their data roots (gitignored, under the worktree).
 *
 * `namespace` separates the TEST FILES: vitest runs files in parallel workers, and two
 * files sharing one directory means one file's `removeScratch()` deletes the other's
 * live database (observed as `SQLITE_CANTOPEN: unable to open database file`).
 */
export function scratchDir(namespace: string, name: string): string {
  const dir = join(REPO_ROOT, ".sqlite-scratch", namespace, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Remove one test file's scratch namespace. Called by that file's `afterAll`. */
export function removeScratch(namespace: string): void {
  rmSync(join(REPO_ROOT, ".sqlite-scratch", namespace), { recursive: true, force: true });
}

export interface NodeChild {
  readonly proc: ChildProcess;
  /** Everything the child has printed on stdout so far. */
  stdout(): string;
  /** Everything the child has printed on stderr so far. */
  stderr(): string;
  /** Resolves with the exit code once the child is gone. */
  readonly exited: Promise<number | null>;
  /** SIGKILL the child. Idempotent; safe after it has already exited. */
  kill(): void;
  /** Wait for a line on stdout (a handshake), or throw on child exit / timeout. */
  waitForLine(marker: string, timeoutMs?: number): Promise<void>;
}

const living = new Set<NodeChild>();

/** Spawn one child script with `node --experimental-strip-types`, under the worktree. */
export function spawnChild(script: string, args: readonly string[]): NodeChild {
  const path = join(REPO_ROOT, "tests", "helpers", script);
  const proc = spawn(process.execPath, ["--experimental-strip-types", path, ...args], {
    cwd: REPO_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  let err = "";
  proc.stdout?.on("data", (chunk: Buffer) => {
    out += chunk.toString("utf8");
  });
  proc.stderr?.on("data", (chunk: Buffer) => {
    err += chunk.toString("utf8");
  });
  const exited = new Promise<number | null>((resolve) => {
    proc.on("exit", (code) => resolve(code));
  });

  const child: NodeChild = {
    proc,
    stdout: () => out,
    stderr: () => err,
    exited,
    kill: () => {
      if (proc.exitCode === null && proc.signalCode === null) proc.kill("SIGKILL");
    },
    waitForLine: async (marker: string, timeoutMs = 15_000) => {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        if (out.includes(marker)) return;
        if (proc.exitCode !== null || proc.signalCode !== null) {
          throw new Error(
            `child ${script} exited (${String(proc.exitCode ?? proc.signalCode)}) before ` +
              `${JSON.stringify(marker)}; stdout=${JSON.stringify(out)} stderr=${JSON.stringify(err)}`,
          );
        }
        if (Date.now() > deadline) {
          child.kill();
          throw new Error(
            `child ${script} never printed ${JSON.stringify(marker)} within ${timeoutMs}ms; ` +
              `stdout=${JSON.stringify(out)} stderr=${JSON.stringify(err)}`,
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    },
  };
  living.add(child);
  void exited.then(() => living.delete(child));
  return child;
}

/** SIGKILL every child this module started and is still alive. */
export function reapChildren(): void {
  for (const child of [...living]) child.kill();
}

// The last-resort net for an abrupt exit, where no hook runs: only synchronous work is
// allowed here.
process.once("exit", () => {
  for (const child of living) {
    try {
      child.proc.kill("SIGKILL");
    } catch {
      // The process may already be gone; nothing to do at exit.
    }
  }
});
