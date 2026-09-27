/**
 * PIN 1, 2, 3, 7 and 9 — the authorization half of the request pipeline.
 *
 * Each test's NAME says what it protects, and every test drives the real app through
 * `app.request()`: no port is bound, no HTTP client is stubbed.
 */

import { afterEach, describe, expect, test } from "vitest";
import { createTestServer, cleanupTestServers, keyId, readError } from "./helpers/server.ts";

afterEach(cleanupTestServers);

describe("auth: the key is the whole perimeter (ledger row 6, pin 1)", () => {
  test("PIN 1: no key is refused 401 and nothing is written to the data root", async () => {
    const server = createTestServer();
    const beforeFiles = server.listDataFiles();
    const beforeObjects = countObjects(server);

    const response = await server.request("/stores/master/objects", {
      method: "POST",
    });

    expect(response.status).toBe(401);
    expect((await readError(response)).code).toBe("unauthorized");
    expect(server.listDataFiles()).toEqual(beforeFiles);
    expect(server.listBlobFiles()).toEqual([]);
    expect(countObjects(server)).toBe(beforeObjects);
  });

  test("PIN 1: an unauthenticated PUT is refused without creating a blob or a row", async () => {
    const server = createTestServer();
    const response = await server.put("/stores/master/objects/secret.txt", "do not store me");
    expect(response.status).toBe(401);
    expect(server.listBlobFiles()).toEqual([]);
    expect(countObjects(server)).toBe(0);
  });

  test("an unknown key is 401, and a malformed one is 401 too", async () => {
    const server = createTestServer();
    const unknown = await server.get("/stores/master/objects", "ssk_AAAAAAAAAAAA_" + "b".repeat(43));
    expect(unknown.status).toBe(401);
    expect((await readError(unknown)).code).toBe("unauthorized");

    const garbage = await server.get("/stores/master/objects", "not-a-key");
    expect(garbage.status).toBe(401);
  });

  test("x-api-key is accepted exactly like Authorization: Bearer", async () => {
    const server = createTestServer();
    const key = server.mint({ stores: ["*"], perms: ["admin"] });
    const response = await server.request("/stores", { headers: { "x-api-key": key } });
    expect(response.status).toBe(200);
  });

  test("a verified key gets last_used_at; a refused request does not touch it", async () => {
    const server = createTestServer();
    const key = server.mint({ stores: ["*"], perms: ["admin"] });
    const before = lastUsedAt(server);
    expect(before).toBeNull();

    await server.get("/healthz");
    expect(lastUsedAt(server)).toBeNull();

    await server.get("/stores", key);
    expect(lastUsedAt(server)).not.toBeNull();
  });
});

describe("auth: a scoped key cannot leave its store (pin 2)", () => {
  test("PIN 2: a key scoped to store A gets 403 on store B, and B's bytes are untouched", async () => {
    const server = createTestServer();
    const master = server.mint({ stores: ["*"], perms: ["admin"] });
    await server.postJson("/stores", { name: "alpha" }, master);
    await server.postJson("/stores", { name: "beta" }, master);
    const alphaKey = await mintScoped(server, master, "alpha", ["read", "write", "delete"]);
    const betaKey = await mintScoped(server, master, "beta", ["read", "write", "delete"]);

    const put = await server.put("/stores/beta/objects/private.txt", "beta bytes", betaKey);
    expect(put.status).toBe(201);
    const betaBefore = betaState(server);

    // Read across the scope.
    const read = await server.get("/stores/beta/objects/private.txt", alphaKey);
    expect(read.status).toBe(403);
    expect((await readError(read)).code).toBe("forbidden");

    // Write across the scope.
    const write = await server.put("/stores/beta/objects/planted.txt", "alpha was here", alphaKey);
    expect(write.status).toBe(403);
    expect((await readError(write)).code).toBe("forbidden");

    // List across the scope.
    const list = await server.get("/stores/beta/objects", alphaKey);
    expect(list.status).toBe(403);

    // Delete across the scope.
    const del = await server.del("/stores/beta/objects/private.txt", alphaKey);
    expect(del.status).toBe(403);

    // And the store is byte-for-byte what it was.
    expect(betaState(server)).toEqual(betaBefore);
    const after = await server.get("/stores/beta/objects/private.txt", betaKey);
    expect(after.status).toBe(200);
    expect(await after.text()).toBe("beta bytes");
  });

  test("a missing permission on the RIGHT store is 403, not 401", async () => {
    const server = createTestServer();
    const master = server.mint({ stores: ["*"], perms: ["admin"] });
    await server.postJson("/stores", { name: "alpha" }, master);
    const readOnly = await mintScoped(server, master, "alpha", ["read"]);

    const put = await server.put("/stores/alpha/objects/x.txt", "nope", readOnly);
    expect(put.status).toBe(403);
    expect((await readError(put)).code).toBe("forbidden");

    const del = await server.del("/stores/alpha/objects/x.txt", readOnly);
    expect(del.status).toBe(403);
  });

  test("a scoped key cannot mint a key for another store", async () => {
    const server = createTestServer();
    const master = server.mint({ stores: ["*"], perms: ["admin"] });
    await server.postJson("/stores", { name: "alpha" }, master);
    await server.postJson("/stores", { name: "beta" }, master);
    const alphaKey = await mintScoped(server, master, "alpha", ["read", "write"]);

    const cross = await server.postJson("/keys", { stores: ["beta"], perms: ["read"] }, alphaKey);
    expect(cross.status).toBe(403);

    const admin = await server.postJson("/keys", { stores: ["*"], perms: ["admin"] }, alphaKey);
    expect(admin.status).toBe(403);
  });

  test("listing stores requires a master admin key", async () => {
    const server = createTestServer();
    const master = server.mint({ stores: ["*"], perms: ["admin"] });
    await server.postJson("/stores", { name: "alpha" }, master);
    const scoped = await mintScoped(server, master, "alpha", ["read"]);
    expect((await server.get("/stores")).status).toBe(401);
    expect((await server.get("/stores", scoped)).status).toBe(403);
    expect((await server.get("/stores", master)).status).toBe(200);
  });

  test("a non-admin key cannot be minted with admin permission", async () => {
    const server = createTestServer();
    const master = server.mint({ stores: ["*"], perms: ["admin"] });
    const scoped = await mintScoped(server, master, "master", ["read"]);
    // `scoped` is scoped to the master STORE, not to every store, so it is not a master key.
    const response = await server.postJson("/keys", { stores: ["*"], perms: ["admin"] }, scoped);
    expect(response.status).toBe(403);
  });
});

describe("auth: revocation and expiry (pin 3)", () => {
  test("PIN 3: A REVOKED key is refused 401", async () => {
    const server = createTestServer();
    const key = server.mint({ stores: ["*"], perms: ["admin"], label: "doomed" });
    expect((await server.get("/stores", key)).status).toBe(200);

    const id = keyId(key);
    server.direct((db) =>
      db
        .prepare("UPDATE access_keys SET revoked_at = ? WHERE id = ?")
        .run("2026-01-02T00:00:00.000Z", id),
    );

    const response = await server.get("/stores", key);
    expect(response.status).toBe(401);
    expect((await readError(response)).code).toBe("unauthorized");
  });

  test("PIN 3: an expired key is refused 401, and is still valid one millisecond before", async () => {
    const server = createTestServer();
    const key = server.mint({
      stores: ["*"],
      perms: ["admin"],
      label: "short-lived",
      expiresAt: "2026-01-01T00:00:01.000Z",
    });

    server.clock.value = Date.UTC(2026, 0, 1, 0, 0, 0, 999);
    expect((await server.get("/stores", key)).status).toBe(200);

    server.clock.value = Date.UTC(2026, 0, 1, 0, 0, 1, 0);
    const response = await server.get("/stores", key);
    expect(response.status).toBe(401);
    expect((await readError(response)).code).toBe("unauthorized");
  });

  test("a revoked key cannot write, and writes nothing", async () => {
    const server = createTestServer();
    const key = server.mint({ stores: ["*"], perms: ["admin"] });
    server.direct((db) =>
      db.prepare("UPDATE access_keys SET revoked_at = ? WHERE id = ?").run("2026-01-02T00:00:00Z", keyId(key)),
    );
    const response = await server.put("/stores/master/objects/x.txt", "nope", key);
    expect(response.status).toBe(401);
    expect(server.listBlobFiles()).toEqual([]);
  });
});

describe("auth: every route needs a key, except /healthz (pin 7)", () => {
  const ROUTES = [
    ["GET", "/stores"],
    ["GET", "/stores/master/objects"],
    ["PUT", "/stores/master/objects/x.txt"],
    ["GET", "/stores/master/objects/x.txt"],
    ["DELETE", "/stores/master/objects/x.txt"],
  ] as const;

  test("PIN 7: GET /healthz needs no key and answers JSON", async () => {
    const server = createTestServer();
    const response = await server.get("/healthz");
    expect(response.status).toBe(200);
    expect((await response.json()) as unknown).toEqual({ ok: true });
  });

  test("PIN 7: every other route is 401 without a key", async () => {
    const server = createTestServer();
    for (const [method, path] of ROUTES) {
      const response = await server.request(path, { method });
      expect(response.status, `${method} ${path} must need a key`).toBe(401);
      expect((await readError(response)).code, `${method} ${path}`).toBe("unauthorized");
    }
  });

  test("PIN 7: an unauthenticated request writes nothing to the data root", async () => {
    const server = createTestServer();
    const before = server.listDataFiles();
    for (const [method, path] of ROUTES) {
      await server.request(path, { method, body: method === "PUT" ? "payload" : undefined });
    }
    expect(server.listDataFiles()).toEqual(before);
    expect(server.listBlobFiles()).toEqual([]);
  });
});

// --- small local helpers over the fixture ------------------------------------------

async function mintScoped(
  server: ReturnType<typeof createTestServer>,
  master: string,
  store: string,
  perms: readonly string[],
): Promise<string> {
  const response = await server.postJson(
    "/keys",
    { stores: [store], perms, label: `${store}-key` },
    master,
  );
  expect(response.status, await response.clone().text()).toBe(201);
  const body = (await response.json()) as { key: string };
  return body.key;
}

function countObjects(server: ReturnType<typeof createTestServer>): number {
  return server.direct(
    (db) => (db.prepare("SELECT COUNT(*) AS n FROM objects").get() as { n: number }).n,
  );
}

function lastUsedAt(server: ReturnType<typeof createTestServer>): string | null {
  const row = server.direct(
    (db) => db.prepare("SELECT last_used_at FROM access_keys LIMIT 1").get() as
      | { last_used_at: string | null }
      | undefined,
  );
  return row?.last_used_at ?? null;
}

/** The bytes AND metadata of every object in every store — the "untouched" witness. */
function betaState(server: ReturnType<typeof createTestServer>): unknown {
  const rows = server.direct((db) =>
    db
      .prepare("SELECT store, name, sha256, size, created_at FROM objects ORDER BY store, name")
      .all(),
  );
  return { rows, files: server.listBlobFiles(), dbBytes: server.readDbBytes().byteLength };
}
