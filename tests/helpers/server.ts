/**
 * The ONE test harness.
 *
 * Every feature test builds a server through here, so there is exactly one fixture
 * shape: a real temp data root, a real SQLite file, a real Hono app driven through
 * `app.request()` (no port is ever bound in a test). Nothing here writes outside the
 * temp directory, and nothing here knows what a pin is.
 */

import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createApp } from "../../src/server/app.ts";
import { DISPLAY_PREFIX_LENGTH, keyIdFromRaw, mintKey, newRawKey } from "../../src/core/keys.ts";
import type { Permission, StoreKind } from "../../src/core/types.ts";

/**
 * A key row in the PRE-slice-8 shape (ONE nullable `access_keys.store`), for pin G6.
 *
 * `store` is the old single value: a store name, or `*` for a master key.
 */
export interface LegacyKeySeed {
  readonly store: string;
  readonly label: string;
  readonly perms: readonly Permission[];
}

export interface CreateServerOptions {
  /** Fixed clock, ms since epoch. Advanced by mutating `clock.value`. */
  readonly now?: number;
  readonly maxBytes?: number;
  readonly dataRoot?: string;
  /**
   * Stores to create in a LEGACY database before the migrated key rows that name
   * them. Only meaningful together with `legacyKeys`.
   */
  readonly legacyStores?: readonly string[];
  /**
   * Seed the database file in the OLD single-store shape BEFORE `createApp` opens it,
   * so the scope migration has something real to carry (pin G6). The raw keys come
   * back on `TestServer.legacyKeys`, in seed order.
   */
  readonly legacyKeys?: readonly LegacyKeySeed[];
}

export interface TestServer {
  /** Drive a full request without binding a port. */
  request(path: string, init?: RequestInit): Promise<Response>;
  get(path: string, key?: string): Promise<Response>;
  put(path: string, body: string | Uint8Array, key?: string): Promise<Response>;
  del(path: string, key?: string): Promise<Response>;
  postJson(path: string, body: unknown, key?: string): Promise<Response>;
  /** Run a function against the database file directly (fixture setup/cleanup). */
  direct<T>(fn: (db: DatabaseSync) => T): T;
  /** Seed a store directly, bypassing HTTP (fixture setup, not the thing under test). */
  seedStore(name: string, kind?: StoreKind): void;
  /** Mint directly, bypassing HTTP — for revoke/expire and scoped-key fixtures. */
  mint(options: {
    stores: readonly string[];
    perms: readonly Permission[];
    label?: string;
    expiresAt?: string | null;
  }): string;
  /** Open a second app on the SAME data root and database (the "second boot"). */
  reboot(): TestServer;
  writeFile(relativePath: string, contents: string): void;
  readDbBytes(): Buffer;
  /** Every file under the data root, root-relative paths, sorted. */
  listDataFiles(): string[];
  /** Every file under `stores/` (i.e. bytes a request could have written). */
  listBlobFiles(): string[];
  /** Raw keys seeded in the legacy shape, in seed order (empty unless requested). */
  readonly legacyKeys: readonly string[];
  readonly dataRoot: string;
  readonly dbPath: string;
  readonly clock: { value: number };
}

const servers: TestServer[] = [];

function build(deps: {
  dataRoot: string;
  dbPath: string;
  clock: { value: number };
  maxBytes: number;
  legacyKeys: readonly string[];
}): TestServer {
  const app = createApp({
    dataRoot: deps.dataRoot,
    dbPath: deps.dbPath,
    now: () => deps.clock.value,
    maxBytes: deps.maxBytes,
  });

  const bearer = (key?: string): Record<string, string> | undefined =>
    key === undefined ? undefined : { authorization: `Bearer ${key}` };

  const direct = <T>(fn: (db: DatabaseSync) => T): T => {
    const db = new DatabaseSync(deps.dbPath);
    try {
      return fn(db);
    } finally {
      db.close();
    }
  };

  const server: TestServer = {
    // Hono's `request` may return a Response synchronously; the harness always hands
    // back a promise so a test cannot depend on which shape it got.
    request: (path, init) => Promise.resolve(app.request(path, init)),
    get: (path, key) => Promise.resolve(app.request(path, { headers: bearer(key) })),
    put: (path, body, key) =>
      Promise.resolve(app.request(path, { method: "PUT", body, headers: bearer(key) })),
    del: (path, key) => Promise.resolve(app.request(path, { method: "DELETE", headers: bearer(key) })),
    postJson: (path, body, key) =>
      Promise.resolve(
        app.request(path, {
          method: "POST",
          body: JSON.stringify(body),
          headers: { "content-type": "application/json", ...(bearer(key) ?? {}) },
        }),
      ),
    direct,
    seedStore: (name, kind = "bytes") =>
      direct((db) => {
        db.prepare("INSERT INTO stores (name, kind, created_at) VALUES (?, ?, ?)").run(
          name,
          kind,
          "1970-01-01T00:00:00.000Z",
        );
      }),
    mint: (options) =>
      direct(
        (db) =>
          mintKey(db, {
            stores: options.stores,
            label: options.label ?? "fixture",
            perms: options.perms,
            now: () => deps.clock.value,
            expiresAt: options.expiresAt ?? null,
          }).raw,
      ),
    reboot: () => build(deps),
    writeFile: (relativePath, contents) =>
      writeFileSync(join(deps.dataRoot, relativePath), contents),
    readDbBytes: () => readFileSync(deps.dbPath),
    listDataFiles: () => walk(deps.dataRoot),
    listBlobFiles: () => {
      try {
        statSync(join(deps.dataRoot, "stores"));
      } catch {
        return [];
      }
      return walk(join(deps.dataRoot, "stores"));
    },
    dataRoot: deps.dataRoot,
    dbPath: deps.dbPath,
    clock: deps.clock,
    legacyKeys: deps.legacyKeys,
  };
  servers.push(server);
  return server;
}

function walk(root: string): string[] {
  const out: string[] = [];
  const visit = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const path = join(dir, entry.name);
      const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) visit(path, relative);
      else out.push(relative);
    }
  };
  visit(root, "");
  return out;
}

/** The created_at every seeded legacy row carries (the clock is fixed anyway). */
const LEGACY_CREATED_AT = "1970-01-01T00:00:00.000Z";

/**
 * Write a database file in the PRE-slice-8 shape: ONE nullable `access_keys.store`
 * column and no `key_stores` table. The raw keys are returned so the test can present
 * them to the migrated app.
 *
 * This is the ONE place the OLD shape is written, and it is written from the REAL key
 * format (`newRawKey()` + `keyIdFromRaw()`), never from a hand-rolled string — a
 * migration pin whose fixture guesses the format proves nothing about the migration.
 */
function seedLegacyDatabase(
  dbPath: string,
  storeNames: readonly string[],
  keys: readonly LegacyKeySeed[],
): string[] {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  const raw: string[] = [];
  try {
    db.exec(
      `CREATE TABLE stores (
         name TEXT PRIMARY KEY,
         kind TEXT NOT NULL,
         created_at TEXT NOT NULL
       )
       STRICT`,
    );
    db.exec(
      `CREATE TABLE access_keys (
         id TEXT PRIMARY KEY,
         store TEXT,
         label TEXT NOT NULL,
         key_hash TEXT NOT NULL,
         prefix TEXT NOT NULL,
         perms TEXT NOT NULL,
         subject_kind TEXT NOT NULL,
         created_at TEXT NOT NULL,
         expires_at TEXT,
         last_used_at TEXT,
         revoked_at TEXT
       )
       STRICT`,
    );
    // `master` is seeded by every boot (ensureMasterStore), so a legacy database has it.
    const insertStore = db.prepare(
      "INSERT INTO stores (name, kind, created_at) VALUES (?, 'bytes', ?)",
    );
    for (const name of ["master", ...storeNames]) insertStore.run(name, LEGACY_CREATED_AT);

    const insertKey = db.prepare(
      `INSERT INTO access_keys
         (id, store, label, key_hash, prefix, perms, subject_kind, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'token', ?)`,
    );
    for (const seed of keys) {
      const keyRaw = newRawKey();
      const id = keyIdFromRaw(keyRaw);
      if (id === null) throw new Error("the legacy fixture minted a key whose id does not parse");
      insertKey.run(
        id,
        seed.store,
        seed.label,
        sha256Hex(keyRaw),
        keyRaw.slice(0, DISPLAY_PREFIX_LENGTH),
        seed.perms.join(","),
        LEGACY_CREATED_AT,
      );
      raw.push(keyRaw);
    }
  } finally {
    db.close();
  }
  return raw;
}

/** Create a server on a fresh temp data root. */
export function createTestServer(options: CreateServerOptions = {}): TestServer {
  const dataRoot = options.dataRoot ?? mkdtempSync(join(tmpdir(), "serverstore-test-"));
  const dbPath = join(dataRoot, "serverstore.db");
  const clock = { value: options.now ?? Date.UTC(2026, 0, 1, 0, 0, 0) };
  const legacyKeys =
    options.legacyKeys === undefined
      ? []
      : seedLegacyDatabase(dbPath, options.legacyStores ?? [], options.legacyKeys);
  return build({
    dataRoot,
    dbPath,
    clock,
    maxBytes: options.maxBytes ?? 64 * 1024 * 1024,
    legacyKeys,
  });
}

/** Parse the one JSON error body shape. Fails loudly if the response is not that. */
export async function readError(response: Response): Promise<{ code: string; message: string }> {
  const body = (await response.json()) as { error?: { code?: string; message?: string } };
  if (body.error?.code === undefined) {
    throw new Error(`response is not the one error surface: ${JSON.stringify(body)}`);
  }
  return { code: body.error.code, message: body.error.message ?? "" };
}

/** The sha256 of a payload, hex — the content address the API reports. */
export function sha256Hex(bytes: string | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Pull the public id out of a raw key — the SAME parse the server uses.
 *
 * Never `raw.split("_")[1]`: base64url's alphabet contains `_`, so an id like
 * `_pCJkMlkqPPA` yields `""` from a split and silently looks up the wrong row.
 */
export function keyId(raw: string): string {
  const id = keyIdFromRaw(raw);
  if (id === null) throw new Error(`not a serverstore key: ${raw}`);
  return id;
}

/** Delete every server created by these helpers. Install in `afterEach`. */
export function cleanupTestServers(): void {
  for (const server of servers.splice(0)) {
    rmSync(server.dataRoot, { recursive: true, force: true });
  }
}
