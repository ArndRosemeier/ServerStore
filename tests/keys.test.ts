/**
 * PIN K1–K5 — the PERMISSION boundary of `POST /keys`.
 *
 * The store boundary (a scoped key may only mint within its own store) is pinned in
 * `tests/auth.test.ts` (PIN 2). This file pins the OTHER half of the same
 * authorization decision, in `src/server/app.ts`: **a key may pass on what it holds,
 * and no more** — the key IS the principal AND the limit (ledger rows 2, 6 and 36).
 *
 * Every test drives the real app through the ONE fixture (`tests/helpers/server.ts`).
 * A store is created through the real `POST /stores` with a master admin key, never
 * seeded, so the setup walks the same boundary as the thing under test.
 */

import { afterEach, describe, expect, test } from "vitest";
import { createTestServer, cleanupTestServers, readError } from "./helpers/server.ts";

afterEach(cleanupTestServers);

type Server = ReturnType<typeof createTestServer>;

describe("keys: a key may not mint a permission it does not hold (pin K1-K5)", () => {
  test("PIN K1: a READ-ONLY key cannot mint a permission it does not hold", async () => {
    const { server, master } = setup();
    const readOnly = await scopedKey(server, master, "alpha", ["read"]);
    const keysBefore = countKeys(server);

    const response = await server.postJson("/keys", { store: "alpha", perms: ["write"] }, readOnly);

    expect(response.status).toBe(403);
    const error = await readError(response);
    expect(error.code).toBe("forbidden");
    // The message must name the permission the minter lacks.
    expect(error.message).toContain("write");
    // And NOTHING was minted: no row, no side effect.
    expect(countKeys(server)).toBe(keysBefore);
  });

  test("PIN K2: a key lacking 'delete' cannot mint 'delete'", async () => {
    const { server, master } = setup();
    const readWrite = await scopedKey(server, master, "alpha", ["read", "write"]);
    const keysBefore = countKeys(server);

    const response = await server.postJson(
      "/keys",
      { store: "alpha", perms: ["read", "write", "delete"] },
      readWrite,
    );

    expect(response.status).toBe(403);
    const error = await readError(response);
    expect(error.code).toBe("forbidden");
    expect(error.message).toContain("delete");
    expect(countKeys(server)).toBe(keysBefore);
  });

  test("PIN K3: a key passes on exactly what it holds, and no more", async () => {
    const { server, master } = setup();
    const readWrite = await scopedKey(server, master, "alpha", ["read", "write"]);

    // The positive: the same permission SET is mintable, and the minted key is real.
    const minted = await server.postJson(
      "/keys",
      { store: "alpha", perms: ["read", "write"], label: "passed-on" },
      readWrite,
    );
    expect(minted.status, await minted.clone().text()).toBe(201);
    const child = (await minted.json()) as { key: string; perms: readonly string[] };
    expect(child.perms).toEqual(["read", "write"]);

    // A SUBSET is mintable too — the rule is subset, not equality.
    const subset = await server.postJson("/keys", { store: "alpha", perms: ["read"] }, readWrite);
    expect(subset.status, await subset.clone().text()).toBe(201);

    // The new key works for what it was granted...
    const put = await server.put("/stores/alpha/objects/room-1", "state", child.key);
    expect(put.status).toBe(201);

    // ...and is refused what it was NOT granted: the child did not inherit the
    // minter's key, it inherited the minter's LIMIT.
    const del = await server.del("/stores/alpha/objects/room-1", child.key);
    expect(del.status).toBe(403);
    expect((await readError(del)).code).toBe("forbidden");
  });

  test("PIN K4: the boundaries that already held still hold", async () => {
    const { server, master } = setup();
    const alpha = await scopedKey(server, master, "alpha", ["read", "write"]);
    await scopedKey(server, master, "beta", ["read", "write"]);

    // Another store: a scoped key can never mint outside its own store.
    const crossStore = await server.postJson("/keys", { store: "beta", perms: ["read"] }, alpha);
    expect(crossStore.status).toBe(403);
    expect((await readError(crossStore)).code).toBe("forbidden");

    // `admin` without a master admin key: refused even when scoped to `*`.
    const admin = await server.postJson("/keys", { store: "*", perms: ["admin"] }, alpha);
    expect(admin.status).toBe(403);
    expect((await readError(admin)).code).toBe("forbidden");

    // A master admin key with the WRONG scope still may not hand out `admin`: an
    // admin grant must be `*`, and a store-scoped one is refused.
    const scopedAdmin = await server.postJson("/keys", { store: "alpha", perms: ["admin"] }, master);
    expect(scopedAdmin.status).toBe(403);
    expect((await readError(scopedAdmin)).code).toBe("forbidden");
  });

  test("PIN K5: a master admin key still mints any non-admin permission for any existing store", async () => {
    const { server, master } = setup();
    await scopedKey(server, master, "alpha", ["read"]);

    // The owner's bootstrap path: `admin` implies every permission, so the full
    // non-admin set is mintable for a store the caller holds no row in itself.
    const response = await server.postJson(
      "/keys",
      { store: "alpha", perms: ["read", "write", "delete"], label: "bootstrap" },
      master,
    );
    expect(response.status, await response.clone().text()).toBe(201);
    const body = (await response.json()) as { key: string; perms: readonly string[] };
    expect(body.perms).toEqual(["read", "write", "delete"]);

    // The minted key really carries the whole set — including `delete`, which the
    // read-only `alpha` key above could not have passed on.
    const put = await server.put("/stores/alpha/objects/room-1", "state", body.key);
    expect(put.status).toBe(201);
    const del = await server.del("/stores/alpha/objects/room-1", body.key);
    expect(del.status).toBe(204);
  });
});

// --- helpers over the ONE fixture --------------------------------------------------

/** A fresh server plus the single master admin key every test in this file mints. */
function setup(): { server: Server; master: string } {
  const server = createTestServer();
  return { server, master: server.mint({ store: "*", perms: ["admin"] }) };
}

/** Create the store over HTTP (loud on failure) and mint a key scoped to it. */
async function scopedKey(
  server: Server,
  master: string,
  store: string,
  perms: readonly ("read" | "write" | "delete" | "admin")[],
): Promise<string> {
  const created = await server.postJson("/stores", { name: store }, master);
  expect(created.status, await created.clone().text()).toBe(201);
  const response = await server.postJson("/keys", { store, perms }, master);
  expect(response.status, await response.clone().text()).toBe(201);
  return ((await response.json()) as { key: string }).key;
}

/** Every key row, including the fixtures — the "nothing was minted" witness. */
function countKeys(server: Server): number {
  return server.direct(
    (db) => (db.prepare("SELECT COUNT(*) AS n FROM access_keys").get() as { n: number }).n,
  );
}
