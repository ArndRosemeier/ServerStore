/**
 * The only place environment variables are read.
 *
 * `createApp` receives its dependencies as arguments, so tests and the routes never
 * touch `process.env` at import time. `main.ts` calls `resolveConfig()` once, and
 * the defaults live here so "what port is it on" has exactly one answer.
 */

import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULT_PORT = 8477;
export const DEFAULT_HOST = "127.0.0.1";
export const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;

export interface Config {
  readonly host: string;
  readonly port: number;
  readonly dataRoot: string;
  readonly dbPath: string;
  readonly maxBytes: number;
}

function parsePositiveInt(raw: string | undefined, name: string, fallback: number): number {
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer; got ${JSON.stringify(raw)}`);
  }
  return value;
}

/** Read configuration from the environment. Called by `main.ts`, never at import time. */
export function resolveConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const dataRoot = env.SERVERSTORE_DATA_ROOT ?? join(homedir(), "serverstore-data");
  const port = parsePositiveInt(env.SERVERSTORE_PORT, "SERVERSTORE_PORT", DEFAULT_PORT);
  const maxBytes = parsePositiveInt(
    env.SERVERSTORE_MAX_BYTES,
    "SERVERSTORE_MAX_BYTES",
    DEFAULT_MAX_BYTES,
  );
  return {
    // Loopback only, and not configurable: the service sits behind the cloudflared
    // tunnel and must never be reachable directly (AGENTS.md GUARD g1).
    host: DEFAULT_HOST,
    port,
    dataRoot,
    dbPath: join(dataRoot, "serverstore.db"),
    maxBytes,
  };
}
