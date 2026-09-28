/**
 * PINS Y1–Y3 and Y8 — the SQLite core: the bytes are IN the database, the boot import
 * carries a pre-slice-17 data root across, and the medium is ENCAPSULATED.
 *
 *   PIN Y1  an entry's bytes live in the database and the blob files are gone
 *   PIN Y2  the import carries existing content across, RE-VERIFIES every hash before
 *           deleting anything, and a missing/corrupt/mismatched blob FAILS THE BOOT
 *   PIN Y3  the import preserves every key: rows, scopes and timestamps byte-identical,
 *           and a key still authenticates
 *   PIN Y8  the medium is encapsulated: no item SQL and no blob/path knowledge outside
 *           `src/storage/`, and the routes still reach it only through `handlerFor()`
 *
 * The legacy fixtures are built from the REAL code (`openDatabase` + `mintKey`) and then
 * have the `content` column DROPPED, so the boot exercises the add-if-absent migration
 * and the import together, against the shape the previous code actually wrote.
 *
 * No pin touches the live data root; scratch lives under `<worktree>/.sqlite-scratch/`.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, afterEach, describe, expect, test } from "vitest";
import { openDatabase } from "../src/core/db.ts";
import { mintKey } from "../src/core/keys.ts";
import type { Permission } from "../src/core/types.ts";
import { ensureMasterStore } from "../src/stores/registry.ts";
import {
  cleanupTestServers,
  createTestServer,
  keyId,
  registeredRoutes,
  sha256Hex,
} from "./helpers/server.ts";
import { REPO_ROOT, removeScratch, scratchDir } from "./helpers/child.ts";

afterEach(cleanupTestServers);
afterAll(() => removeScratch("boot"));

const CREATED_AT = "2026-01-01T00:00:00.000Z";

const encoder = new TextEncoder();

/** One entry of a legacy store: bytes on disk, a row in `objects`, and the mismatches. */
interface LegacyEntry {
  readonly name: string;
  /** The bytes actually WRITTEN to the legacy blob file. */
  readonly bytes: string;
  /** The sha256 recorded in the row; defaults to the hash of the written bytes. */
  readonly sha256?: string;
  /** The size recorded in the row; defaults to the written byte length. */
  readonly size?: number;
  /** When true, write NO blob file at all (the MISSING case). */
  readonly omitBlob?: boolean;
}

interface LegacyStore {
  readonly name: string;
  readonly entries: readonly LegacyEntry[];
}

interface LegacyKeySeed {
  readonly stores: readonly string[];
  readonly perms: readonly Permission[];
  readonly label: string;
}

/**
 * Build a PRE-slice-17 data root: the real schema with `objects.content` DROPPED, rows
 * in `objects`, and the bytes as content-addressed files under
 * `<dataRoot>/stores/<store>/blobs/<sha[0:2]>/<sha>`.
 *
 * Returns the raw keys of any seeded grants, so a pin can prove they survive and still
 * authenticate.
 */
function seedLegacyDataRoot(
  dir: string,
  stores: readonly LegacyStore[],
  keys: readonly LegacyKeySeed[] = [],
): string[] {
  mkdirSync(dir, { recursive: true });
  const db = openDatabase(join(dir, "serverstore.db"));
  const raw: string[] = [];
  try {
    ensureMasterStore(db, () => Date.parse(CREATED_AT));
    // THE OLD SHAPE: an object row had no bytes of its own.
    db.exec("ALTER TABLE objects DROP COLUMN content");

    for (const store of stores) {
      db.prepare(
        "INSERT OR IGNORE INTO stores (name, kind, created_at) VALUES (?, 'bytes', ?)",
      ).run(store.name, CREATED_AT);
      const blobDir = join(dir, "stores", store.name, "blobs");
      // The legacy TREE exists even when a file is missing, so "nothing was deleted"
      // is observable after the failed boot.
      mkdirSync(blobDir, { recursive: true });
      for (const entry of store.entries) {
        const payload = Buffer.from(entry.bytes);
        const sha = entry.sha256 ?? sha256Hex(payload);
        const size = entry.size ?? payload.byteLength;
        if (entry.omitBlob !== true) {
          const shard = join(blobDir, sha.slice(0, 2));
          mkdirSync(shard, { recursive: true });
          writeFileSync(join(shard, sha), payload);
        }
        db.prepare(
          "INSERT INTO objects (store, name, sha256, size, created_at) VALUES (?, ?, ?, ?, ?)",
        ).run(store.name, entry.name, sha, size, CREATED_AT);
      }
    }

    for (const key of keys) {
      raw.push(
        mintKey(db, {
          stores: key.stores,
          label: key.label,
          perms: key.perms,
          now: () => Date.parse(CREATED_AT),
          expiresAt: null,
        }).raw,
      );
    }
  } finally {
    db.close();
  }
  return raw;
}

/** The legacy path of one entry's file, for "the tree is gone/untouched" assertions. */
function legacyBlobPath(dir: string, store: string, sha: string): string {
  return join(dir, "stores", store, "blobs", sha.slice(0, 2), sha);
}

/** Every grant row and scope row, read WITHOUT running boot DDL. */
function snapshotGrants(dbPath: string): { keys: unknown[]; scopes: unknown[] } {
  const db = new DatabaseSync(dbPath);
  try {
    return {
      keys: db.prepare("SELECT * FROM access_keys ORDER BY id").all(),
      scopes: db.prepare("SELECT key_id, store FROM key_stores ORDER BY key_id, store").all(),
    };
  } finally {
    db.close();
  }
}

/** The `content` column of one row, or `null`; the row's absence is a loud test error. */
function contentOf(dbPath: string, store: string, name: string): Uint8Array | null {
  const db = new DatabaseSync(dbPath);
  try {
    const row = db
      .prepare("SELECT content FROM objects WHERE store = ? AND name = ?")
      .get(store, name) as { content: Uint8Array | null } | undefined;
    if (row === undefined) throw new Error(`no objects row for ${store}/${name}`);
    return row.content === null ? null : new Uint8Array(row.content);
  } finally {
    db.close();
  }
}

/** Every `.ts` file under `src/`, sorted. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    else if (entry.name.endsWith(".ts")) out.push(path);
  }
  return out.sort();
}

describe("PIN Y1: the bytes live in the database (ledger row 79)", () => {
  test("PIN Y1: an entry's bytes live in the database and the blob files are gone", async () => {
    const server = createTestServer();
    const key = server.mint({ stores: ["*"], perms: ["admin"] });
    const payload = encoder.encode("slice 17: the bytes are IN the row\n");
    const expected = createHash("sha256").update(payload).digest("hex");

    const put = await server.put("/stores/master/objects/y1.bin", payload, key);
    expect(put.status).toBe(201);
    const storedBody = (await put.json()) as { sha256: string; size: number };
    expect(storedBody.sha256).toBe(expected);
    expect(storedBody.size).toBe(payload.byteLength);

    // Read back byte-identical, with the SAME hash the API advertises.
    const got = await server.get("/stores/master/objects/y1.bin", key);
    expect(got.status).toBe(200);
    expect(got.headers.get("x-serverstore-sha256")).toBe(expected);
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(payload);

    // The content column is populated and hashes to the row's own sha256.
    const content = server.objectContent("master", "y1.bin");
    expect(content, "the objects row must carry the bytes").not.toBeNull();
    expect(createHash("sha256").update(content as Uint8Array).digest("hex")).toBe(expected);

    // NO file under the data root holds that content: the only files are the database
    // and its WAL sidecars, and the whole `stores/` floor is gone.
    expect(server.listBlobFiles()).toEqual([]);
    for (const path of server.listDataFiles()) {
      expect(path, `an unexplained file is in the data root: ${path}`).toMatch(
        /^serverstore\.db(-wal|-shm)?$/,
      );
    }
  });

  test("an upsert REPLACES both the bytes and the hash, so the two can never drift", async () => {
    const server = createTestServer();
    const key = server.mint({ stores: ["*"], perms: ["admin"] });
    await server.put("/stores/master/objects/x.bin", "one", key);
    const second = await server.put("/stores/master/objects/x.bin", "two", key);
    const expected = sha256Hex("two");
    expect(((await second.json()) as { sha256: string }).sha256).toBe(expected);
    expect(server.objectContent("master", "x.bin")).toEqual(encoder.encode("two"));
    const got = await server.get("/stores/master/objects/x.bin", key);
    expect(got.headers.get("x-serverstore-sha256")).toBe(expected);
  });
});

describe("PIN Y2: the boot import carries content across and verifies it", () => {
  test("PIN Y2: every entry is imported with its original sha256, and the blob tree is gone", async () => {
    const dataRoot = scratchDir("boot", "y2-happy");
    seedLegacyDataRoot(dataRoot, [
      {
        name: "master",
        entries: [
          { name: "a.txt", bytes: "alpha" },
          { name: "b.txt", bytes: "bravo" },
        ],
      },
      { name: "colossus", entries: [{ name: "game.x", bytes: "state" }] },
    ]);
    // BEFORE: the old layout exists and the `content` column does not.
    expect(existsSync(legacyBlobPath(dataRoot, "master", sha256Hex("alpha")))).toBe(true);
    const before = new DatabaseSync(join(dataRoot, "serverstore.db"));
    const columnsBefore = (before.prepare("PRAGMA table_info(objects)").all() as unknown as {
      name: string;
    }[]).map((column) => column.name);
    before.close();
    expect(columnsBefore).not.toContain("content");

    const server = createTestServer({ dataRoot });
    const master = server.mint({ stores: ["*"], perms: ["admin"] });

    // The add-if-absent migration ran, and every entry reads back byte-identical with
    // its ORIGINAL hash — the hash was re-verified from the file, not copied.
    const columnsAfter = server
      .direct(
        (db) =>
          db.prepare("PRAGMA table_info(objects)").all() as unknown as { name: string }[],
      )
      .map((column) => column.name);
    expect(columnsAfter).toContain("content");

    for (const [store, name, text] of [
      ["master", "a.txt", "alpha"],
      ["master", "b.txt", "bravo"],
      ["colossus", "game.x", "state"],
    ] as const) {
      const got = await server.get(`/stores/${store}/objects/${name}`, master);
      expect(got.status, `${store}/${name} must read`).toBe(200);
      expect(await got.text()).toBe(text);
      expect(got.headers.get("x-serverstore-sha256")).toBe(sha256Hex(text));
      expect(server.objectContent(store, name)).toEqual(encoder.encode(text));
    }

    // The whole blob layout is GONE — the root included.
    expect(existsSync(join(dataRoot, "stores"))).toBe(false);
    expect(server.listBlobFiles()).toEqual([]);

    // Idempotent: a SECOND boot imports nothing, deletes nothing and still reads.
    const rebooted = server.reboot();
    expect((await rebooted.get("/stores/master/objects/a.txt", master)).status).toBe(200);
    expect(rebooted.objectContent("colossus", "game.x")).toEqual(encoder.encode("state"));
  });

  test("PIN Y2: a MISSING blob FAILS THE BOOT, and nothing is deleted or invented", () => {
    const dataRoot = scratchDir("boot", "y2-missing");
    seedLegacyDataRoot(dataRoot, [
      { name: "master", entries: [{ name: "gone.txt", bytes: "payload", omitBlob: true }] },
    ]);
    const sha = sha256Hex("payload");
    expect(existsSync(legacyBlobPath(dataRoot, "master", sha))).toBe(false);

    expect(() => createTestServer({ dataRoot })).toThrow(/MISSING/);

    // The row still has no content and the legacy tree is still there: the failure
    // stopped the boot instead of dropping the entry or deleting its files.
    expect(contentOf(join(dataRoot, "serverstore.db"), "master", "gone.txt")).toBeNull();
    expect(existsSync(join(dataRoot, "stores", "master", "blobs"))).toBe(true);
  });

  test("PIN Y2: a HASH MISMATCH fails the boot (the bytes are not the entry)", () => {
    const dataRoot = scratchDir("boot", "y2-hash");
    // Same LENGTH as the good payload, so the size check passes and the hash check is
    // the one under test.
    seedLegacyDataRoot(dataRoot, [
      { name: "master", entries: [{ name: "bad.txt", bytes: "baad", sha256: sha256Hex("good") }] },
    ]);
    expect(() => createTestServer({ dataRoot })).toThrow(/hashes to/);
    expect(contentOf(join(dataRoot, "serverstore.db"), "master", "bad.txt")).toBeNull();
    expect(existsSync(legacyBlobPath(dataRoot, "master", sha256Hex("good")))).toBe(true);
  });

  test("PIN Y2: a SIZE mismatch fails the boot", () => {
    const dataRoot = scratchDir("boot", "y2-size");
    seedLegacyDataRoot(dataRoot, [
      { name: "master", entries: [{ name: "short.txt", bytes: "hello world!", size: 3 }] },
    ]);
    expect(() => createTestServer({ dataRoot })).toThrow(/objects row says/);
    expect(contentOf(join(dataRoot, "serverstore.db"), "master", "short.txt")).toBeNull();
  });
});

describe("PIN Y3: the import preserves the keys (the owner's must-survive)", () => {
  test("PIN Y3: every key row, scope and timestamp is untouched, and a key still authenticates", async () => {
    const dataRoot = scratchDir("boot", "y3");
    const [rawKey] = seedLegacyDataRoot(
      dataRoot,
      [{ name: "notes", entries: [{ name: "state.json", bytes: '{"v":1}' }] }],
      [{ stores: ["notes"], perms: ["read", "write"], label: "the-survivor" }],
    );
    const dbPath = join(dataRoot, "serverstore.db");
    const before = snapshotGrants(dbPath);
    expect(before.keys, "the fixture must seed a key").toHaveLength(1);

    const server = createTestServer({ dataRoot });
    // Read the grants BEFORE any request: the migration must not have touched them.
    expect(snapshotGrants(dbPath)).toEqual(before);

    // The credential still authenticates, with the same id, scope and permissions.
    const who = await server.get("/whoami", rawKey as string);
    expect(who.status, await who.clone().text()).toBe(200);
    const body = (await who.json()) as { id: string; stores: string[]; perms: string[] };
    expect(body.id).toBe(keyId(rawKey as string));
    expect(body.stores).toEqual(["notes"]);
    expect(body.perms).toEqual(["read", "write"]);
    // …and the key can use the imported content.
    expect(
      await (await server.get("/stores/notes/objects/state.json", rawKey as string)).text(),
    ).toBe('{"v":1}');
  });
});

describe("PIN Y8: the medium is encapsulated (ledger row 78)", () => {
  test("PIN Y8: no item SQL and no blob/path knowledge exists outside src/storage/", () => {
    const storage = join(REPO_ROOT, "src", "storage") + "/";
    const outside = sourceFiles(join(REPO_ROOT, "src")).filter(
      (file) => !file.startsWith(storage),
    );
    expect(outside.length, "the grep must have files to check").toBeGreaterThan(0);
    for (const file of outside) {
      const source = readFileSync(file, "utf8");
      expect(source, `${relative(REPO_ROOT, file)} runs item SQL`).not.toMatch(
        /(FROM|INTO|UPDATE|JOIN)\s+objects\b/i,
      );
      expect(source, `${relative(REPO_ROOT, file)} knows the old blob path`).not.toMatch(
        /\bblobs\//,
      );
      expect(source, `${relative(REPO_ROOT, file)} uses a storage path helper`).not.toMatch(
        /\b(storeDir|blobPath|blobsRoot|storesRoot|legacyBlobPath)\b/,
      );
    }
    // And the item DML really IS in `src/storage/` — the rule above must not pass because
    // the statement moved somewhere unexpected instead.
    const storageSources = sourceFiles(join(REPO_ROOT, "src", "storage")).map((file) =>
      readFileSync(file, "utf8"),
    );
    expect(storageSources.some((source) => /FROM objects\b/.test(source))).toBe(true);
  });

  test("PIN Y8: the routes reach the medium only through handlerFor(), and the item routes are unchanged", () => {
    const app = readFileSync(join(REPO_ROOT, "src", "server", "app.ts"), "utf8");
    // The dispatch point is the ONLY item surface the routes name.
    expect(app).toMatch(/handlerFor\(store\.kind\)/);
    expect(app).not.toMatch(/bytesHandler|HANDLERS\b/);

    // The route set the object, destructive and API-doc pins depend on is intact
    // (PIN A1/A2/A3 and X1–X9 stay green in the same gate).
    expect(registeredRoutes()).toEqual(
      expect.arrayContaining([
        "GET /stores/:store/objects",
        "PUT /stores/:store/objects/:name",
        "GET /stores/:store/objects/:name",
        "DELETE /stores/:store/objects/:name",
        "DELETE /stores/:store/objects",
        "DELETE /stores/:store",
      ]),
    );
  });
});
