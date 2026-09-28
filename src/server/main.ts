/**
 * The only file that binds a socket, and the only file that reads the environment.
 *
 * It binds `127.0.0.1` and nothing else: the service is reached through the
 * cloudflared tunnel, so a `0.0.0.0` bind would put the store on every interface of
 * this box (AGENTS.md GUARD g1).
 *
 * Run with: `node --experimental-strip-types src/server/main.ts`
 * (see `pnpm run serve`; Node 24 type-stripping is enough — no build step).
 */

import { serve } from "@hono/node-server";
import { ensureDataRoot, createApp } from "./app.ts";
import { resolveConfig } from "./config.ts";

const config = resolveConfig();

await ensureDataRoot({ dataRoot: config.dataRoot, dbPath: config.dbPath });
const app = createApp({
  dataRoot: config.dataRoot,
  dbPath: config.dbPath,
  maxBytes: config.maxBytes,
  // The CORS allowlist reaches the app as an ARGUMENT, never through `process.env`:
  // which origins this process answers is decided once, here, from `resolveConfig()`
  // (ledger row 57).
  corsOrigins: config.corsOrigins,
  // The rate limit reaches the app the same way, as an explicit argument: 600 requests
  // per identity per 60 s unless `SERVERSTORE_RATE_LIMIT` says otherwise (0 disables it,
  // ledger row 64g).
  rateLimit: config.rateLimit,
});

console.log(
  `serverstore listening on http://${config.host}:${config.port} (loopback only) — data root ${config.dataRoot}`,
);

serve({ fetch: app.fetch, hostname: config.host, port: config.port });
