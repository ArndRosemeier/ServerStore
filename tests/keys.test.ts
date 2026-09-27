/**
 * PIN M1–M5 — WHO MAY MINT on `POST /keys` — AND PIN G1–G6 — the key's SCOPE.
 *
 * Slice 6 (ledger row 36) bounded minting by the minter's OWN permissions — the subset
 * rule, "a key may pass on only what it holds". Slice 7 replaces that with the stricter
 * rule the owner chose (ledger row 39): **only a key holding `admin` may mint at all.**
 * The subset check is consequently UNREACHABLE through the route — `admin` implies every
 * permission — and was DELETED rather than kept as an untested branch.
 *
 * Slice 8 (ledger rows 30, 41, 42) gives a key a SCOPE: a SET of stores, stored as
 * `access_keys.scope_all` plus one `key_stores` row per store, resolved ONCE with the key
 * and tested in ONE place (`Auth.authorize`). `["*"]` is the master case. G1–G6 pin that
 * seam from both sides, including the MIGRATION of a row written in the OLD single-store
 * shape (G6) — the arm that proves the migration is real rather than asserted.
 *
 * Every test drives the real app through the ONE fixture (`tests/helpers/server.ts`). A
 * store is created through the real `POST /stores` with a master admin key, never seeded,
 * so the setup walks the same boundary as the thing under test.
 */

import { afterEach, describe, expect, test } from "vitest";
import { createTestServer, cleanupTestServers, keyId, readError } from "./helpers/server.ts";

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
    const subset = await server.postJson(
      "/keys",
      { stores: ["alpha"], perms: ["read"] },
      readOnly,
    );
    expect(subset.status).toBe(403);
    const subsetError = await readError(subset);
    expect(subsetError.code).toBe("forbidden");
    // The message must say WHO may mint, not which permission is missing.
    expect(subsetError.message).toContain("only an admin key may mint");

    // And exactly what the minter holds is refused too: it is not about subset at all.
    const equal = await server.postJson(
      "/keys",
      { stores: ["alpha"], perms: ["read", "write"] },
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
    const storeAdmin = server.mint({ stores: ["alpha"], perms: ["admin"], label: "game-backend" });

    // A child WITHIN the minter's own set: `read`...
    const readChild = await server.postJson("/keys", { stores: ["alpha"], perms: ["read"] }, storeAdmin);
    expect(readChild.status).toBe(201);
    const readKey = ((await readChild.json()) as { key: string }).key;

    // ...and `read`+`write`, with a label.
    const rwChild = await server.postJson(
      "/keys",
      { stores: ["alpha"], perms: ["read", "write"], label: "player" },
      storeAdmin,
    );
    expect(rwChild.status).toBe(201);
    const rwBody = (await rwChild.json()) as {
      key: string;
      perms: readonly string[];
      stores: readonly string[];
    };
    expect(rwBody.perms).toEqual(["read", "write"]);
    expect(rwBody.stores).toEqual(["alpha"]);

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
    const storeAdmin = server.mint({ stores: ["alpha"], perms: ["admin"] });
    const keysBefore = countKeys(server);

    const cross = await server.postJson(
      "/keys",
      { stores: ["beta"], perms: ["read"] },
      storeAdmin,
    );
    expect(cross.status).toBe(403);
    expect((await readError(cross)).code).toBe("forbidden");

    // Neither may it escape to `*`: a scoped key is scoped for MINTING too.
    const wildcard = await server.postJson("/keys", { stores: ["*"], perms: ["read"] }, storeAdmin);
    expect(wildcard.status).toBe(403);

    expect(countKeys(server)).toBe(keysBefore);
  });

  test("PIN M4: only a MASTER admin key may grant 'admin', and only for scope ['*']", async () => {
    const { server, master } = setup();
    await store(server, master, "alpha");
    const storeAdmin = server.mint({ stores: ["alpha"], perms: ["admin"] });

    // The positive direction: a master admin key grants `admin` for `["*"]`, and the
    // child really is a master admin.
    const granted = await server.postJson(
      "/keys",
      { stores: ["*"], perms: ["admin"], label: "second-master" },
      master,
    );
    expect(granted.status).toBe(201);
    const secondMaster = ((await granted.json()) as { key: string }).key;
    expect((await server.get("/stores", secondMaster)).status).toBe(200);

    // Direction 1: a store-scoped ADMIN key may not grant `admin`, even for `["*"]`.
    const scopedGrant = await server.postJson(
      "/keys",
      { stores: ["*"], perms: ["admin"] },
      storeAdmin,
    );
    expect(scopedGrant.status).toBe(403);
    expect((await readError(scopedGrant)).code).toBe("forbidden");

    // Direction 2: even the MASTER admin key may not grant `admin` for a named store —
    // an admin grant is `["*"]` or it is refused.
    const storeScopedAdminGrant = await server.postJson(
      "/keys",
      { stores: ["alpha"], perms: ["admin"] },
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
      { stores: ["alpha"], perms: ["read", "write", "delete"], label: "bootstrap" },
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

describe("keys: a key is scoped to a SET of stores (pin G1-G6)", () => {
  test("PIN G1: a key scoped to [a,b] reads and writes a and b, and is refused c", async () => {
    const { server, master } = setup();
    for (const name of ["a", "b", "c"]) await store(server, master, name);
    // c holds bytes BEFORE the cross-scope attempts, so "untouched" is measurable.
    const seed = await server.put("/stores/c/objects/secret.txt", "c bytes", master);
    expect(seed.status, await seed.clone().text()).toBe(201);
    const cBefore = storeState(server, "c");

    const scoped = await mintStores(server, master, ["a", "b"], ["read", "write", "delete"]);
    // The mint response states the SET, canonically.
    const wm = (await (await server.get("/whoami", scoped)).json()) as { stores: readonly string[] };
    expect(wm.stores).toEqual(["a", "b"]);

    // It reads AND writes BOTH stores in its set.
    expect((await server.put("/stores/a/objects/x.txt", "in a", scoped)).status).toBe(201);
    expect((await server.put("/stores/b/objects/x.txt", "in b", scoped)).status).toBe(201);
    expect(await (await server.get("/stores/a/objects/x.txt", scoped)).text()).toBe("in a");
    expect(await (await server.get("/stores/b/objects/x.txt", scoped)).text()).toBe("in b");
    expect((await server.get("/stores/a/objects", scoped)).status).toBe(200);
    expect((await server.get("/stores/b/objects", scoped)).status).toBe(200);

    // READ across the scope: 403, and the message names the key's ACTUAL scope.
    const read = await server.get("/stores/c/objects/secret.txt", scoped);
    expect(read.status).toBe(403);
    const readError_ = await readError(read);
    expect(readError_.code).toBe("forbidden");
    expect(readError_.message).toContain('"a"');
    expect(readError_.message).toContain('"b"');
    expect(readError_.message).toContain('"c"');

    // WRITE, LIST and DELETE across the scope are refused too.
    expect((await server.put("/stores/c/objects/planted.txt", "should not land", scoped)).status).toBe(403);
    expect((await server.get("/stores/c/objects", scoped)).status).toBe(403);
    expect((await server.del("/stores/c/objects/secret.txt", scoped)).status).toBe(403);

    // ...and c is byte-for-byte what it was.
    expect(storeState(server, "c")).toEqual(cBefore);
    const after = await server.get("/stores/c/objects/secret.txt", master);
    expect(after.status).toBe(200);
    expect(await after.text()).toBe("c bytes");
  });

  test("PIN G2: a scoped ADMIN key mints only inside its own set", async () => {
    const { server, master } = setup();
    for (const name of ["a", "b", "c"]) await store(server, master, name);
    const scopedAdmin = server.mint({ stores: ["a", "b"], perms: ["admin"], label: "game-backend" });

    // 201 INSIDE the set — a single store, and the whole set.
    const one = await server.postJson("/keys", { stores: ["a"], perms: ["read"] }, scopedAdmin);
    expect(one.status, await one.clone().text()).toBe(201);
    expect(((await one.json()) as { stores: readonly string[] }).stores).toEqual(["a"]);
    const both = await server.postJson(
      "/keys",
      { stores: ["b", "a"], perms: ["read", "write"] },
      scopedAdmin,
    );
    expect(both.status, await both.clone().text()).toBe(201);
    // The stored scope is canonical (sorted), whatever order was requested.
    expect(((await both.json()) as { stores: readonly string[] }).stores).toEqual(["a", "b"]);

    const keysBefore = countKeys(server);
    const scopesBefore = countKeyStores(server);

    // 403 OUTSIDE the set — and the message names both the minter's set and the store.
    const outside = await server.postJson(
      "/keys",
      { stores: ["c"], perms: ["read"] },
      scopedAdmin,
    );
    expect(outside.status).toBe(403);
    const outsideError = await readError(outside);
    expect(outsideError.code).toBe("forbidden");
    expect(outsideError.message).toContain('"a"');
    expect(outsideError.message).toContain('"b"');
    expect(outsideError.message).toContain('"c"');

    // A PARTIALLY outside list is refused whole — no key with a truncated scope.
    const partial = await server.postJson(
      "/keys",
      { stores: ["a", "c"], perms: ["read"] },
      scopedAdmin,
    );
    expect(partial.status).toBe(403);

    // Nor may a scoped admin escape to the master scope.
    expect(
      (await server.postJson("/keys", { stores: ["*"], perms: ["read"] }, scopedAdmin)).status,
    ).toBe(403);

    // NOTHING was minted on any refusal: no key row, no scope row.
    expect(countKeys(server)).toBe(keysBefore);
    expect(countKeyStores(server)).toBe(scopesBefore);
  });

  test("PIN G3: POST /keys rejects an empty list, a mixed ['*', a] list, and a store that does not exist", async () => {
    const { server, master } = setup();
    await store(server, master, "alpha");
    const keysBefore = countKeys(server);
    const scopesBefore = countKeyStores(server);

    // An EMPTY set can do nothing; it is refused by name, not defaulted to anything.
    const empty = await server.postJson("/keys", { stores: [], perms: ["read"] }, master);
    expect(empty.status).toBe(400);
    const emptyError = await readError(empty);
    expect(emptyError.code).toBe("invalid_scope");
    expect(emptyError.message).toContain("non-empty");

    // A MIXED set ("every store" AND a name) has no meaning that is not "every store".
    const mixed = await server.postJson(
      "/keys",
      { stores: ["*", "alpha"], perms: ["read"] },
      master,
    );
    expect(mixed.status).toBe(400);
    const mixedError = await readError(mixed);
    expect(mixedError.code).toBe("invalid_scope");
    expect(mixedError.message).toContain("combine");

    // A store that does not exist is a 404, exactly like every other unknown store.
    const ghost = await server.postJson("/keys", { stores: ["ghost"], perms: ["read"] }, master);
    expect(ghost.status).toBe(404);
    expect((await readError(ghost)).code).toBe("not_found");

    // The OLD single-store field is named, never silently ignored or defaulted.
    const legacy = await server.postJson("/keys", { store: "alpha", perms: ["read"] }, master);
    expect(legacy.status).toBe(400);
    expect((await readError(legacy)).code).toBe("bad_request");

    // NOTHING was minted by any of them.
    expect(countKeys(server)).toBe(keysBefore);
    expect(countKeyStores(server)).toBe(scopesBefore);
  });

  test("PIN G4: GET /whoami returns the caller's id, label, stores and perms, and no secret", async () => {
    const { server, master } = setup();
    await store(server, master, "a");
    await store(server, master, "b");
    const scoped = await mintStores(server, master, ["b", "a"], ["read", "write"], "player-1");

    const response = await server.get("/whoami", scoped);
    expect(response.status, await response.clone().text()).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.id).toBe(keyId(scoped));
    expect(body.label).toBe("player-1");
    expect(body.stores).toEqual(["a", "b"]);
    expect(body.perms).toEqual(["read", "write"]);
    expect(body.expiresAt).toBeNull();
    expect(typeof body.lastUsedAt).toBe("string");

    // NO SECRET: the body carries EXACTLY the documented fields (so a hash, a prefix or
    // the raw key cannot have been added silently), and the raw key is not in it.
    expect(Object.keys(body).sort()).toEqual([
      "expiresAt",
      "id",
      "label",
      "lastUsedAt",
      "perms",
      "stores",
    ]);
    expect(JSON.stringify(body)).not.toContain(scoped);

    // A master key renders its scope as ["*"], which is what a client branches on.
    const masterBody = (await (await server.get("/whoami", master)).json()) as {
      stores: readonly string[];
    };
    expect(masterBody.stores).toEqual(["*"]);

    // And without a key there is no identity to report.
    expect((await server.get("/whoami")).status).toBe(401);
    expect((await readError(await server.get("/whoami"))).code).toBe("unauthorized");
  });

  test("PIN G5: a master key (['*']) still spans every store, and only a master may grant 'admin'", async () => {
    // `setup()` mints the master key BEFORE any store exists: the scope must therefore
    // be "every store", not a snapshot of the stores that happened to exist at mint time.
    const { server, master } = setup();
    await store(server, master, "later-alpha");
    await store(server, master, "later-beta");

    expect((await server.put("/stores/later-alpha/objects/x.txt", "a", master)).status).toBe(201);
    expect((await server.put("/stores/later-beta/objects/x.txt", "b", master)).status).toBe(201);
    expect(await (await server.get("/stores/later-beta/objects/x.txt", master)).text()).toBe("b");
    const wm = (await (await server.get("/whoami", master)).json()) as { stores: readonly string[] };
    expect(wm.stores).toEqual(["*"]);

    // ONLY A MASTER MAY GRANT `admin`, both directions.
    // Positive: a master grants another master for ["*"], and the child administers stores.
    const granted = await server.postJson(
      "/keys",
      { stores: ["*"], perms: ["admin"] },
      master,
    );
    expect(granted.status).toBe(201);
    const secondMaster = ((await granted.json()) as { key: string }).key;
    expect((await server.postJson("/stores", { name: "third" }, secondMaster)).status).toBe(201);

    // Negative 1: a store-scoped admin key may not grant `admin`.
    const storeAdmin = server.mint({ stores: ["later-alpha"], perms: ["admin"] });
    expect(
      (await server.postJson("/keys", { stores: ["*"], perms: ["admin"] }, storeAdmin)).status,
    ).toBe(403);

    // Negative 2: not even the master may grant `admin` for a single named store.
    const named = await server.postJson(
      "/keys",
      { stores: ["later-alpha"], perms: ["admin"] },
      master,
    );
    expect(named.status).toBe(403);
    expect((await readError(named)).code).toBe("forbidden");
  });

  test("PIN G6: a key row written in the OLD single-store shape still works after the migration", async () => {
    // The fixture writes the PRE-slice-8 SHAPE before the app ever opens the file: one
    // nullable `access_keys.store`, no `key_stores` table (tests/helpers/server.ts).
    const server = createTestServer({
      legacyStores: ["alpha", "beta"],
      legacyKeys: [
        { store: "alpha", label: "legacy-scoped", perms: ["read", "write"] },
        { store: "*", label: "legacy-master", perms: ["admin"] },
      ],
    });
    const [legacyScoped, legacyMaster] = server.legacyKeys as [string, string];

    // The migration is STRUCTURAL, not just behavioural: the old column is GONE, the
    // master flag is set, and the named store became exactly one key_stores row.
    const columns = server.direct(
      (db) =>
        (db.prepare("PRAGMA table_info(access_keys)").all() as unknown as { name: string }[]).map(
          (column) => column.name,
        ),
    );
    expect(columns).toContain("scope_all");
    expect(columns).not.toContain("store");
    expect(
      server.direct((db) => db.prepare("SELECT scope_all FROM access_keys WHERE id = ?").get(keyId(legacyMaster))),
    ).toEqual({ scope_all: 1 });
    expect(
      server.direct((db) =>
        db.prepare("SELECT store FROM key_stores WHERE key_id = ? ORDER BY store").all(keyId(legacyScoped)),
      ),
    ).toEqual([{ store: "alpha" }]);

    // ...and BEHAVIOURALLY the legacy key authorizes exactly what it did before: alpha
    // yes, beta no, and it never became a master key.
    expect((await server.put("/stores/alpha/objects/x.txt", "legacy", legacyScoped)).status).toBe(201);
    expect(await (await server.get("/stores/alpha/objects/x.txt", legacyScoped)).text()).toBe("legacy");
    expect((await server.get("/stores/alpha/objects", legacyScoped)).status).toBe(200);
    expect((await server.get("/stores/beta/objects", legacyScoped)).status).toBe(403);
    expect((await server.get("/stores", legacyScoped)).status).toBe(403);
    const wm = (await (await server.get("/whoami", legacyScoped)).json()) as {
      stores: readonly string[];
      label: string;
    };
    expect(wm.stores).toEqual(["alpha"]);
    expect(wm.label).toBe("legacy-scoped");

    // The legacy `*` row became the master case: every store, including beta.
    expect((await server.get("/stores", legacyMaster)).status).toBe(200);
    expect((await server.get("/stores/beta/objects", legacyMaster)).status).toBe(200);
    expect(
      ((await (await server.get("/whoami", legacyMaster)).json()) as { stores: readonly string[] }).stores,
    ).toEqual(["*"]);
  });
});

// --- helpers over the ONE fixture --------------------------------------------------

/** A fresh server plus the single master admin key every test in this file mints. */
function setup(): { server: Server; master: string } {
  const server = createTestServer();
  return { server, master: server.mint({ stores: ["*"], perms: ["admin"] }) };
}

/** Create the store over HTTP (loud on failure). */
async function store(server: Server, master: string, name: string): Promise<void> {
  const created = await server.postJson("/stores", { name }, master);
  expect(created.status, await created.clone().text()).toBe(201);
}

/** Mint a NON-admin key scoped to ONE existing store (the store row must already exist). */
async function mintScoped(
  server: Server,
  master: string,
  storeName: string,
  perms: readonly Perm[],
): Promise<string> {
  return mintStores(server, master, [storeName], perms);
}

/** Mint a key for a SET of stores through the real route (loud on failure). */
async function mintStores(
  server: Server,
  master: string,
  stores: readonly string[],
  perms: readonly Perm[],
  label?: string,
): Promise<string> {
  const response = await server.postJson(
    "/keys",
    label === undefined ? { stores, perms } : { stores, perms, label },
    master,
  );
  expect(response.status, await response.clone().text()).toBe(201);
  return ((await response.json()) as { key: string }).key;
}

/** Every key row, including the fixtures — the "nothing was minted" witness. */
function countKeys(server: Server): number {
  return server.direct(
    (db) => (db.prepare("SELECT COUNT(*) AS n FROM access_keys").get() as { n: number }).n,
  );
}

/** Every scope row — a mint that failed must leave none behind either. */
function countKeyStores(server: Server): number {
  return server.direct(
    (db) => (db.prepare("SELECT COUNT(*) AS n FROM key_stores").get() as { n: number }).n,
  );
}

/** One store's objects AND its bytes on disk — the "untouched" witness. */
function storeState(server: Server, storeName: string): unknown {
  const rows = server.direct((db) =>
    db
      .prepare("SELECT store, name, sha256, size, created_at FROM objects WHERE store = ? ORDER BY name")
      .all(storeName),
  );
  return {
    rows,
    blobs: server.listBlobFiles().filter((file) => file.startsWith(`${storeName}/`)),
  };
}
