/**
 * PIN 4, 5, 8 — the object round-trip, the at-rest claim, and the named boundary
 * refusals. These drive the real app through `app.request()` against a real temp
 * data root, so "a blob exists" means a file on disk, not a mock call.
 */

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";
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

    // And the bytes on disk hash to the same value: the round trip is not a cache.
    const onDisk = server.listBlobFiles();
    const relative = `${expected.slice(0, 2)}/${expected}`;
    expect(onDisk).toEqual([`master/blobs/${relative}`]);
    const blob = readFileSync(join(server.dataRoot, "stores", "master", "blobs", relative));
    expect(createHash("sha256").update(blob).digest("hex")).toBe(expected);
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

  test("a GET where the blob is missing from disk fails loudly, not with empty bytes", async () => {
    const server = createTestServer();
    const key = server.mint({ stores: ["*"], perms: ["admin"] });
    await server.put("/stores/master/objects/gone.txt", PAYLOAD, key);
    // Prove the failure path: remove the blob behind the row's back.
    const { rmSync } = await import("node:fs");
    const blob = join(server.dataRoot, "stores", "master", "blobs", sha(PAYLOAD).slice(0, 2), sha(PAYLOAD));
    rmSync(blob);
    const response = await server.get("/stores/master/objects/gone.txt", key);
    expect(response.status).toBeGreaterThanOrEqual(500);
    expect((await readError(response)).code).toBe("internal");
  });

  test("DELETE removes the row and leaves the blob (GC is out of scope, stated)", async () => {
    const server = createTestServer();
    const key = server.mint({ stores: ["*"], perms: ["admin"] });
    await server.put("/stores/master/objects/temp.txt", PAYLOAD, key);
    const blobs = server.listBlobFiles();

    const del = await server.del("/stores/master/objects/temp.txt", key);
    expect(del.status).toBe(204);
    expect((await server.get("/stores/master/objects/temp.txt", key)).status).toBe(404);
    // The blob remains, deliberately — this is the documented omission, not a bug.
    expect(server.listBlobFiles()).toEqual(blobs);
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
