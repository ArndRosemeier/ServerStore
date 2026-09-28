/**
 * PIN 4, 5, 8 — the object round-trip, the at-rest claim, and the named boundary
 * refusals. These drive the real app through `app.request()` against a real temp
 * data root, so "a blob exists" means a file on disk, not a mock call.
 */

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";
import {
  OBJECT_LIST_PREFIX_SQL,
  objectPrefixRange,
} from "../src/storage/kinds.ts";
import { createTestServer, cleanupTestServers, keyId, readError } from "./helpers/server.ts";

afterEach(cleanupTestServers);

const PAYLOAD = "the quick brown fox jumps over the lazy dog\n";

describe("the object round-trip (pin 4)", () => {
  test("PIN 4: PUT then GET returns byte-identical content (sha256 equal)", async () => {
    const server = createTestServer();
    const key = server.mint({ stores: ["*"], perms: ["admin"] });

    const put = await server.put("/stores/master/objects/greeting.txt", PAYLOAD, key);
    expect(put.status).toBe(201);
    const stored = (await put.json()) as { sha256: string; size: number };
    const expected = createHash("sha256").update(PAYLOAD).digest("hex");
    expect(stored.sha256).toBe(expected);
    expect(stored.size).toBe(Buffer.byteLength(PAYLOAD));

    const got = await server.get("/stores/master/objects/greeting.txt", key);
    expect(got.status).toBe(200);
    expect(got.headers.get("x-serverstore-sha256")).toBe(expected);
    expect(await got.text()).toBe(PAYLOAD);

    // And the bytes live IN the database (pin Y1, ledger row 79): the content column
    // holds exactly those bytes and hashes to the same value, and NO per-item file
    // exists anywhere under the data root any more.
    const storedBytes = server.objectContent("master", "greeting.txt");
    expect(storedBytes, "the objects row must carry its bytes").not.toBeNull();
    expect(createHash("sha256").update(storedBytes as Uint8Array).digest("hex")).toBe(expected);
    expect(Buffer.from(storedBytes as Uint8Array).toString()).toBe(PAYLOAD);
    expect(server.listBlobFiles()).toEqual([]);
    expect(server.listDataFiles().filter((path) => path.startsWith("stores/"))).toEqual([]);
  });

  test("binary bytes survive the round trip exactly", async () => {
    const server = createTestServer();
    const key = server.mint({ stores: ["*"], perms: ["admin"] });
    const bytes = new Uint8Array(512);
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = i % 256;

    expect((await server.put("/stores/master/objects/blob.bin", bytes, key)).status).toBe(201);
    const got = await server.get("/stores/master/objects/blob.bin", key);
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(bytes);
  });

  test("an empty body is refused 400 and creates no object", async () => {
    const server = createTestServer();
    const key = server.mint({ stores: ["*"], perms: ["admin"] });
    const response = await server.put("/stores/master/objects/empty.txt", "", key);
    expect(response.status).toBe(400);
    expect((await readError(response)).code).toBe("invalid_body");
    expect(server.listBlobFiles()).toEqual([]);
  });

  test("PUT is an upsert: the same name replaces the object and its metadata", async () => {
    const server = createTestServer();
    const key = server.mint({ stores: ["*"], perms: ["admin"] });
    await server.put("/stores/master/objects/x.txt", "one", key);
    await server.put("/stores/master/objects/x.txt", "two", key);

    const got = await server.get("/stores/master/objects/x.txt", key);
    expect(await got.text()).toBe("two");
    const rows = server.direct(
      (db) => db.prepare("SELECT name, size FROM objects WHERE store = 'master'").all() as unknown[],
    );
    expect(rows).toHaveLength(1);
  });

  test("GET of a missing object is 404 with the one error shape", async () => {
    const server = createTestServer();
    const key = server.mint({ stores: ["*"], perms: ["admin"] });
    const response = await server.get("/stores/master/objects/nope.txt", key);
    expect(response.status).toBe(404);
    expect((await readError(response)).code).toBe("not_found");
  });

  test("a GET whose row has no content fails loudly, not with empty bytes", async () => {
    const server = createTestServer();
    const key = server.mint({ stores: ["*"], perms: ["admin"] });
    await server.put("/stores/master/objects/gone.txt", PAYLOAD, key);
    // Prove the failure path: blank the content behind the row's back, which is what a
    // database written AROUND the storage layer looks like. The boot import guarantees
    // this cannot happen through the app, so reaching it must be a loud 500.
    server.direct((db) => {
      db.prepare("UPDATE objects SET content = NULL WHERE store = 'master' AND name = 'gone.txt'").run();
    });
    const response = await server.get("/stores/master/objects/gone.txt", key);
    expect(response.status).toBeGreaterThanOrEqual(500);
    expect((await readError(response)).code).toBe("internal");
  });

  test("DELETE removes the row and its bytes with it (the shared-content case is pin X7)", async () => {
    const server = createTestServer();
    const key = server.mint({ stores: ["*"], perms: ["admin"] });
    await server.put("/stores/master/objects/temp.txt", PAYLOAD, key);
    expect(server.objectContent("master", "temp.txt")).not.toBeNull();

    const del = await server.del("/stores/master/objects/temp.txt", key);
    expect(del.status).toBe(204);
    expect((await server.get("/stores/master/objects/temp.txt", key)).status).toBe(404);
    // The bytes went WITH the row: they are the same thing now, so there is no second
    // place that could still hold them and no orphan left behind.
    expect(server.objectContent("master", "temp.txt")).toBeNull();
    expect(server.listBlobFiles()).toEqual([]);
  });

  test("the object listing is scoped to its store and sorted by name", async () => {
    const server = createTestServer();
    const key = server.mint({ stores: ["*"], perms: ["admin"] });
    await server.postJson("/stores", { name: "other" }, key);
    await server.put("/stores/master/objects/b.txt", "b", key);
    await server.put("/stores/master/objects/a.txt", "a", key);
    await server.put("/stores/other/objects/c.txt", "c", key);

    const listed = (await (await server.get("/stores/master/objects", key)).json()) as {
      objects: { name: string }[];
    };
    expect(listed.objects.map((object) => object.name)).toEqual(["a.txt", "b.txt"]);
  });
});

/**
 * The ONE filter the listing has (ledger row 61). Fixture note: `room-4` is stored AND
 * is a prefix of three other names, so it is the SHARED PARTIAL boundary a `>` in place
 * of `>=` would silently drop (differential arm A), and `room-42.` ends before
 * `room-420.x` so the range cannot be a naive `LIKE 'room-42.%'`-style blur.
 */
describe("the object-listing prefix filter (pins P1-P7, ledger row 61)", () => {
  const NAMES = ["room-4", "room-42.a", "room-420.x", "room-4x", "room-5", "other.txt"];

  /** Seed the one fixture these pins share, through the real API. */
  async function seeded() {
    const server = createTestServer();
    const key = server.mint({ stores: ["*"], perms: ["admin"] });
    for (const name of NAMES) {
      const response = await server.put(`/stores/master/objects/${name}`, name, key);
      expect(response.status, `${name} must be stored`).toBe(201);
    }
    return { server, key };
  }

  async function listed(
    server: Awaited<ReturnType<typeof seeded>>["server"],
    key: string,
    query: string,
  ): Promise<{ status: number; names: string[]; body: { objects: Record<string, unknown>[] } }> {
    const response = await server.get(`/stores/master/objects${query}`, key);
    const body = (await response.json()) as { objects: Record<string, unknown>[] };
    return { status: response.status, names: body.objects.map((object) => String(object.name)), body };
  }

  test("PIN P1: ?prefix= returns exactly the matching entries", async () => {
    const { server, key } = await seeded();

    const shared = await listed(server, key, "?prefix=room-4");
    expect(shared.status).toBe(200);
    // `room-4` is itself a stored name, and `room-4` is a prefix of the other three.
    expect(shared.names).toEqual(["room-4", "room-42.a", "room-420.x", "room-4x"]);
    // The response SHAPE and field set are unchanged (only the row set narrowed).
    expect(Object.keys(shared.body.objects[0] ?? {}).sort()).toEqual([
      "createdAt",
      "name",
      "sha256",
      "size",
      "store",
    ]);

    // A LONGER prefix is not a superset and stops at its own boundary: `room-42.` does
    // NOT match `room-420.x` (`.` is below `0` in the range, so the bound is exact).
    const narrower = await listed(server, key, "?prefix=room-42.");
    expect(narrower.names).toEqual(["room-42.a"]);

    // And a wider one takes the whole family, still ordered by name.
    const wider = await listed(server, key, "?prefix=room");
    expect(wider.names).toEqual(["room-4", "room-42.a", "room-420.x", "room-4x", "room-5"]);
  });

  test("PIN P2: a prefix that matches nothing is 200 with an empty list, never 404", async () => {
    const { server, key } = await seeded();
    const response = await server.get("/stores/master/objects?prefix=zzz", key);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ objects: [] });
  });

  test("PIN P3: an empty or whitespace prefix is refused 400 invalid_name — NOT the whole store", async () => {
    const { server, key } = await seeded();
    for (const query of ["?prefix=", "?prefix=%20", "?prefix=%20%20"]) {
      const response = await server.get(`/stores/master/objects${query}`, key);
      expect(response.status, query).toBe(400);
      expect((await readError(response)).code, query).toBe("invalid_name");
    }
    // The refusal is LOUD: nothing above returned the whole store as a silent fallback.
    expect((await listed(server, key, "")).names).toEqual([...NAMES].sort());
  });

  test("PIN P4: an unmatchable prefix is refused, never silently empty", async () => {
    const { server, key } = await seeded();
    const unmatchable = [
      "Room", // uppercase can never appear in a stored name
      "a/b", // a slash is not in the charset
      ".hidden", // a leading dot is refused by the ONE name rule
      "..", // a path segment, not a name
      "a".repeat(65), // over the 64-character cap
      "with space", // whitespace is not in the charset
      "-leading", // must start with a letter or digit
      "semi;colon", // punctuation outside the charset
    ];
    for (const prefix of unmatchable) {
      const response = await server.get(
        `/stores/master/objects?prefix=${encodeURIComponent(prefix)}`,
        key,
      );
      expect(response.status, prefix).toBe(400);
      expect((await readError(response)).code, prefix).toBe("invalid_name");
    }
  });

  test("PIN P5: with NO prefix the listing is byte-for-byte what it was", async () => {
    const { server, key } = await seeded();
    const response = await server.get("/stores/master/objects", key);
    expect(response.status).toBe(200);
    // The fixed clock makes `createdAt` deterministic, so this is the EXACT body the
    // route produced before the filter existed: every object, ordered by name.
    const expected = {
      objects: [...NAMES].sort().map((name) => ({
        store: "master",
        name,
        sha256: sha(name),
        size: Buffer.byteLength(name),
        createdAt: "2026-01-01T00:00:00.000Z",
      })),
    };
    expect(await response.text()).toBe(JSON.stringify(expected));
  });

  test("PIN P6: the filter changes no authorization", async () => {
    const server = createTestServer();
    const master = server.mint({ stores: ["*"], perms: ["admin"] });
    await server.postJson("/stores", { name: "other" }, master);
    await server.put("/stores/master/objects/shared.x", "x", master);
    await server.put("/stores/other/objects/shared.y", "y", master);
    const masterReader = server.mint({ stores: ["master"], perms: ["read"] });
    const otherReader = server.mint({ stores: ["other"], perms: ["read"] });

    // A key that MAY read: 200 with and without a prefix.
    for (const query of ["", "?prefix=shared."]) {
      expect((await server.get(`/stores/master/objects${query}`, masterReader)).status, query).toBe(200);
    }

    // A key WITHOUT read on the store: 403 with and without a prefix — and authorization
    // is decided BEFORE the prefix is validated, so even an ILLEGAL prefix is a 403 for
    // this caller, never a 400 that would leak the filter's rules to an outsider.
    for (const query of ["", "?prefix=shared.", "?prefix=BAD"]) {
      const response = await server.get(`/stores/master/objects${query}`, otherReader);
      expect(response.status, query).toBe(403);
      expect((await readError(response)).code, query).toBe("forbidden");
    }

    // No key at all: 401, prefix or not.
    for (const query of ["", "?prefix=shared."]) {
      expect((await server.get(`/stores/master/objects${query}`)).status, query).toBe(401);
    }

    // An unknown store is still 404, prefix or not.
    for (const query of ["", "?prefix=shared."]) {
      expect((await server.get(`/stores/nope/objects${query}`, master)).status, query).toBe(404);
    }

    // A prefix that names another store's namespace returns only THIS store's rows.
    const mine = await listed(server, master, "?prefix=shared");
    expect(mine.names).toEqual(["shared.x"]);
    const theirs = await (await server.get("/stores/other/objects?prefix=shared", master)).json() as {
      objects: { name: string }[];
    };
    expect(theirs.objects.map((object) => object.name)).toEqual(["shared.y"]);
  });

  test("PIN P7: the prefix query is a RANGE on the primary key", async () => {
    const { server } = await seeded();
    // EXPLAIN the REAL exported statement, bound with the REAL production parameters:
    // a pin that re-typed the SQL would prove nothing about what the server runs.
    const plan = server.direct((db) =>
      (
        db
          .prepare(`EXPLAIN QUERY PLAN ${OBJECT_LIST_PREFIX_SQL}`)
          .all(...objectPrefixRange("master", "room-4")) as unknown as { detail: string }[]
      ).map((row) => row.detail),
    );
    expect(plan.length, "EXPLAIN QUERY PLAN returned no rows — the pin is blind").toBeGreaterThan(0);
    // NOT a full scan of the store.
    expect(plan.filter((detail) => /SCAN objects/.test(detail))).toEqual([]);
    // NOT merely a store-equality probe either: the index search must carry the NAME
    // RANGE. This is the half a `substr(name, 1, length(?)) = ?` implementation LOSES
    // (it still says SEARCH ... (store=?), which is why "no SCAN" alone cannot fail).
    const unbounded = plan.filter(
      (detail) =>
        !/SEARCH objects USING (?:COVERING )?INDEX \S+ \(store=\? AND name>\? AND name<\?\)/.test(
          detail,
        ),
    );
    expect(
      unbounded,
      `the filtered statement is not a (store, name) index range: ${JSON.stringify(plan)}`,
    ).toEqual([]);
    // And the statement itself carries no LIKE/substr, so a future edit cannot keep the
    // plan green while re-introducing a row-by-row filter.
    expect(OBJECT_LIST_PREFIX_SQL).not.toMatch(/LIKE|substr/i);
  });
});

describe("the raw key is never stored (pin 5)", () => {
  test("PIN 5: the presented key string never appears in the database file", async () => {
    const server = createTestServer();
    const master = server.mint({ stores: ["*"], perms: ["admin"], label: "master" });
    const scopedResponse = await server.postJson(
      "/keys",
      { stores: ["master"], perms: ["read", "write"], label: "scoped" },
      master,
    );
    const scoped = ((await scopedResponse.json()) as { key: string }).key;

    const dbBytes = server.readDbBytes();
    expect(dbBytes.includes(master), "the master key must not be in serverstore.db").toBe(false);
    expect(dbBytes.includes(scoped), "the scoped key must not be in serverstore.db").toBe(false);

    // Only the hash is there: find the row and check byte-for-byte.
    const row = server.direct(
      (db) => db.prepare("SELECT key_hash, prefix FROM access_keys WHERE id = ?").get(
        keyId(scoped),
      ) as { key_hash: string; prefix: string } | undefined,
    );
    expect(row?.key_hash).toBe(sha(scoped));
    expect(row?.prefix).toBe(scoped.slice(0, 12));
    expect(dbBytes.includes(row?.key_hash as string)).toBe(true);
  });

  test("PIN 5: the key registered by the CLI is hashed at rest too", async () => {
    const server = createTestServer();
    const run = spawnSync("node", ["--experimental-strip-types", "src/admin/mint-key.ts"], {
      cwd: fileURLToPath(new URL("../", import.meta.url)),
      encoding: "utf8",
      env: { ...process.env, SERVERSTORE_DATA_ROOT: server.dataRoot },
      timeout: 60_000,
    });
    const key = (run.stdout ?? "")
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.startsWith("ssk_"));
    expect(key, run.stderr).toBeDefined();
    expect(server.readDbBytes().includes(key as string)).toBe(false);
  });
});

describe("named boundary refusals (pin 8)", () => {
  test("PIN 8: a path-traversal attempt is refused 400 and writes nothing", async () => {
    const server = createTestServer();
    const key = server.mint({ stores: ["*"], perms: ["admin"] });
    const before = server.listDataFiles();

    const attempts = [
      "/stores/master/objects/..%2F..%2Fetc",
      "/stores/master/objects/../etc/passwd",
      "/stores/..%2F..%2Fetc/objects",
      "/stores/.hidden/objects",
      "/stores/master/objects/%2E%2E",
    ];
    for (const path of attempts) {
      const response = await server.get(path, key);
      expect(response.status, `${path} must be refused`).toBe(400);
      expect((await readError(response)).code, path).toBe("invalid_name");
    }
    expect(server.listDataFiles()).toEqual(before);
    expect(server.listBlobFiles()).toEqual([]);
  });

  test("PIN 8: an over-cap body is refused 413 and stores nothing", async () => {
    const server = createTestServer({ maxBytes: 1024 });
    const key = server.mint({ stores: ["*"], perms: ["admin"] });
    const over = "x".repeat(4096);

    const response = await server.put("/stores/master/objects/big.bin", over, key);
    expect(response.status).toBe(413);
    expect((await readError(response)).code).toBe("payload_too_large");
    expect(server.listBlobFiles()).toEqual([]);
    expect(
      server.direct((db) => (db.prepare("SELECT COUNT(*) AS n FROM objects").get() as { n: number }).n),
    ).toBe(0);
  });

  test("PIN 8: a body exactly at the cap is accepted", async () => {
    const server = createTestServer({ maxBytes: 1024 });
    const key = server.mint({ stores: ["*"], perms: ["admin"] });
    const exact = "x".repeat(1024);
    const response = await server.put("/stores/master/objects/exact.bin", exact, key);
    expect(response.status).toBe(201);
    const got = await server.get("/stores/master/objects/exact.bin", key);
    expect((await got.arrayBuffer()).byteLength).toBe(1024);
  });

  test("PIN 8: an illegal store or object name is 400 invalid_name", async () => {
    const server = createTestServer();
    const key = server.mint({ stores: ["*"], perms: ["admin"] });
    const names = ["UPPER", "with space", ".hidden", "..hidden", "-leading", "a".repeat(65), "semi;colon"];
    for (const name of names) {
      const put = await server.put(`/stores/master/objects/${encodeURIComponent(name)}`, "x", key);
      expect(put.status, `object name ${name}`).toBe(400);
      expect((await readError(put)).code, `object name ${name}`).toBe("invalid_name");
    }
    const store = await server.postJson("/stores", { name: "Bad Name" }, key);
    expect(store.status).toBe(400);
    expect((await readError(store)).code).toBe("invalid_name");
  });

  test("PIN 8: a dotted name that is NOT a traversal segment is a legal name", async () => {
    // `dot.start` and `a..b` match the schema `[a-z0-9][a-z0-9._-]{0,63}` exactly, and
    // no path layer interprets them: they are refused neither as names nor as paths.
    // The refusal rule is about `..` AS A SEGMENT, not about the two characters.
    const server = createTestServer();
    const key = server.mint({ stores: ["*"], perms: ["admin"] });
    for (const name of ["dot.start", "a..b", "v1.2.3-beta_1"]) {
      const put = await server.put(`/stores/master/objects/${name}`, name, key);
      expect(put.status, `object name ${name}`).toBe(201);
      const got = await server.get(`/stores/master/objects/${name}`, key);
      expect(await got.text()).toBe(name);
    }
  });

  test("PIN 8: an unknown store kind is refused at the boundary, never defaulted", async () => {
    const server = createTestServer();
    const key = server.mint({ stores: ["*"], perms: ["admin"] });
    const response = await server.postJson("/stores", { name: "weird", kind: "json" }, key);
    expect(response.status).toBe(400);
    expect((await readError(response)).code).toBe("bad_request");
    expect(
      server.direct((db) => (db.prepare("SELECT COUNT(*) AS n FROM stores WHERE name = 'weird'").get() as { n: number }).n),
    ).toBe(0);
  });
});

function sha(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
