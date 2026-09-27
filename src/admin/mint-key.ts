/**
 * Local bootstrap — the ONE way an admin key is minted.
 *
 * Ledger row 7: keys are stored hashed, so a lost master key cannot be read back;
 * it is re-minted FROM THE BOX. This script opens the database file directly (never
 * over HTTP), mints a key, prints it once to stdout, and keeps no copy.
 *
 * THE RULE THIS ENFORCES: there is NO HTTP route that mints an admin key without an
 * existing admin key. The API can only mint a key that is already authorised by a
 * master admin key (POST /keys); the bootstrap is shell-on-the-box only — which is
 * already equivalent to store root because the plaintext bytes are on that disk
 * (ledger row 7c).
 *
 * Usage (note: pnpm already forwards flags after the script name, so `pnpm run
 * admin:key --store notes` is the form that works — a literal `--` is passed through
 * to this script as a positional argument, which is refused):
 *   pnpm run admin:key                       # master admin key (scope `*`, perms admin)
 *   pnpm run admin:key --store notes         # scoped key (default perms read,write)
 *   pnpm run admin:key --db /path/serverstore.db --json
 */

import { parseArgs } from "node:util";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { openDatabase } from "../core/db.ts";
import { StoreError } from "../core/errors.ts";
import { ALL_STORES, mintKey } from "../core/keys.ts";
import { parseExpiresAt, parsePermissions, parseStoreName } from "../core/validate.ts";
import { ensureMasterStore, getStore } from "../stores/registry.ts";
import { resolveConfig } from "../server/config.ts";

const { values } = parseArgs({
  options: {
    store: { type: "string" },
    perms: { type: "string" },
    label: { type: "string" },
    expires: { type: "string" },
    db: { type: "string" },
    json: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
  allowPositionals: true,
});

if (values.help) {
  process.stdout.write(
    "usage: pnpm run admin:key [--store <name>] [--perms read,write] [--label <text>]\n" +
      "                          [--expires <ISO-8601>] [--db <path>] [--json]\n",
  );
  process.exit(0);
}

const config = resolveConfig();
const dbPath = values.db ?? config.dbPath;
await mkdir(dirname(dbPath), { recursive: true });
const db = openDatabase(dbPath);
ensureMasterStore(db, () => Date.now());

try {
  const store = values.store === undefined ? ALL_STORES : parseStoreName(values.store);
  if (store !== ALL_STORES) {
    // A key for a store that does not exist would be a silent dud; refuse instead.
    getStore(db, store);
  }
  const perms = parsePermissions(
    values.perms === undefined
      ? store === ALL_STORES
        ? ["admin"]
        : ["read", "write"]
      : values.perms.split(",").map((entry) => entry.trim()).filter((entry) => entry !== ""),
  );
  const minted = mintKey(db, {
    store,
    label: values.label ?? "bootstrap",
    perms,
    now: () => Date.now(),
    expiresAt: parseExpiresAt(values.expires),
  });

  if (values.json) {
    process.stdout.write(
      `${JSON.stringify({
        key: minted.raw,
        id: minted.record.id,
        prefix: minted.record.prefix,
        store: minted.record.store,
        perms: minted.record.perms,
        expiresAt: minted.record.expiresAt,
      })}\n`,
    );
  } else {
    process.stdout.write(`${minted.raw}\n`);
    process.stderr.write(
      `minted ${minted.record.perms.join(",")} key ${minted.record.id} ` +
        `for store ${minted.record.store} — shown once, stored hashed, not recoverable\n`,
    );
  }
  process.exitCode = 0;
} catch (error) {
  if (error instanceof StoreError) {
    process.stderr.write(`admin:key failed: ${error.code}: ${error.message}\n`);
    process.exitCode = 1;
  } else {
    throw error;
  }
} finally {
  db.close();
}
