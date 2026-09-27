/**
 * PIN M1–M5 — WHO MAY MINT on `POST /keys`.
 *
 * Slice 6 (ledger row 36) bounded minting by the minter's OWN permissions — the subset
 * rule, "a key may pass on only what it holds". Slice 7 replaces that with the stricter
 * rule the owner chose (ledger row 39): **only a key holding `admin` may mint at all.**
 * The subset check is consequently UNREACHABLE through the route — `admin` implies every
 * permission — and was DELETED rather than kept as an untested branch.
 *
 * What still holds, and is pinned here: a store-scoped admin key mints WITHIN its store
 * (the game-backend flow, M2) but not for another (M3); an `admin` grant still requires a
 * MASTER admin key AND scope `*` (M4); and a master admin key still mints any non-admin
 * permission for any existing store (M5, the bootstrap path).
 *
 * Every test drives the real app through the ONE fixture (`tests/helpers/server.ts`). A
 * store is created through the real `POST /stores` with a master admin key, never seeded,
 * so the setup walks the same boundary as the thing under test.
 */

import { afterEach, describe, expect, test } from "vitest";
import { createTestServer, cleanupTestServers, readError } from "./helpers/server.ts";

afterEach(cleanupTestServers);

type Server = ReturnType<typeof createTestServer>;
type Perm = "read" | "write" | "delete" | "admin";

describe("keys: only an admin key may mint (pin M1-M5)", () => {
  test("PIN M1: a non-admin key cannot mint ANY key, not even one with a subset of its own permissions", async () => {
    const { server, master } = setup();
    await store(server, master, "alpha");
    const readOnly = await mintScoped(server, master, "alpha", ["read"]);
    const readWrite = await mintScoped(server, master, "alpha", ["read", "write"]);
    const keysBefore = countKeys(server);

    // A legal SUBSET of the minter's own permissions — slice 6's K3 positive, which is
    // exactly what the owner's stricter rule now refuses. (The MINT response body is
    // deliberately NOT used as the assertion message: it carries the raw key, and a key
    // belongs only in the mint response and the auth header — ledger row 21.)
    const subset = await server.postJson("/keys", { store: "alpha", perms: ["read"] }, readOnly);
    expect(subset.status).toBe(403);
    const subsetError = await readError(subset);
    expect(subsetError.code).toBe("forbidden");
    // The message must say WHO may mint, not which permission is missing.
    expect(subsetError.message).toContain("only an admin key may mint");

    // And exactly what the minter holds is refused too: it is not about subset at all.
    const equal = await server.postJson(
      "/keys",
      { store: "alpha", perms: ["read", "write"] },
      readWrite,
    );
    expect(equal.status).toBe(403);
    expect((await readError(equal)).code).toBe("forbidden");

    // NOTHING was minted: no row, no side effect.
    expect(countKeys(server)).toBe(keysBefore);
  });

  test("PIN M2: a store-scoped ADMIN key mints within its store", async () => {
    const { server, master } = setup();
    await store(server, master, "alpha");
    // The game-backend key: a store-scoped admin key. It is minted out of band by the
    // operator (`pnpm run admin:key --store alpha --perms admin`) — the route
    // deliberately refuses a store-scoped admin GRANT (PIN M4) — so the fixture mints it
    // directly, exactly as that CLI would.
    const storeAdmin = server.mint({ store: "alpha", perms: ["admin"], label: "game-backend" });

    // `read`, with the store OMITTED so the caller's own scope is used...
    const readChild = await server.postJson("/keys", { perms: ["read"] }, storeAdmin);
    expect(readChild.status).toBe(201);
    const readKey = ((await readChild.json()) as { key: string }).key;

    // ...and `read`+`write`, naming the store.
    const rwChild = await server.postJson(
      "/keys",
      { store: "alpha", perms: ["read", "write"], label: "player" },
      storeAdmin,
    );
    expect(rwChild.status).toBe(201);
    const rwBody = (await rwChild.json()) as { key: string; perms: readonly string[] };
    expect(rwBody.perms).toEqual(["read", "write"]);

    // The children are real: the read key reads, the read+write key writes.
    const put = await server.put("/stores/alpha/objects/room-1", "state", rwBody.key);
    expect(put.status, await put.clone().text()).toBe(201);
    expect((await server.get("/stores/alpha/objects/room-1", readKey)).status).toBe(200);

    // And the child is refused the DELETE it was not granted — it inherited the limit,
    // not the minter's own key.
    const del = await server.del("/stores/alpha/objects/room-1", rwBody.key);
    expect(del.status).toBe(403);
    expect((await readError(del)).code).toBe("forbidden");
  });

  test("PIN M3: a store-scoped admin key still cannot mint for another store", async () => {
    const { server, master } = setup();
    await store(server, master, "alpha");
    await store(server, master, "beta");
    const storeAdmin = server.mint({ store: "alpha", perms: ["admin"] });
    const keysBefore = countKeys(server);

    const cross = await server.postJson("/keys", { store: "beta", perms: ["read"] }, storeAdmin);
    expect(cross.status).toBe(403);
    expect((await readError(cross)).code).toBe("forbidden");

    // Neither may it escape to `*`: a store-scoped key is scoped for MINTING too.
    const wildcard = await server.postJson("/keys", { store: "*", perms: ["read"] }, storeAdmin);
    expect(wildcard.status).toBe(403);

    expect(countKeys(server)).toBe(keysBefore);
  });

  test("PIN M4: only a MASTER admin key may grant 'admin', and only for scope '*'", async () => {
    const { server, master } = setup();
    await store(server, master, "alpha");
    const storeAdmin = server.mint({ store: "alpha", perms: ["admin"] });

    // The positive direction: a master admin key grants `admin` for `*`, and the child
    // really is a master admin.
    const granted = await server.postJson(
      "/keys",
      { store: "*", perms: ["admin"], label: "second-master" },
      master,
    );
    expect(granted.status).toBe(201);
    const secondMaster = ((await granted.json()) as { key: string }).key;
    expect((await server.get("/stores", secondMaster)).status).toBe(200);

    // Direction 1: a store-scoped ADMIN key may not grant `admin`, even for `*`.
    const scopedGrant = await server.postJson("/keys", { store: "*", perms: ["admin"] }, storeAdmin);
    expect(scopedGrant.status).toBe(403);
    expect((await readError(scopedGrant)).code).toBe("forbidden");

    // Direction 2: even the MASTER admin key may not grant `admin` for a named store —
    // an admin grant is `*` or it is refused.
    const storeScopedAdminGrant = await server.postJson(
      "/keys",
      { store: "alpha", perms: ["admin"] },
      master,
    );
    expect(storeScopedAdminGrant.status).toBe(403);
    expect((await readError(storeScopedAdminGrant)).code).toBe("forbidden");
  });

  test("PIN M5: a master admin key still mints any non-admin permission for any existing store", async () => {
    const { server, master } = setup();
    await store(server, master, "alpha");

    // The owner's bootstrap path — the positive control for the whole slice.
    const response = await server.postJson(
      "/keys",
      { store: "alpha", perms: ["read", "write", "delete"], label: "bootstrap" },
      master,
    );
    expect(response.status, await response.clone().text()).toBe(201);
    const body = (await response.json()) as { key: string; perms: readonly string[] };
    expect(body.perms).toEqual(["read", "write", "delete"]);

    // The minted key really carries the whole set — including `delete`.
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

/** Create the store over HTTP (loud on failure). */
async function store(server: Server, master: string, name: string): Promise<void> {
  const created = await server.postJson("/stores", { name }, master);
  expect(created.status, await created.clone().text()).toBe(201);
}

/** Mint a NON-admin key scoped to an EXISTING store (the store row must already exist). */
async function mintScoped(
  server: Server,
  master: string,
  storeName: string,
  perms: readonly Perm[],
): Promise<string> {
  const response = await server.postJson("/keys", { store: storeName, perms }, master);
  expect(response.status).toBe(201);
  return ((await response.json()) as { key: string }).key;
}

/** Every key row, including the fixtures — the "nothing was minted" witness. */
function countKeys(server: Server): number {
  return server.direct(
    (db) => (db.prepare("SELECT COUNT(*) AS n FROM access_keys").get() as { n: number }).n,
  );
}
