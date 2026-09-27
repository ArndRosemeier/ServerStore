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

/** The wildcard CORS policy: answer every origin. Safe here — no cookies (ledger 57). */
export const CORS_WILDCARD = "*";

export interface Config {
  readonly host: string;
  readonly port: number;
  readonly dataRoot: string;
  readonly dbPath: string;
  readonly maxBytes: number;
  /**
   * The CORS allowlist (ledger row 57): the origins whose cross-origin browser calls
   * this service answers. `[CORS_WILDCARD]` when the env var is unset. It reaches the
   * app as a dependency — `createApp` never reads `process.env` — so which origins a
   * running app answers is always an explicit argument.
   */
  readonly corsOrigins: readonly string[];
}

function parsePositiveInt(raw: string | undefined, name: string, fallback: number): number {
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer; got ${JSON.stringify(raw)}`);
  }
  return value;
}

/**
 * Parse `SERVERSTORE_CORS_ORIGINS` — a comma-separated allowlist of browser ORIGINS
 * (`https://game.example.com`), validated at the boundary like every other setting.
 *
 * UNSET means `[CORS_WILDCARD]` (`*`), which is safe HERE and only here: this API
 * authenticates with an explicit header and carries no cookies and no ambient
 * credentials, so a wildcard grants a browser nothing a key does not already
 * (ledger rows 21, 56, 57).
 *
 * Every other shape fails LOUDLY at resolve time rather than becoming a policy that
 * silently never matches (AGENTS.md rule 1). An entry must be a bare origin — a
 * scheme, a host and an optional port, with NO path, query, fragment or trailing
 * slash — because that is the only shape an `Origin` header ever has; `game.example.com`
 * without a scheme, or `https://game.example.com/`, would otherwise sit in the config
 * looking like an allowlist while never matching a request.
 */
export function parseCorsOrigins(raw: string | undefined): readonly string[] {
  if (raw === undefined) return [CORS_WILDCARD];
  const entries = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
  if (entries.length === 0) {
    // SET but empty is a misconfiguration, not "unset": falling back to `*` here
    // would turn an operator's attempt to lock the service down into the widest
    // possible policy, silently.
    throw new Error(
      "SERVERSTORE_CORS_ORIGINS is set but names no origin; unset it for the '*' policy " +
        "or name at least one origin such as https://game.example.com",
    );
  }
  if (entries.includes(CORS_WILDCARD)) {
    if (entries.length > 1) {
      throw new Error(
        `SERVERSTORE_CORS_ORIGINS may not mix "*" with named origins; got ${JSON.stringify(raw)}`,
      );
    }
    return [CORS_WILDCARD];
  }
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry)) {
      throw new Error(`SERVERSTORE_CORS_ORIGINS repeats the origin ${JSON.stringify(entry)}`);
    }
    seen.add(entry);
    let url: URL;
    try {
      url = new URL(entry);
    } catch {
      throw new Error(
        `SERVERSTORE_CORS_ORIGINS entry is not a URL origin: ${JSON.stringify(entry)} ` +
          "(expected e.g. https://game.example.com)",
      );
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error(
        `SERVERSTORE_CORS_ORIGINS entry must use http or https: ${JSON.stringify(entry)}`,
      );
    }
    if (url.origin !== entry) {
      throw new Error(
        "SERVERSTORE_CORS_ORIGINS entry must be a bare origin with no path, query, " +
          `fragment or trailing slash: ${JSON.stringify(entry)} (did you mean ${JSON.stringify(url.origin)}?)`,
      );
    }
  }
  return entries;
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
    corsOrigins: parseCorsOrigins(env.SERVERSTORE_CORS_ORIGINS),
  };
}
