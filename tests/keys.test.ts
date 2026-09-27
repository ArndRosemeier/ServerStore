/**
 * PIN M1–M5 — WHO MAY MINT on `POST /keys` — PIN G1–G6 — the key's SCOPE — and
 * PIN L1–L6 — the key LIFECYCLE (listing + revocation).
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
 * Slice 9 (ledger row 46) makes the lifecycle self-service: `GET /keys` (admin-only,
 * scope-filtered, never key material) and `POST /keys/:id/revoke` (admin-only,
 * idempotent, self-revocation deliberately allowed). Both reuse the ONE containment
 * predicate the mint boundary already uses, `Auth.holdsStores`, and L1–L6 pin them.
 *
 * Slice 11 (ledger rows 51, 52) adds the SECOND GRANTING DOOR: `PATCH /keys/:id` rewrites
 * what a key HOLDS (`label`, `stores`, `perms`) in place, reuses the SAME parsers and the
 * SAME `requireAdmin`/`holdsStores` boundary as minting, and stamps `updated_at` +
 * `updated_by`. E1–E7 pin it — including the two facts that give edit-in-place its
 * meaning: the key's VALUE never changes (E6) and a revoked key cannot be brought back
 * (E3).
 *
 * Every test drives the real app through the ONE fixture (`tests/helpers/server.ts`). A
 * store is created through the real `POST /stores` with a master admin key, never seeded,
 * so the setup walks the same boundary as the thing under test.
 */

import { afterEach, describe, expect, test } from "vitest";
import {
  createTestServer,
  cleanupTestServers,
  keyId,
  readError,
  sha256Hex,
} from "./helpers/server.ts";

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

/**
 * PIN L1–L6 — the key LIFECYCLE: `GET /keys` (list) and `POST /keys/:id/revoke`.
 *
 * Slice 9 (ledger row 46) makes the key lifecycle self-service so a stray key no longer
 * needs an operator opening the database (row 45). Both routes are admin-only and reuse
 * the SAME scope predicate the mint route already enforces (`Auth.holdsStores`): a master
 * sees and revokes anything, a store-scoped admin only keys whose scope lies inside its
 * own set and never a key holding `admin`. Self-revocation is ALLOWED deliberately (it is
 * the caller's own credential) and takes effect on the next request. Revocation is
 * idempotent and reports whether it changed.
 */
describe("keys: the key LIFECYCLE (pin L1-L6)", () => {
  test("PIN L1: GET /keys is admin-only and returns NO key material", async () => {
    const { server, master } = setup();
    await store(server, master, "alpha");
    const scoped = await mintScoped(server, master, "alpha", ["read"]);
    const overHttp = await mintStores(server, master, ["alpha"], ["read"], "player-1");
    // A key minted directly (the operator CLI path) is in the inventory too.
    const direct = server.mint({ stores: ["alpha"], perms: ["read"], label: "direct" });
    const raws = [master, scoped, overHttp, direct];

    // 401 without a key.
    const anonymous = await server.get("/keys");
    expect(anonymous.status).toBe(401);
    expect((await readError(anonymous)).code).toBe("unauthorized");

    // 403 for a VERIFIED non-admin key: the key is real, the permission is not there.
    const refused = await server.get("/keys", scoped);
    expect(refused.status).toBe(403);
    expect((await readError(refused)).code).toBe("forbidden");

    // 200 for the admin, and the body is an INVENTORY, not a credential dump.
    const listed = await server.get("/keys", master);
    expect(listed.status, await listed.clone().text()).toBe(200);
    const body = (await listed.json()) as { keys: Record<string, unknown>[] };
    const text = JSON.stringify(body);

    // The pin is not vacuous: every minted key is listed, by its PUBLIC id.
    expect(body.keys.map((entry) => entry.id).sort()).toEqual(raws.map(keyId).sort());

    // NO SECRET: neither the raw key, nor its secret half, nor its stored hash is in
    // the body. `prefix` is allowed through on purpose (it is `ssk_` + the first 8
    // chars of the public id, never a secret byte — ledger row 46), so this checks the
    // full key, the half after the id, and the hash.
    for (const raw of raws) {
      expect(text).not.toContain(raw);
      expect(text).not.toContain(secretOf(raw));
      expect(text).not.toContain(sha256Hex(raw));
    }

    // The entry shape is EXACTLY the documented one, so a hash or a secret field cannot
    // be added silently (the same structural move as PIN G4). Slice 11 (ledger row 52)
    // ADDS the two audit fields `updatedAt`/`updatedBy` — the only change to this list,
    // and it is deliberate: a never-edited key reports both as `null`.
    for (const entry of body.keys) {
      expect(Object.keys(entry).sort()).toEqual([
        "createdAt",
        "expiresAt",
        "id",
        "label",
        "lastUsedAt",
        "perms",
        "prefix",
        "revokedAt",
        "stores",
        "updatedAt",
        "updatedBy",
      ]);
    }
  });

  test("PIN L2: a scoped admin lists only the keys inside its own stores — and a master lists all", async () => {
    const { server, master } = setup();
    for (const name of ["a", "b", "c"]) await store(server, master, name);
    const adminAB = server.mint({ stores: ["a", "b"], perms: ["admin"], label: "game-backend" });
    const keyA = await mintStores(server, master, ["a"], ["read"], "in-a");
    const keyAB = await mintStores(server, master, ["a", "b"], ["read", "write"], "in-ab");
    const keyC = await mintStores(server, master, ["c"], ["read"], "in-c");
    const otherMaster = await mintStores(server, master, ["*"], ["admin"], "second-master");

    const listed = (await (await server.get("/keys", adminAB)).json()) as {
      keys: { id: string; stores: readonly string[] }[];
    };
    const ids = listed.keys.map((entry) => entry.id).sort();
    // Its OWN key lies inside its scope, so it lists itself: the inventory is "keys I
    // could have minted", and a scoped admin could have minted a copy of itself.
    expect(ids).toEqual([adminAB, keyA, keyAB].map(keyId).sort());
    expect(ids).not.toContain(keyId(keyC));
    expect(ids).not.toContain(keyId(otherMaster));
    expect(ids).not.toContain(keyId(master));

    // A master sees EVERY key, including the ones the scoped admin cannot.
    const all = (await (await server.get("/keys", master)).json()) as { keys: { id: string }[] };
    expect(all.keys.map((entry) => entry.id).sort()).toEqual(
      [adminAB, keyA, keyAB, keyC, otherMaster, master].map(keyId).sort(),
    );
  });

  test("PIN L3: a revoked key is refused on the NEXT request — 401, with no restart", async () => {
    const { server, master } = setup();
    await store(server, master, "alpha");
    const doomed = await mintScoped(server, master, "alpha", ["read", "write"]);

    // It works before the revocation...
    expect((await server.put("/stores/alpha/objects/x.txt", "before", doomed)).status).toBe(201);
    expect((await server.get("/whoami", doomed)).status).toBe(200);

    // ...it is revoked...
    const revoke = await server.postJson(`/keys/${keyId(doomed)}/revoke`, {}, master);
    expect(revoke.status, await revoke.clone().text()).toBe(200);
    const body = (await revoke.json()) as { id: string; revokedAt: string; changed: boolean };
    expect(body.id).toBe(keyId(doomed));
    expect(body.changed).toBe(true);
    expect(typeof body.revokedAt).toBe("string");

    // ...and the VERY NEXT request with it is 401 on the SAME running app — no restart,
    // no cache to invalidate (resolution reads the row per request).
    const whoami = await server.get("/whoami", doomed);
    expect(whoami.status).toBe(401);
    expect((await readError(whoami)).code).toBe("unauthorized");
    expect((await server.get("/stores/alpha/objects/x.txt", doomed)).status).toBe(401);

    // The revoking master is untouched.
    expect((await server.get("/keys", master)).status).toBe(200);
  });

  test("PIN L4: a scoped admin cannot revoke outside its own scope, and cannot revoke a master key", async () => {
    const { server, master } = setup();
    for (const name of ["a", "b", "c"]) await store(server, master, name);
    const adminAB = server.mint({ stores: ["a", "b"], perms: ["admin"], label: "game-backend" });
    const keyC = await mintStores(server, master, ["c"], ["read"], "in-c");
    const adminA = server.mint({ stores: ["a"], perms: ["admin"], label: "in-a-admin" });
    const secondMaster = await mintStores(server, master, ["*"], ["admin"], "second-master");

    // POSITIVE control first, so the refusals below are not just "everything is 403": a
    // non-admin key INSIDE its scope can be revoked.
    const inside = await mintStores(server, master, ["b"], ["read"], "in-b");
    const ok = await server.postJson(`/keys/${keyId(inside)}/revoke`, {}, adminAB);
    expect(ok.status, await ok.clone().text()).toBe(200);
    expect(((await ok.json()) as { changed: boolean }).changed).toBe(true);
    expect((await server.get("/whoami", inside)).status).toBe(401);

    // OUTSIDE its scope: 403, and the target is STILL USABLE afterwards.
    const outside = await server.postJson(`/keys/${keyId(keyC)}/revoke`, {}, adminAB);
    expect(outside.status).toBe(403);
    expect((await readError(outside)).code).toBe("forbidden");
    expect((await server.get("/stores/c/objects", keyC)).status).toBe(200);

    // A MASTER key: 403 (`["*"]` is never inside a scoped set), and the master still
    // administers stores afterwards.
    const masterTarget = await server.postJson(
      `/keys/${keyId(secondMaster)}/revoke`,
      {},
      adminAB,
    );
    expect(masterTarget.status).toBe(403);
    expect((await readError(masterTarget)).code).toBe("forbidden");
    expect((await server.get("/stores", secondMaster)).status).toBe(200);

    // An ADMIN key INSIDE its scope: still 403, because the rule is "only keys it could
    // have minted" and a scoped admin can never mint `admin` — and the target lives on.
    const inScopeAdmin = await server.postJson(`/keys/${keyId(adminA)}/revoke`, {}, adminAB);
    expect(inScopeAdmin.status).toBe(403);
    expect((await readError(inScopeAdmin)).code).toBe("forbidden");
    expect((await server.get("/stores/a/objects", adminA)).status).toBe(200);

    // The original master, which could revoke anything, is untouched by all of it.
    expect((await server.get("/stores", master)).status).toBe(200);
  });

  test("PIN L5: revoke is idempotent — the second call says changed: false and the timestamp does not move", async () => {
    const { server, master } = setup();
    await store(server, master, "alpha");
    const doomed = await mintScoped(server, master, "alpha", ["read"]);

    const first = await server.postJson(`/keys/${keyId(doomed)}/revoke`, {}, master);
    expect(first.status, await first.clone().text()).toBe(200);
    const firstBody = (await first.json()) as { id: string; revokedAt: string; changed: boolean };
    expect(firstBody).toEqual({
      id: keyId(doomed),
      revokedAt: expect.any(String),
      changed: true,
    });

    // ADVANCE THE CLOCK before the second call: with the fixture's frozen clock a buggy
    // overwrite would write the same instant and "the timestamp did not move" would be
    // vacuous. This makes the claim real.
    server.clock.value += 60_000;

    const second = await server.postJson(`/keys/${keyId(doomed)}/revoke`, {}, master);
    expect(second.status, await second.clone().text()).toBe(200);
    const secondBody = (await second.json()) as { id: string; revokedAt: string; changed: boolean };
    expect(secondBody).toEqual({
      id: keyId(doomed),
      revokedAt: firstBody.revokedAt,
      changed: false,
    });

    // The ROW really holds the FIRST timestamp, not the advanced clock's.
    expect(
      server.direct((db) =>
        db.prepare("SELECT revoked_at FROM access_keys WHERE id = ?").get(keyId(doomed)),
      ),
    ).toEqual({ revoked_at: firstBody.revokedAt });
    // And it is still revoked, of course.
    expect((await server.get("/whoami", doomed)).status).toBe(401);
  });

  test("PIN L6: an unknown key id is 404, and a key may revoke ITSELF (recorded deliberately)", async () => {
    const { server, master } = setup();
    await store(server, master, "a");

    // An UNKNOWN id is a 404 — the route stays admin-only, so the master asks.
    const unknown = await server.postJson("/keys/aaaaaaaaaaaa/revoke", {}, master);
    expect(unknown.status).toBe(404);
    expect((await readError(unknown)).code).toBe("not_found");

    // A NON-admin does not get to learn even that much: the admin check comes first.
    const scoped = await mintScoped(server, master, "a", ["read"]);
    expect((await server.postJson("/keys/aaaaaaaaaaaa/revoke", {}, scoped)).status).toBe(403);

    // SELF-REVOCATION, recorded deliberately: a store-scoped ADMIN key holds `admin`,
    // which the rule above says a scoped admin may not revoke — but it is the caller's
    // OWN credential, so it is allowed, and it lands on the NEXT request.
    const selfAdmin = server.mint({ stores: ["a"], perms: ["admin"], label: "self" });
    expect((await server.get("/whoami", selfAdmin)).status).toBe(200);
    const self = await server.postJson(`/keys/${keyId(selfAdmin)}/revoke`, {}, selfAdmin);
    expect(self.status, await self.clone().text()).toBe(200);
    const selfBody = (await self.json()) as { id: string; revokedAt: string; changed: boolean };
    expect(selfBody.id).toBe(keyId(selfAdmin));
    expect(selfBody.changed).toBe(true);
    expect(typeof selfBody.revokedAt).toBe("string");
    expect((await server.get("/whoami", selfAdmin)).status).toBe(401);

    // A master may do the same to itself, which leaves the store administrable only by
    // another admin key — the documented cost of self-revocation, not a surprise.
    const secondMaster = await mintStores(server, master, ["*"], ["admin"], "second-master");
    const masterSelf = await server.postJson(
      `/keys/${keyId(secondMaster)}/revoke`,
      {},
      secondMaster,
    );
    expect(masterSelf.status, await masterSelf.clone().text()).toBe(200);
    expect(((await masterSelf.json()) as { changed: boolean }).changed).toBe(true);
    expect((await server.get("/stores", secondMaster)).status).toBe(401);
  });
});

/**
 * PIN E1–E7 — EDITING a key in place (`PATCH /keys/:id`).
 *
 * Slice 11 (ledger rows 51, 52): editing is a SECOND WAY TO GRANT PERMISSIONS, so it
 * must reuse the SAME boundary minting uses — `Auth.requireAdmin` for WHO may grant and
 * `Auth.holdsStores` for the store boundary — and must never become a second
 * authorization path. The two facts that make "edit in place" mean anything are pinned
 * directly: the key's VALUE is unchanged by an edit (E6), and a REVOKED key cannot be
 * edited back to life (E3).
 */
describe("keys: EDITING a key in place (pin E1-E7)", () => {
  test("PIN E1: an edit changes exactly the fields given, and nothing else", async () => {
    const { server, master } = setup();
    for (const name of ["a", "b"]) await store(server, master, name);
    const target = await mintStores(server, master, ["a"], ["read", "write"], "before");
    const id = keyId(target);
    const valueBefore = storedValue(server, id);

    // A brand-new key has NEVER been changed, and the listing says so with NULLs.
    const initial = await keyEntryById(server, master, id);
    expect(initial.updatedAt).toBeNull();
    expect(initial.updatedBy).toBeNull();

    // RENAME only: stores and perms are untouched.
    const named = await server.patchJson(`/keys/${id}`, { label: "after" }, master);
    expect(named.status, await named.clone().text()).toBe(200);
    const afterName = (await named.json()) as KeyEntry;
    expect(afterName.label).toBe("after");
    expect(afterName.stores).toEqual(["a"]);
    expect(afterName.perms).toEqual(["read", "write"]);

    // PERMS only: the label and the stores are untouched.
    const permsOnly = await server.patchJson(`/keys/${id}`, { perms: ["read"] }, master);
    expect(permsOnly.status, await permsOnly.clone().text()).toBe(200);
    const afterPerms = (await permsOnly.json()) as KeyEntry;
    expect(afterPerms.label).toBe("after");
    expect(afterPerms.stores).toEqual(["a"]);
    expect(afterPerms.perms).toEqual(["read"]);

    // STORES only: the label and the perms are untouched, and the scope is REPLACED
    // (not merged with the old set).
    const storesOnly = await server.patchJson(`/keys/${id}`, { stores: ["b"] }, master);
    expect(storesOnly.status, await storesOnly.clone().text()).toBe(200);
    const afterStores = (await storesOnly.json()) as KeyEntry;
    expect(afterStores.label).toBe("after");
    expect(afterStores.perms).toEqual(["read"]);
    expect(afterStores.stores).toEqual(["b"]);

    // The key's VALUE never moved through any of the three edits...
    expect(storedValue(server, id)).toEqual(valueBefore);
    // ...the scope rows are the new SET, with no leftover from the old one...
    expect(
      server.direct((db) =>
        db.prepare("SELECT store FROM key_stores WHERE key_id = ? ORDER BY store").all(id),
      ),
    ).toEqual([{ store: "b" }]);
    // ...and the grant really changed: `b` is now readable, `a` is out of scope and
    // `read` does not write. (The SAME raw key is used for all three: E6's subject.)
    expect((await server.get("/stores/b/objects", target)).status).toBe(200);
    expect((await server.put("/stores/b/objects/x.txt", "no", target)).status).toBe(403);
    expect((await server.get("/stores/a/objects", target)).status).toBe(403);
  });

  test("PIN E2: an editor may grant only what it could have minted", async () => {
    const { server, master } = setup();
    for (const name of ["a", "b", "c"]) await store(server, master, name);
    // The game-backend key: a store-scoped admin, minted out of band exactly as the
    // operator CLI would (the route refuses a store-scoped admin GRANT, pin M4).
    const scopedAdmin = server.mint({ stores: ["a", "b"], perms: ["admin"], label: "backend" });
    const target = await mintStores(server, master, ["a"], ["read"], "player");
    const outside = await mintStores(server, master, ["c"], ["read"], "in-c");
    const peer = server.mint({ stores: ["a"], perms: ["admin"], label: "peer-admin" });

    // POSITIVE first, so the refusals below are not "everything is 403": a grant the
    // scoped admin COULD have minted — inside its own set, no `admin` — is accepted.
    const ok = await server.patchJson(
      `/keys/${keyId(target)}`,
      { stores: ["a", "b"], perms: ["read", "write"] },
      scopedAdmin,
    );
    expect(ok.status, await ok.clone().text()).toBe(200);
    expect(((await ok.json()) as KeyEntry).stores).toEqual(["a", "b"]);

    const before = storedKey(server, keyId(target));
    const keysBefore = countKeys(server);
    const scopesBefore = countKeyStores(server);

    // WIDEN into a store it does not hold: 403.
    const widen = await server.patchJson(
      `/keys/${keyId(target)}`,
      { stores: ["a", "b", "c"] },
      scopedAdmin,
    );
    expect(widen.status).toBe(403);
    expect((await readError(widen)).code).toBe("forbidden");

    // ESCAPE to the master scope: 403 (`["*"]` is never inside a scoped set).
    expect(
      (await server.patchJson(`/keys/${keyId(target)}`, { stores: ["*"] }, scopedAdmin)).status,
    ).toBe(403);

    // GRANT `admin`: 403 — a scoped admin can never mint one, so it can never edit one on.
    const grant = await server.patchJson(
      `/keys/${keyId(target)}`,
      { perms: ["read", "admin"] },
      scopedAdmin,
    );
    expect(grant.status).toBe(403);
    expect((await readError(grant)).code).toBe("forbidden");

    // A key OUTSIDE its set: 403, even for a rename.
    const outsideEdit = await server.patchJson(
      `/keys/${keyId(outside)}`,
      { label: "stolen" },
      scopedAdmin,
    );
    expect(outsideEdit.status).toBe(403);
    expect((await readError(outsideEdit)).code).toBe("forbidden");

    // A PEER ADMIN key inside its set: 403 for a rename AND for a DEMOTION — it is not
    // a key the caller could have minted. (Judgement call recorded in docs/TESTING.md:
    // the brief's E2 names the widen/grant cases; the same "could have minted" rule
    // covers the target, so a scoped admin cannot strip a peer's admin either.)
    const peerRename = await server.patchJson(`/keys/${keyId(peer)}`, { label: "x" }, scopedAdmin);
    expect(peerRename.status).toBe(403);
    const peerDemote = await server.patchJson(
      `/keys/${keyId(peer)}`,
      { perms: ["read"] },
      scopedAdmin,
    );
    expect(peerDemote.status).toBe(403);

    // Every refusal left the target EXACTLY as it was, and minted no key or scope row.
    expect(storedKey(server, keyId(target))).toEqual(before);
    expect(countKeys(server)).toBe(keysBefore);
    expect(countKeyStores(server)).toBe(scopesBefore);
    // The peer still administers, so the refusals did not quietly change it.
    expect((await server.get("/stores/a/objects", peer)).status).toBe(200);

    // The MASTER's half of the same rule (row 39, reached through this new door):
    // granting `admin` needs `["*"]`...
    const badGrant = await server.patchJson(
      `/keys/${keyId(target)}`,
      { perms: ["read", "admin"] },
      master,
    );
    expect(badGrant.status).toBe(403);
    expect((await readError(badGrant)).code).toBe("forbidden");
    // ...and with `["*"]` it lands, and the edited key really is a master admin.
    const goodGrant = await server.patchJson(
      `/keys/${keyId(target)}`,
      { stores: ["*"], perms: ["read", "admin"] },
      master,
    );
    expect(goodGrant.status, await goodGrant.clone().text()).toBe(200);
    expect((await server.get("/stores", target)).status).toBe(200);
  });

  test("PIN E3: a REVOKED key cannot be edited back to life", async () => {
    const { server, master } = setup();
    await store(server, master, "a");
    const doomed = await mintStores(server, master, ["a"], ["read", "write"], "doomed");
    const id = keyId(doomed);
    const revoked = await server.postJson(`/keys/${id}/revoke`, {}, master);
    expect(revoked.status, await revoked.clone().text()).toBe(200);
    const revokedAt = ((await revoked.json()) as { revokedAt: string }).revokedAt;
    const before = storedKey(server, id);

    // EVERY kind of edit is refused, including a rename — the check is on the target,
    // not on which field was sent.
    for (const body of [
      { label: "alive again" },
      { perms: ["read"] },
      { stores: ["a"] },
      { label: "x", stores: ["a"], perms: ["read", "write", "delete", "admin"] },
    ]) {
      const refused = await server.patchJson(`/keys/${id}`, body, master);
      expect(refused.status, JSON.stringify(body)).toBe(403);
      const error = await readError(refused);
      expect(error.code).toBe("forbidden");
      expect(error.message).toContain("revoked");
    }

    // `revoked_at` did not move, and nothing else in the row did either.
    expect(
      server.direct((db) =>
        db.prepare("SELECT revoked_at FROM access_keys WHERE id = ?").get(id),
      ),
    ).toEqual({ revoked_at: revokedAt });
    expect(storedKey(server, id)).toEqual(before);
    // ...and the key is still dead on its next request: revocation was not undone.
    expect((await server.get("/whoami", doomed)).status).toBe(401);
  });

  test("PIN E4: an edit is stamped and visible", async () => {
    const { server, master } = setup();
    await store(server, master, "a");
    // A DISTINCT editor key, so `updatedBy` cannot accidentally be the target's id or
    // the master's.
    const editor = server.mint({ stores: ["*"], perms: ["admin"], label: "editor" });
    const target = await mintStores(server, master, ["a"], ["read"], "player");
    const id = keyId(target);

    // NEVER EDITED: both fields are NULL in the listing — never a date invented from
    // `createdAt`.
    const initial = await keyEntryById(server, master, id);
    expect(initial.updatedAt).toBeNull();
    expect(initial.updatedBy).toBeNull();
    expect(initial.createdAt).toBe("2026-01-01T00:00:00.000Z");

    // The fixture's clock is frozen, so it is ADVANCED here: a stamp that ignored the
    // clock would then be visibly wrong rather than coincidentally right (L5's lesson).
    server.clock.value += 60_000;
    const firstAt = new Date(server.clock.value).toISOString();

    const first = await server.patchJson(`/keys/${id}`, { label: "renamed" }, editor);
    expect(first.status, await first.clone().text()).toBe(200);
    const firstBody = (await first.json()) as KeyEntry;
    expect(firstBody.updatedAt).toBe(firstAt);
    expect(firstBody.updatedBy).toBe(keyId(editor));
    expect(firstBody.updatedBy).not.toBe(id);
    expect(firstBody.updatedBy).not.toBe(keyId(master));

    // The SAME two values appear in `GET /keys`.
    const listed = await keyEntryById(server, master, id);
    expect(listed.updatedAt).toBe(firstAt);
    expect(listed.updatedBy).toBe(keyId(editor));

    // A SECOND edit MOVES the stamp.
    server.clock.value += 60_000;
    const secondAt = new Date(server.clock.value).toISOString();
    const second = await server.patchJson(`/keys/${id}`, { perms: ["read", "write"] }, editor);
    expect(second.status, await second.clone().text()).toBe(200);
    const secondBody = (await second.json()) as KeyEntry;
    expect(secondBody.updatedAt).toBe(secondAt);
    expect(secondBody.updatedAt).not.toBe(firstAt);
    expect(secondBody.updatedBy).toBe(keyId(editor));

    // The ROW really holds the stamp, and the stamp is the editor's PUBLIC id, not key
    // material: the response carries no raw key.
    expect(
      server.direct((db) =>
        db.prepare("SELECT updated_at, updated_by FROM access_keys WHERE id = ?").get(id),
      ),
    ).toEqual({ updated_at: secondAt, updated_by: keyId(editor) });
    expect(JSON.stringify(secondBody)).not.toContain(editor);
    expect(JSON.stringify(secondBody)).not.toContain(sha256Hex(editor));
  });

  test("PIN E5: a non-admin key cannot edit anything", async () => {
    const { server, master } = setup();
    await store(server, master, "a");
    const readOnly = await mintScoped(server, master, "a", ["read"]);
    const target = await mintStores(server, master, ["a"], ["read"], "player");
    const before = storedKey(server, keyId(target));
    const keysBefore = countKeys(server);

    // 401 without a key: the guard, before the route.
    const anonymous = await server.patchJson(`/keys/${keyId(target)}`, { label: "x" });
    expect(anonymous.status).toBe(401);
    expect((await readError(anonymous)).code).toBe("unauthorized");

    // 403 for a VERIFIED non-admin key, whatever field it sends — and the message says
    // WHO may edit, exactly as the mint route's refusal does.
    for (const body of [{ label: "x" }, { perms: ["read"] }, { stores: ["a"] }]) {
      const refused = await server.patchJson(`/keys/${keyId(target)}`, body, readOnly);
      expect(refused.status, JSON.stringify(body)).toBe(403);
      const error = await readError(refused);
      expect(error.code).toBe("forbidden");
      expect(error.message).toContain("only an admin key may edit keys");
    }
    // Not even its OWN row: the check is on the caller, not on the target.
    expect(
      (await server.patchJson(`/keys/${keyId(readOnly)}`, { label: "me" }, readOnly)).status,
    ).toBe(403);

    // Nothing changed anywhere, and no key or scope row appeared.
    expect(storedKey(server, keyId(target))).toEqual(before);
    expect(countKeys(server)).toBe(keysBefore);
  });

  test("PIN E6: an edit does NOT change the key's value", async () => {
    const { server, master } = setup();
    for (const name of ["a", "b"]) await store(server, master, name);
    const target = await mintStores(server, master, ["a"], ["read"], "player");
    const id = keyId(target);
    const valueBefore = storedValue(server, id);

    const edited = await server.patchJson(
      `/keys/${id}`,
      { label: "renamed", stores: ["b"], perms: ["read", "write", "delete"] },
      master,
    );
    expect(edited.status, await edited.clone().text()).toBe(200);

    // THE SAME RAW KEY still authenticates, and reports the NEW grant — so the change
    // really landed on the credential its holder already has (the owner's "no need to
    // show them again", ledger row 51).
    const whoami = await server.get("/whoami", target);
    expect(whoami.status, await whoami.clone().text()).toBe(200);
    const identity = (await whoami.json()) as {
      id: string;
      label: string;
      stores: readonly string[];
      perms: readonly string[];
    };
    expect(identity.id).toBe(id);
    expect(identity.label).toBe("renamed");
    expect(identity.stores).toEqual(["b"]);
    expect(identity.perms).toEqual(["read", "write", "delete"]);

    // It really exercises the new grant: writes and deletes in `b`, refused in `a`.
    expect((await server.put("/stores/b/objects/x.txt", "state", target)).status).toBe(201);
    expect((await server.del("/stores/b/objects/x.txt", target)).status).toBe(204);
    expect((await server.get("/stores/a/objects", target)).status).toBe(403);

    // Byte-identical value fields: id, key_hash, prefix, created_at.
    expect(storedValue(server, id)).toEqual(valueBefore);

    // No key material in the edit response either: a re-mint would have had to put a
    // new raw key somewhere, and the OLD one is never in a response.
    const response = await server.patchJson(`/keys/${id}`, { label: "renamed-2" }, master);
    expect(response.status, await response.clone().text()).toBe(200);
    const text = JSON.stringify(await response.json());
    expect(text).not.toContain(target);
    expect(text).not.toContain(secretOf(target));
    expect(text).not.toContain(sha256Hex(target));
  });

  test("PIN E7: a body with no recognised field is refused and nothing changes", async () => {
    const { server, master } = setup();
    await store(server, master, "a");
    const target = await mintStores(server, master, ["a"], ["read", "write"], "player");
    const id = keyId(target);
    const before = storedKey(server, id);

    // An EMPTY object asks for nothing.
    const empty = await server.patchJson(`/keys/${id}`, {}, master);
    expect(empty.status).toBe(400);
    expect((await readError(empty)).code).toBe("bad_request");

    // The OLD single-store field is refused BY NAME, never silently scored as a scope.
    const legacy = await server.patchJson(`/keys/${id}`, { store: "a" }, master);
    expect(legacy.status).toBe(400);
    expect((await readError(legacy)).code).toBe("bad_request");

    // One UNKNOWN field beside a KNOWN one refuses the WHOLE request: `label` must not
    // be applied while `bogus` is dropped.
    const mixed = await server.patchJson(`/keys/${id}`, { label: "applied?", bogus: 1 }, master);
    expect(mixed.status).toBe(400);
    expect((await readError(mixed)).code).toBe("bad_request");

    // A body that is present but not an object, and no body at all.
    const notObject = await server.patchJson(`/keys/${id}`, [1, 2], master);
    expect(notObject.status).toBe(400);
    expect((await readError(notObject)).code).toBe("invalid_body");
    const noBody = await server.patchJson(`/keys/${id}`, undefined, master);
    expect(noBody.status).toBe(400);
    expect((await readError(noBody)).code).toBe("invalid_body");

    // Validation IDENTICAL to mint, on the fields that ARE recognised.
    expect((await server.patchJson(`/keys/${id}`, { stores: [] }, master)).status).toBe(400);
    expect((await server.patchJson(`/keys/${id}`, { stores: ["*", "a"] }, master)).status).toBe(400);
    expect((await server.patchJson(`/keys/${id}`, { perms: [] }, master)).status).toBe(400);
    expect((await server.patchJson(`/keys/${id}`, { perms: ["root"] }, master)).status).toBe(400);
    expect((await server.patchJson(`/keys/${id}`, { stores: ["ghost"] }, master)).status).toBe(404);

    // NOTHING changed: the whole stored state of the key, and its scope rows, are what
    // they were. (An `admin`-grant refusal is E2's; this pin is about the BODY.)
    expect(storedKey(server, id)).toEqual(before);
    expect(
      server.direct((db) =>
        db.prepare("SELECT store FROM key_stores WHERE key_id = ? ORDER BY store").all(id),
      ),
    ).toEqual([{ store: "a" }]);
    // The key is still exactly what it was, behaviourally: it writes `a`.
    expect((await server.put("/stores/a/objects/x.txt", "still", target)).status).toBe(201);
  });

  test("PIN E8: a database that predates the audit columns is migrated add-if-absent", async () => {
    // The brief names E1-E7; E8 is added because the audit columns are a SCHEMA CHANGE
    // on a LIVE database, and "the migration is real rather than asserted" is this
    // project's rule for exactly that (B1's G6). The live store's shape is post-B1 and
    // pre-C2 — `scope_all` present, no audit columns — so that is the shape built here:
    // the columns are DROPPED from a real database, and the next boot must add them
    // back. A pin that only read the `CREATE TABLE` would prove nothing for the file
    // the service actually runs on.
    const server = createTestServer();
    const target = server.mint({ stores: ["*"], perms: ["admin"], label: "pre-c2" });
    const id = keyId(target);

    const columns = (s: Server): string[] =>
      s.direct((db) =>
        (db.prepare("PRAGMA table_info(access_keys)").all() as unknown as { name: string }[]).map(
          (column) => column.name,
        ),
      );

    server.direct((db) => {
      db.exec("ALTER TABLE access_keys DROP COLUMN updated_at");
      db.exec("ALTER TABLE access_keys DROP COLUMN updated_by");
    });
    expect(columns(server)).not.toContain("updated_at");
    expect(columns(server)).not.toContain("updated_by");

    // The SECOND boot is the one that migrates.
    const rebooted = server.reboot();
    expect(columns(rebooted)).toContain("updated_at");
    expect(columns(rebooted)).toContain("updated_by");
    // ...and it is IDEMPOTENT: a third boot changes nothing.
    const third = rebooted.reboot();
    expect(columns(third)).toEqual(columns(rebooted));

    // The migrated columns are USABLE through the real route: the pre-C2 key is still
    // "never changed", and an edit now stamps it.
    expect(
      third.direct((db) =>
        db.prepare("SELECT updated_at, updated_by FROM access_keys WHERE id = ?").get(id),
      ),
    ).toEqual({ updated_at: null, updated_by: null });
    third.clock.value += 60_000;
    const edited = await third.patchJson(`/keys/${id}`, { label: "post-c2" }, target);
    expect(edited.status, await edited.clone().text()).toBe(200);
    expect(
      third.direct((db) =>
        db.prepare("SELECT updated_at, updated_by FROM access_keys WHERE id = ?").get(id),
      ),
    ).toEqual({ updated_at: new Date(third.clock.value).toISOString(), updated_by: id });
  });
});

/** The public entry `GET /keys` lists — the shape a client reads. */
interface KeyEntry {
  readonly id: string;
  readonly label: string;
  readonly stores: readonly string[];
  readonly prefix: string;
  readonly perms: readonly string[];
  readonly createdAt: string;
  readonly expiresAt: string | null;
  readonly lastUsedAt: string | null;
  readonly revokedAt: string | null;
  readonly updatedAt: string | null;
  readonly updatedBy: string | null;
}

/** One key's entry from `GET /keys` (loud when the id is not listed). */
async function keyEntryById(server: Server, master: string, id: string): Promise<KeyEntry> {
  const response = await server.get("/keys", master);
  expect(response.status, await response.clone().text()).toBe(200);
  const body = (await response.json()) as { keys: KeyEntry[] };
  const entry = body.keys.find((key) => key.id === id);
  if (entry === undefined) throw new Error(`key ${id} is not in the inventory`);
  return entry;
}

/**
 * The key's VALUE — the fields an edit must never move (pin E6).
 *
 * Deliberately NOT the whole row: `last_used_at` moves on every authenticated request,
 * so including it would make an "untouched" comparison meaningless rather than strict.
 */
function storedValue(server: Server, id: string): unknown {
  return server.direct((db) =>
    db
      .prepare("SELECT id, key_hash, prefix, created_at FROM access_keys WHERE id = ?")
      .get(id),
  );
}

/**
 * A key's ENTIRE persisted state — the "nothing changed" witness for the refusals
 * (pins E2, E3, E5, E7). As in {@link storedValue}, `last_used_at` is excluded because
 * every authenticated request writes it; everything an edit COULD write is included.
 */
function storedKey(server: Server, id: string): unknown {
  const row = server.direct((db) =>
    db
      .prepare(
        "SELECT scope_all, label, key_hash, prefix, perms, subject_kind, created_at, " +
          "expires_at, revoked_at, updated_at, updated_by FROM access_keys WHERE id = ?",
      )
      .get(id),
  );
  const stores = server.direct((db) =>
    db.prepare("SELECT store FROM key_stores WHERE key_id = ? ORDER BY store").all(id),
  );
  return { row, stores };
}

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

/**
 * The SECRET half of a raw key — everything after the 12-character public id.
 *
 * A lifecycle response may carry the id and the display prefix (which is `ssk_` + 8 id
 * chars) but never this: pin L1 asserts it is absent from the listing body.
 */
function secretOf(raw: string): string {
  // `ssk_<id12>_<secret>`; the id length is the parser's, not a hand-rolled split
  // (base64url's alphabet contains `_` — SEAM-INDEX gotcha 4).
  return raw.slice(4 + keyId(raw).length + 1);
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
