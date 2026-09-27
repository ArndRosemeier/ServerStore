/**
 * The ONE test harness.
 *
 * Every feature test builds a server through here, so there is exactly one fixture
 * shape: a real temp data root, a real SQLite file, a real Hono app driven through
 * `app.request()` (no port is ever bound in a test). Nothing here writes outside the
 * temp directory, and nothing here knows what a pin is.
 */

import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createApp } from "../../src/server/app.ts";
import { keyIdFromRaw, mintKey } from "../../src/core/keys.ts";
import type { Permission, StoreKind } from "../../src/core/types.ts";

export interface CreateServerOptions {
  /** Fixed clock, ms since epoch. Advanced by mutating `clock.value`. */
  readonly now?: number;
  readonly maxBytes?: number;
  readonly dataRoot?: string;
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
    store: string;
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
            store: options.store,
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

/** Create a server on a fresh temp data root. */
export function createTestServer(options: CreateServerOptions = {}): TestServer {
  const dataRoot = options.dataRoot ?? mkdtempSync(join(tmpdir(), "serverstore-test-"));
  const clock = { value: options.now ?? Date.UTC(2026, 0, 1, 0, 0, 0) };
  return build({
    dataRoot,
    dbPath: join(dataRoot, "serverstore.db"),
    clock,
    maxBytes: options.maxBytes ?? 64 * 1024 * 1024,
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
