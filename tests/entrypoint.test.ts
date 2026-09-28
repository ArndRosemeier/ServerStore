/**
 * The PROCESS contract: the REAL entrypoint, spawned, as a service would run it.
 *
 * Every other test drives `createApp()` in-process through `app.request()`, so no
 * port is ever bound and `main.ts` is never executed. That left a real gap —
 * documented in `docs/TESTING.md` as owed to THIS slice — in which the loopback bind
 * was "a code constant plus a review" and nothing proved the process the systemd unit
 * starts actually serves, refuses an unauthenticated call, or dies on SIGTERM.
 *
 * This file closes it. It starts the repo's own entrypoint exactly as
 * `pnpm run serve` and `deploy/serverstore.service` do:
 *
 *     node --experimental-strip-types src/server/main.ts
 *
 * with `SERVERSTORE_PORT` and `SERVERSTORE_DATA_ROOT` in the environment, and then
 * talks to it over a real loopback socket. It does NOT invent a second way to start
 * the server: the child IS the entrypoint, the assertions go through HTTP, and the
 * liveness probe is the same `/healthz` the live probe script checks.
 *
 * Pins (the NAME is the contract; `docs/TESTING.md` maps them):
 *   PIN D1: the real entrypoint boots and serves /healthz from the repo's own start command
 *   PIN D2: the entrypoint listens on 127.0.0.1 and NOT on 0.0.0.0
 *   PIN D3: an unauthenticated API call is refused 401 by the running service
 *   PIN D4: SIGTERM stops the service and leaves no child behind
 *   PIN D7: the CORS allowlist the RUNNING service answers comes from
 *           `SERVERSTORE_CORS_ORIGINS` (added by slice 12: the config parser is pinned
 *           in `tests/cors.test.ts`, but only a spawned entrypoint proves `main.ts`
 *           WIRES that config into `createApp` — ledger row 29's lesson that a pin must
 *           see the wiring, not just the constant)
 *
 * Two rules from AGENTS.md §Host hygiene shape the machinery here:
 *
 *   - **Nothing outlives the writer.** Every spawn is registered and killed in
 *     `afterEach` (`reapSpawnedServices()`), even if a test threw; `SIGKILL` is the
 *     escalation for a child that ignores `SIGTERM`. A backgrounded server that outlives
 *     the suite is exactly the orphan the standing "reap what you start" rule exists for.
 *   - **No silent fallbacks.** If `/proc/net/tcp` cannot be read, the loopback pin
 *     FAILS with that reason. It is never skipped: a skipped pin is a pin that cannot
 *     fail, and this project has already been burned by one of those (ledger row 25).
 *
 * The SPAWN itself (free port, the child, the boot poll, the reap) is
 * `tests/helpers/entrypoint.ts` — ONE module, shared with `tests/browser.test.ts`.
 */

import { readFileSync } from "node:fs";
import { afterEach, describe, expect, test } from "vitest";
import {
  HEALTHZ,
  POLL_INTERVAL_MS,
  REQUEST_TIMEOUT_MS,
  reapSpawnedServices,
  sleep,
  startEntrypoint,
  waitForHealthz,
} from "./helpers/entrypoint.ts";

/**
 * The process seam itself — the free port, the spawn of `src/server/main.ts`, the boot
 * poll and the reap — is `tests/helpers/entrypoint.ts`, because the headless-browser
 * test (slice 15, pins B1–B8) needs exactly the same machinery. It used to live in this
 * file; it is ONE module now, so the two process-level suites cannot drift apart.
 *
 * Reaped in `afterEach` whatever the test did, so no backgrounded service outlives the
 * suite (AGENTS.md §Host hygiene, "reap what you start").
 */
afterEach(reapSpawnedServices);

/** The whole bounded wait for a service that exits on SIGTERM. */
const EXIT_BUDGET_MS = 5_000;

interface FetchOutcome {
  status: number;
  body: string;
}

/** A request with its own timeout, so one hung response cannot outlive the test. */
async function request(url: string, init: RequestInit = {}): Promise<FetchOutcome> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  return { status: response.status, body: await response.text() };
}

// --- the listening-socket map, read from the kernel ------------------------------

interface ListenAddress {
  /** The IPv4 literal when the 32-bit address parses as one; `null` otherwise. */
  readonly ipv4: string | null;
  /** The raw address column, e.g. `0100007F` or `00000000000000000000000001000000`. */
  readonly raw: string;
  /** The socket state column (`0A` is `TCP_LISTEN`). */
  readonly state: string;
}

function parseAddress(raw: string, state: string): ListenAddress {
  const octets: number[] = [];
  for (let index = 0; index + 1 < raw.length; index += 2) {
    octets.push(Number.parseInt(raw.slice(index, index + 2), 16));
  }
  // Only a 32-bit group is an IPv4 address; `/proc/net/tcp6` is always 128-bit.
  if (octets.length !== 4 || octets.some((octet) => Number.isNaN(octet))) {
    return { ipv4: null, raw, state };
  }
  return { ipv4: [octets[3], octets[2], octets[1], octets[0]].join("."), raw, state };
}

/**
 * Every socket in `procFile` whose LOCAL port is `port`.
 *
 * `/proc/net/tcp` is little-endian hex (the `127.0.0.1:8765` line is `0100007F:223D`),
 * and `/proc/net/tcp6` holds the IPv6 wildcard `[::]` — so BOTH are read: a `0.0.0.0`
 * bind appears in the first and a `[::]` bind in the second, and a check that reads
 * only one of them cannot see the failure it exists to catch.
 */
function listeningSockets(procFile: string, port: number): ListenAddress[] {
  const found: ListenAddress[] = [];
  for (const line of readFileSync(procFile, "utf8").split("\n").slice(1)) {
    const columns = line.trim().split(/\s+/);
    const local = columns[1];
    const state = columns[3];
    if (local === undefined || state === undefined) continue;
    const [raw, portHex] = local.split(":");
    if (raw === undefined || portHex === undefined) continue;
    if (Number.parseInt(portHex, 16) !== port) continue;
    found.push(parseAddress(raw, state));
  }
  return found;
}

/** The file could not be read — a loud failure, never a skip (AGENTS.md rule 1). */
function procReadFailure(error: unknown): string {
  const code = (error as NodeJS.ErrnoException).code ?? String(error);
  return `the listening socket cannot be checked (procfs read failed: ${code}) — an uncheckable pin is not a pass`;
}

const TCP = "/proc/net/tcp";
const TCP6 = "/proc/net/tcp6";

/** `TCP_LISTEN` in `/proc/net/tcp`. Anything else (e.g. `06` TIME_WAIT) is not a listener. */
const LISTEN = "0A";

/**
 * The LISTENING sockets on `port`, from both tables.
 *
 * Only state `0A` counts. A closed connection's kernel leftovers are not a listener:
 * after SIGTERM the probe's own recently-used sockets can sit in TIME_WAIT (`06`) on
 * that port for a minute, and treating those as "still listening" would make PIN D4
 * fail forever for a reason that has nothing to do with the service.
 */
function listenersOn(port: number): ListenAddress[] {
  return [...listeningSockets(TCP, port), ...listeningSockets(TCP6, port)].filter(
    (socket) => socket.state === LISTEN,
  );
}

// --- the pins --------------------------------------------------------------------

describe("the real entrypoint, spawned as the service runs it (pins D1-D4, D7)", () => {
  test(`PIN D1: the real entrypoint boots and serves ${HEALTHZ} from the repo's own start command`, async () => {
    const server = await startEntrypoint();
    try {
      const health = await waitForHealthz(server);
      expect(
        health.status === 200 && health.body === JSON.stringify({ ok: true }),
        `expected 200 ${JSON.stringify({ ok: true })}, got ${health.status} ${health.body}\n--- child output ---\n${server.output()}`,
      ).toBe(true);
    } finally {
      await server.stop().catch(() => undefined);
      server.cleanup();
    }
  }, 15_000);

  test("PIN D2: the entrypoint listens on 127.0.0.1 and NOT on 0.0.0.0", async () => {
    const server = await startEntrypoint();
    try {
      await waitForHealthz(server);

      let v4: ListenAddress[];
      let v6: ListenAddress[];
      let listeners: ListenAddress[];
      try {
        // The raw tables are kept for the failure message; the ASSERTIONS run on the
        // LISTEN subset, so a TIME_WAIT leftover cannot be mistaken for a listener.
        v4 = listeningSockets(TCP, server.port);
        v6 = listeningSockets(TCP6, server.port);
        listeners = listenersOn(server.port);
      } catch (error) {
        throw new Error(procReadFailure(error));
      }
      const detail = `port ${server.port} in ${TCP}: ${JSON.stringify(v4)}; in ${TCP6}: ${JSON.stringify(v6)}`;

      expect(listeners.length, `no LISTENing socket found for ${detail}`).toBeGreaterThan(0);
      // Loopback, on the IPv4 socket the entrypoint actually binds, and nothing else.
      expect(listeners, detail).toHaveLength(1);
      expect(listeners[0]?.ipv4, detail).toBe("127.0.0.1");
      // An IPv6 wildcard bind would not appear in the IPv4 table at all.
      expect(v6.filter((socket) => socket.state === LISTEN), detail).toHaveLength(0);
      // The negative control, said out loud: the bind GUARD g1 exists to forbid.
      expect(listeners.some((socket) => socket.ipv4 === "0.0.0.0"), detail).toBe(false);
      expect(listeners[0]?.state, detail).toBe(LISTEN);
    } finally {
      await server.stop().catch(() => undefined);
      server.cleanup();
    }
  }, 15_000);

  test("PIN D3: an unauthenticated API call is refused 401 by the running service", async () => {
    const server = await startEntrypoint();
    try {
      await waitForHealthz(server);

      const outcome = await request(`http://127.0.0.1:${server.port}/stores`);
      let body: { error?: { code?: string } } = {};
      try {
        body = JSON.parse(outcome.body) as typeof body;
      } catch {
        // The assertion below prints the raw body, which is the useful evidence.
      }
      expect(
        outcome.status === 401 && body.error?.code === "unauthorized",
        `expected 401 with body error.code = "unauthorized", got ${outcome.status} ${outcome.body}`,
      ).toBe(true);
    } finally {
      await server.stop().catch(() => undefined);
      server.cleanup();
    }
  }, 15_000);

  test("PIN D4: SIGTERM stops the service and leaves no child behind", async () => {
    const server = await startEntrypoint();
    try {
      await waitForHealthz(server);

      expect(server.child.pid, "the entrypoint did not report a pid").toBeTypeOf("number");
      const signal = await server.stop("SIGTERM");
      expect(signal, `the entrypoint did not exit on SIGTERM (output:\n${server.output()})`).toBe(
        "SIGTERM",
      );

      const deadline = Date.now() + EXIT_BUDGET_MS;
      let released = false;
      let lastSeen: ListenAddress[] = [];
      while (Date.now() < deadline) {
        try {
          lastSeen = listenersOn(server.port);
        } catch (error) {
          throw new Error(procReadFailure(error));
        }
        if (lastSeen.length === 0) {
          released = true;
          break;
        }
        await sleep(POLL_INTERVAL_MS);
      }
      expect(
        released,
        `a LISTENing socket on port ${server.port} survived SIGTERM for ${EXIT_BUDGET_MS}ms: ${JSON.stringify(lastSeen)}`,
      ).toBe(true);
      // "Gone", not merely "not listening": the child itself must be reaped.
      expect(
        server.child.exitCode !== null || server.child.signalCode !== null,
        "the entrypoint is still running after SIGTERM",
      ).toBe(true);
    } finally {
      await server.stop().catch(() => undefined);
      server.cleanup();
    }
  }, 15_000);

  test("PIN D7: the running service's CORS allowlist comes from SERVERSTORE_CORS_ORIGINS", async () => {
    const server = await startEntrypoint({
      extraEnv: { SERVERSTORE_CORS_ORIGINS: "https://game.example.com" },
    });
    try {
      await waitForHealthz(server);
      const base = `http://127.0.0.1:${server.port}`;
      const preflight = async (origin: string): Promise<Response> =>
        fetch(`${base}/stores`, {
          method: "OPTIONS",
          headers: { origin, "access-control-request-method": "PATCH" },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });

      const listed = await preflight("https://game.example.com");
      const listedOrigin = listed.headers.get("access-control-allow-origin");
      expect(
        listed.status === 204 && listedOrigin === "https://game.example.com",
        `expected 204 echoing the listed origin, got ${listed.status} Allow-Origin=${listedOrigin}\n--- child output ---\n${server.output()}`,
      ).toBe(true);
      expect(listed.headers.get("vary")).toMatch(/(^|,\s*)Origin(\s*,|$)/i);

      const unlisted = await preflight("https://evil.example.com");
      expect(
        unlisted.headers.get("access-control-allow-origin"),
        `an unlisted origin was authorised by the running service\n--- child output ---\n${server.output()}`,
      ).toBeNull();
      // It falls through to the key guard; the browser, not the API, is what blocks it.
      expect(unlisted.status).toBe(401);
    } finally {
      await server.stop().catch(() => undefined);
      server.cleanup();
    }
  }, 15_000);
});
