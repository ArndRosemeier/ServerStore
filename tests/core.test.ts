/**
 * PIN 6 — many stores from day one, and the master store survives a restart.
 *
 * "Second boot" here is a second `createApp` over the SAME data root and database,
 * which is exactly what a process restart does.
 */

import { afterEach, describe, expect, test } from "vitest";
import { createTestServer, cleanupTestServers, readError } from "./helpers/server.ts";

afterEach(cleanupTestServers);

describe("the store registry (ledger rows 5 and 10)", () => {
  test("PIN 6: the master store exists after first boot, and a second boot does not duplicate it", async () => {
    const first = createTestServer();
    const master = first.mint({ store: "*", perms: ["admin"] });

    const before = await first.get("/stores", master);
    expect(before.status).toBe(200);
    const listedBefore = (await before.json()) as { stores: { name: string; kind: string }[] };
    expect(listedBefore.stores.map((store) => store.name)).toEqual(["master"]);
    expect(listedBefore.stores[0]?.kind).toBe("bytes");

    const second = first.reboot();
    const after = await second.get("/stores", master);
    const listedAfter = (await after.json()) as { stores: { name: string; kind: string }[] };
    expect(listedAfter.stores.map((store) => store.name)).toEqual(["master"]);

    const rows = second.direct(
      (db) => db.prepare("SELECT name FROM stores WHERE name = 'master'").all() as unknown[],
    );
    expect(rows).toHaveLength(1);

    // ...and a THIRD boot, because "idempotent" is not "idempotent twice".
    const third = second.reboot();
    expect(
      third.direct(
        (db) => (db.prepare("SELECT COUNT(*) AS n FROM stores").get() as { n: number }).n,
      ),
    ).toBe(1);
  });

  test("PIN 6: the master store can hold objects on first boot without any store being created", async () => {
    const server = createTestServer();
    const key = server.mint({ store: "*", perms: ["admin"] });
    const put = await server.put("/stores/master/objects/seed.txt", "works", key);
    expect(put.status).toBe(201);
  });

  test("many stores coexist from day one and do not see each other's objects", async () => {
    const server = createTestServer();
    const master = server.mint({ store: "*", perms: ["admin"] });
    for (const name of ["alpha", "beta", "gamma"]) {
      const created = await server.postJson("/stores", { name }, master);
      expect(created.status, await created.clone().text()).toBe(201);
    }
    const listed = (await (await server.get("/stores", master)).json()) as {
      stores: { name: string }[];
    };
    expect(listed.stores.map((store) => store.name)).toEqual([
      "alpha",
      "beta",
      "gamma",
      "master",
    ]);

    const alphaKey = await server.postJson(
      "/keys",
      { store: "alpha", perms: ["read", "write"] },
      master,
    );
    expect(alphaKey.status, await alphaKey.clone().text()).toBe(201);
    const { key } = (await alphaKey.json()) as { key: string };
    const put = await server.put("/stores/alpha/objects/only-alpha.txt", "alpha", key);
    expect(put.status, await put.clone().text()).toBe(201);
    expect((await server.get("/stores/alpha/objects", key)).status).toBe(200);
    // beta has no such object, and the alpha key cannot even look at beta.
    expect((await server.get("/stores/beta/objects/only-alpha.txt", key)).status).toBe(403);
  });

  test("creating a store that exists is a 409, not a silent no-op", async () => {
    const server = createTestServer();
    const master = server.mint({ store: "*", perms: ["admin"] });
    expect((await server.postJson("/stores", { name: "dup" }, master)).status).toBe(201);
    const again = await server.postJson("/stores", { name: "dup" }, master);
    expect(again.status).toBe(409);
    expect((await readError(again)).code).toBe("store_exists");
  });

  test("only a master admin key may create a store", async () => {
    const server = createTestServer();
    const master = server.mint({ store: "*", perms: ["admin"] });
    await server.postJson("/stores", { name: "alpha" }, master);
    const scoped = await server.postJson("/keys", { store: "alpha", perms: ["admin"] }, master);
    expect(scoped.status).toBe(403); // a store-scoped admin grant is not modelled

    // A scoped read/write key may not reach POST /stores either.
    const scopedRw = await server.postJson("/keys", { store: "alpha", perms: ["read", "write"] }, master);
    const { key } = (await scopedRw.json()) as { key: string };
    const attempt = await server.postJson("/stores", { name: "beta" }, key);
    expect(attempt.status).toBe(403);
    expect((await readError(attempt)).code).toBe("forbidden");
    expect(
      server.direct(
        (db) => (db.prepare("SELECT COUNT(*) AS n FROM stores WHERE name = 'beta'").get() as { n: number }).n,
      ),
    ).toBe(0);
  });

  test("a store row whose kind no handler implements fails loudly, never defaults to bytes", async () => {
    const server = createTestServer();
    const master = server.mint({ store: "*", perms: ["admin"] });
    // Bypass the route on purpose: simulate a row a future schema wrote.
    server.direct((db) => {
      db.exec("INSERT INTO store_kinds(kind) VALUES ('future')");
      db.prepare("INSERT INTO stores (name, kind, created_at) VALUES (?, ?, ?)").run(
        "future-store",
        "future",
        "1970-01-01T00:00:00.000Z",
      );
    });
    const response = await server.get("/stores/future-store/objects", master);
    expect(response.status).toBeGreaterThanOrEqual(500);
    expect((await readError(response)).code).toBe("unsupported_store_kind");
  });
});
