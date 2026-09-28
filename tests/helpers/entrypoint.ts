/**
 * The ONE process-level seam: start the repo's OWN entrypoint as a service and talk to
 * it over a real loopback socket.
 *
 * `tests/entrypoint.test.ts` (pins D1–D4, D7) and `tests/browser.test.ts` (pins B1–B8)
 * both need the same four things — a free loopback port, the child spawned exactly as
 * `pnpm run serve` and `deploy/serverstore.service` spawn it, a boot poll that FAILS
 * with a deadline rather than sleeping, and a reap that leaves nothing behind. They live
 * HERE, once, so a second caller cannot drift from the first (AGENTS.md rule 4).
 *
 * Everything in `tests/helpers/server.ts` stays what it is: the IN-PROCESS fixture
 * (`app.request()`, no port bound). This module is the half that binds a socket, and it
 * is the only place outside `src/server/main.ts` that starts the service.
 *
 * Nothing here knows what a pin is, and nothing here invents a second start command:
 * the child IS `src/server/main.ts`.
 *
 * Host rules shape the machinery (AGENTS.md §Host hygiene, "reap what you start"):
 * every spawn is registered and `reapSpawnedServices()` SIGKILLs whatever is still
 * alive, so a backgrounded service cannot outlive the suite.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

/** The repo root of THIS checkout/worktree, derived from the file — never `process.cwd()`. */
export const REPO_ROOT = resolvePath(fileURLToPath(new URL("../../", import.meta.url)));

/** Exactly what `pnpm run serve` and `deploy/serverstore.service` execute. */
export const ENTRYPOINT = "src/server/main.ts";

/** The one liveness surface the live probe script also uses. */
export const HEALTHZ = "/healthz";

/** The whole bounded wait for a booting service. No unbounded loop, no sleep-and-hope. */
export const BOOT_BUDGET_MS = 5_000;
export const POLL_INTERVAL_MS = 50;
/** One poll may not hang: a socket that accepts and never answers is still a failure. */
export const REQUEST_TIMEOUT_MS = 1_000;

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Every child this module has started, reaped by `reapSpawnedServices()`. */
const spawned = new Set<ChildProcess>();

/**
 * Ask the OS for a free ephemeral port.
 *
 * A bind-then-close probe is racy in principle (the port can be taken between the close
 * and the child's bind); in practice that race is what the boot poll below catches, and
 * the alternative — teaching the entrypoint to open port 0 — is a change to production
 * code no test should force.
 */
export async function freePort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const probe = createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (address === null || typeof address === "string") {
        probe.close(() => reject(new Error("the ephemeral-port probe bound nothing")));
        return;
      }
      const port = address.port;
      probe.close(() => resolve(port));
    });
  });
}

export interface SpawnedService {
  readonly child: ChildProcess;
  readonly port: number;
  readonly dataRoot: string;
  readonly dbPath: string;
  /** Everything the child wrote, for a failure message that can be read. */
  output(): string;
  /** SIGTERM, then wait (bounded by the caller's test) for the exit. */
  stop(signal?: NodeJS.Signals): Promise<NodeJS.Signals | null>;
  /** SIGKILL if still alive, forget the child, and delete its data root. */
  cleanup(): void;
}

export interface StartEntrypointOptions {
  /** Extra environment for the child, on top of the caller's `process.env`. */
  readonly extraEnv?: Record<string, string>;
  /**
   * Where the service's data root goes. Omitted means a fresh `mkdtemp` under the
   * system temp dir (what the D pins have always used). The browser test passes a
   * directory under its OWN worktree instead — scratch never lives in `/tmp` there.
   */
  readonly dataRoot?: string;
}

export async function startEntrypoint(options: StartEntrypointOptions = {}): Promise<SpawnedService> {
  const port = await freePort();
  const dataRoot = options.dataRoot ?? mkdtempSync(join(tmpdir(), "serverstore-entrypoint-"));
  const child = spawn("node", ["--experimental-strip-types", ENTRYPOINT], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      SERVERSTORE_PORT: String(port),
      SERVERSTORE_DATA_ROOT: dataRoot,
      ...(options.extraEnv ?? {}),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  spawned.add(child);

  let output = "";
  const record = (chunk: Buffer): void => {
    output += chunk.toString();
    if (output.length > 16_384) output = output.slice(-16_384);
  };
  child.stdout?.on("data", record);
  child.stderr?.on("data", record);

  // The boot poll resolves on the exit event, so this cannot run to its full budget
  // after the child is already dead.
  let settleExit: () => void = () => undefined;
  const exited = new Promise<void>((resolve) => {
    settleExit = resolve;
  });
  child.once("exit", () => settleExit());
  child.once("error", () => settleExit());

  return {
    child,
    port,
    dataRoot,
    dbPath: join(dataRoot, "serverstore.db"),
    output: () => output,
    stop: (signal: NodeJS.Signals = "SIGTERM") => {
      if (child.exitCode === null && child.signalCode === null) child.kill(signal);
      return exited.then(() => child.signalCode);
    },
    cleanup: () => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      spawned.delete(child);
      rmSync(dataRoot, { recursive: true, force: true });
    },
  };
}

/**
 * SIGKILL every service this module started and forget it. Install in `afterEach` (or a
 * `finally`) so an error path cannot leave a backgrounded service running.
 *
 * Deliberately does NOT delete the data roots: that is `cleanup()`'s job, because only
 * the caller knows whether the root is its own to remove.
 */
export function reapSpawnedServices(): void {
  for (const child of spawned) {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
  spawned.clear();
}

interface FetchOutcome {
  status: number;
  body: string;
}

/**
 * Poll `GET /healthz` until it answers 200, or fail loudly.
 *
 * Bounded: `budgetMs` total, one attempt every `POLL_INTERVAL_MS`. A transport error
 * (the child has not bound yet) or a non-200 answer is retried; a child that has EXITED
 * is not — that is a crash, and waiting five seconds to say so would destroy the
 * diagnosis.
 */
export async function waitForHealthz(
  server: SpawnedService,
  budgetMs: number = BOOT_BUDGET_MS,
): Promise<FetchOutcome> {
  const deadline = Date.now() + budgetMs;
  let attempts = 0;
  let last = "no attempt was made";

  while (Date.now() < deadline) {
    if (server.child.exitCode !== null || server.child.signalCode !== null) {
      throw new Error(
        `the entrypoint exited (code=${server.child.exitCode}, signal=${server.child.signalCode}) before it served ${HEALTHZ}\n--- child output ---\n${server.output()}`,
      );
    }
    attempts += 1;
    try {
      const response = await fetch(`http://127.0.0.1:${server.port}${HEALTHZ}`, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const body = await response.text();
      if (response.status === 200) return { status: response.status, body };
      last = `HTTP ${response.status} ${body}`;
    } catch (error) {
      last = (error as Error).message;
    }
    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(
    `${HEALTHZ} did not answer 200 within ${budgetMs}ms (${attempts} attempts; last: ${last})\n--- child output ---\n${server.output()}`,
  );
}
