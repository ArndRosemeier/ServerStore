/**
 * PIN X1–X9 — the DESTRUCTIVE LIFECYCLE (slice 16, ledger row 70).
 *
 * Three new routes plus byte reclamation, all driven through the real app on the ONE
 * fixture (`tests/helpers/server.ts`) against a real temp data root:
 *
 *   `DELETE /keys/:id`                          hard delete, on REVOKE's boundary
 *   `DELETE /stores/:store/objects?confirm=…`   empty a store, reclaim its bytes
 *   `DELETE /stores/:store?confirm=…`           delete a store, refused while scoped
 *
 * The two facts that make the naive implementation WRONG are pinned here, not argued:
 * `PRAGMA foreign_keys = ON` + `key_stores.store REFERENCES stores(name)` (X5, and why the
 * store delete refuses instead of cascading), and content-addressed storage, where two
 * entries can share ONE blob (X7, which is why the single-object delete cannot simply
 * unlink the file). The confirm token is pinned SERVER-side (X6): a dialog protects a
 * mis-click, not a mis-aimed `curl`.
 *
 * No test binds a port, touches the live data root, or reaches the deployed hostname.
 */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";
import {
  cleanupTestServers,
  createTestServer,
  keyId,
  readError,
  registeredRoutes,
  sha256Hex,
} from "./helpers/server.ts";

afterEach(cleanupTestServers);

type Server = ReturnType<typeof createTestServer>;

/** The fixed clock the ONE fixture injects, so every timestamp is deterministic. */
const FIXED_DELETED_AT = "2026-01-01T00:00:00.000Z";

const REPO = resolvePath(fileURLToPath(new URL("../", import.meta.url)));
const API_DOC = resolvePath(REPO, "docs/API.md");

async function body<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

/** Create a store through the real `POST /stores`, never by seeding a row. */
async function createStore(server: Server, master: string, name: string): Promise<void> {
  const response = await server.postJson("/stores", { name }, master);
  expect(response.status, `store ${name} must be created`).toBe(201);
}

/** The store names a `GET /stores` answers, for "the store is still there" assertions. */
async function storeNames(server: Server, master: string): Promise<string[]> {
  const listed = await body<{ stores: { name: string }[] }>(await server.get("/stores", master));
  return listed.stores.map((store) => store.name);
}

/** The number of `key_stores` rows for one key — ASSERTED IN THE DATABASE, not counted. */
function scopeRows(server: Server, id: string): number {
  return server.direct(
    (db) =>
      (db.prepare("SELECT COUNT(*) AS n FROM key_stores WHERE key_id = ?").get(id) as {
        n: number;
      }).n,
  );
}

/** Mint a key over HTTP and return both halves the route hands back. */
async function mintScoped(
  server: Server,
  master: string,
  stores: string[],
  perms: string[],
  label: string,
): Promise<{ key: string; id: string }> {
  const response = await server.postJson("/keys", { stores, perms, label }, master);
  expect(response.status, "the fixture key must mint").toBe(201);
  return (await response.json()) as { key: string; id: string };
}

describe("the destructive lifecycle (slice 16, pins X1-X9)", () => {
  test("PIN X1: DELETE /keys/:id removes the key and its scope, and the credential dies at once", async () => {
    const server = createTestServer();
    const master = server.mint({ stores: ["*"], perms: ["admin"] });
    await createStore(server, master, "alpha");
    const scoped = await mintScoped(server, master, ["alpha"], ["read", "write"], "scoped");
    expect(scoped.id).toBe(scoped.key.startsWith("ssk_") ? keyId(scoped.key) : "");

    // The key works and has a scope row BEFORE the delete.
    expect((await server.get("/whoami", scoped.key)).status).toBe(200);
    expect(scopeRows(server, scoped.id)).toBe(1);

    const deleted = await server.del(`/keys/${scoped.id}`, master);
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({ id: scoped.id, deletedAt: FIXED_DELETED_AT });

    // Gone from the inventory…
    const keys = await body<{ keys: { id: string }[] }>(await server.get("/keys", master));
    expect(keys.keys.map((entry) => entry.id)).not.toContain(scoped.id);
    // …its `key_stores` rows went WITH it (asserted in the database, not by counting API
    // responses — the schema's `ON DELETE CASCADE` is the mechanism under test)…
    expect(scopeRows(server, scoped.id)).toBe(0);
    // …and the credential stops authenticating on the NEXT request, with no cache.
    expect((await server.get("/whoami", scoped.key)).status).toBe(401);

    // A REVOKED key IS deletable — the owner's actual complaint is clutter in the list.
    const revoked = await mintScoped(server, master, ["alpha"], ["read"], "revoked");
    expect((await server.postJson(`/keys/${revoked.id}/revoke`, {}, master)).status).toBe(200);
    expect((await server.del(`/keys/${revoked.id}`, master)).status).toBe(200);
    expect(scopeRows(server, revoked.id)).toBe(0);
  });

  test("PIN X2: deleting a key is revoke's boundary", async () => {
    const server = createTestServer();
    const master = server.mint({ stores: ["*"], perms: ["admin"] });
    await createStore(server, master, "alpha");
    await createStore(server, master, "beta");
    // A store-scoped admin is minted OUT OF BAND (ledger row 40): no HTTP door grants
    // `admin` for a named scope. Two live admins exist, so X3 never blocks this test.
    const scopedAdmin = server.mint({ stores: ["alpha"], perms: ["admin"], label: "alpha-admin" });
    const masterPeer = server.mint({ stores: ["*"], perms: ["admin"] });
    const alphaAdminPeer = server.mint({ stores: ["alpha"], perms: ["admin"], label: "in-scope-admin" });
    const betaKey = server.mint({ stores: ["beta"], perms: ["read"] });
    const alphaKey = server.mint({ stores: ["alpha"], perms: ["read"] });
    const readOnly = server.mint({ stores: ["alpha"], perms: ["read"] });

    // A key OUTSIDE its scope: 403.
    const outside = await server.del(`/keys/${keyId(betaKey)}`, scopedAdmin);
    expect(outside.status).toBe(403);
    expect((await readError(outside)).code).toBe("forbidden");

    // A key HOLDING `admin`, even one INSIDE its own scope: 403 for a store-scoped admin,
    // which could never have minted an admin key.
    const peer = await server.del(`/keys/${keyId(alphaAdminPeer)}`, scopedAdmin);
    expect(peer.status).toBe(403);
    expect((await readError(peer)).message).toMatch(/holding 'admin'/);

    // Inside its scope and not an admin: allowed.
    expect((await server.del(`/keys/${keyId(alphaKey)}`, scopedAdmin)).status).toBe(200);

    // A master may delete any key.
    expect((await server.del(`/keys/${keyId(betaKey)}`, master)).status).toBe(200);

    // A NON-admin may not delete anything — not even itself.
    const nonAdmin = await server.del(`/keys/${keyId(readOnly)}`, readOnly);
    expect(nonAdmin.status).toBe(403);
    expect((await readError(nonAdmin)).code).toBe("forbidden");

    // SELF-DELETION is allowed (the caller's OWN credential, the one deliberate
    // exception revoke introduced): a store-scoped admin may delete its own key.
    expect((await server.del(`/keys/${keyId(scopedAdmin)}`, scopedAdmin)).status).toBe(200);
    expect((await server.get("/whoami", scopedAdmin)).status).toBe(401);
    // The untouched peer admin still works.
    expect((await server.get("/whoami", masterPeer)).status).toBe(200);
  });

  test("PIN X3: the LAST admin key cannot be deleted", async () => {
    // With EXACTLY ONE live admin key it is refused 409 — and the key still works.
    const one = createTestServer();
    const only = one.mint({ stores: ["*"], perms: ["admin"] });
    const refused = await one.del(`/keys/${keyId(only)}`, only);
    expect(refused.status).toBe(409);
    expect((await readError(refused)).code).toBe("conflict");
    expect((await one.get("/whoami", only)).status).toBe(200);

    // With TWO live admin keys either may be deleted, and the survivor still can.
    const two = createTestServer();
    const adminA = two.mint({ stores: ["*"], perms: ["admin"] });
    const adminB = two.mint({ stores: ["*"], perms: ["admin"] });
    expect((await two.del(`/keys/${keyId(adminB)}`, adminA)).status).toBe(200);
    expect((await two.get("/whoami", adminA)).status).toBe(200);
    expect((await two.get("/whoami", adminB)).status).toBe(401);

    // A REVOKED admin does NOT count as an administrator…
    const revoked = createTestServer();
    const live = revoked.mint({ stores: ["*"], perms: ["admin"] });
    const dead = revoked.mint({ stores: ["*"], perms: ["admin"] });
    await revoked.postJson(`/keys/${keyId(dead)}/revoke`, {}, live);
    expect((await revoked.del(`/keys/${keyId(live)}`, live)).status).toBe(409);
    // …and the revoked key IS deletable (revocation is terminal; deletion is cleanup).
    expect((await revoked.del(`/keys/${keyId(dead)}`, live)).status).toBe(200);

    // An EXPIRED admin does NOT count either.
    const expired = createTestServer();
    const liveAdmin = expired.mint({ stores: ["*"], perms: ["admin"] });
    expired.mint({
      stores: ["*"],
      perms: ["admin"],
      expiresAt: "2025-12-31T23:59:59.000Z",
    });
    expect((await expired.del(`/keys/${keyId(liveAdmin)}`, liveAdmin)).status).toBe(409);
    expect((await expired.get("/whoami", liveAdmin)).status).toBe(200);
  });

  test("PIN X4: emptying a store removes every entry and reclaims the bytes", async () => {
    const server = createTestServer();
    const master = server.mint({ stores: ["*"], perms: ["admin"] });
    await createStore(server, master, "alpha");
    const scoped = server.mint({ stores: ["alpha"], perms: ["read", "delete"] });
    await server.put("/stores/alpha/objects/a.txt", "aaa", master);
    await server.put("/stores/alpha/objects/b.txt", "bbb", master);
    await server.put("/stores/master/objects/keep.txt", "keep", master);
    expect(server.listBlobFiles().filter((path) => path.startsWith("alpha/"))).toHaveLength(2);

    const emptied = await server.del("/stores/alpha/objects?confirm=alpha", master);
    expect(emptied.status).toBe(200);
    expect(await emptied.json()).toEqual({ store: "alpha", deleted: 2 });

    // The entries are gone from the listing…
    expect(await (await server.get("/stores/alpha/objects", master)).json()).toEqual({ objects: [] });
    // …their blob FILES are gone from disk (not merely unreferenced)…
    expect(server.listBlobFiles().filter((path) => path.startsWith("alpha/"))).toEqual([]);
    // …the sibling store's bytes are untouched…
    expect(server.listBlobFiles().some((path) => path.startsWith("master/"))).toBe(true);
    // …and the STORE and its keys' SCOPES are untouched: a key scoped to an empty store
    // is perfectly valid, and the scope is not this route's business.
    expect(await storeNames(server, master)).toContain("alpha");
    expect((await body<{ stores: string[] }>(await server.get("/whoami", scoped))).stores).toEqual([
      "alpha",
    ]);

    // Idempotent: emptying an already-empty store is 200 with 0, never an error.
    const again = await server.del("/stores/alpha/objects?confirm=alpha", master);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ store: "alpha", deleted: 0 });
  });

  test("PIN X5: a store with a key scoped to it cannot be deleted", async () => {
    const server = createTestServer();
    const master = server.mint({ stores: ["*"], perms: ["admin"] });
    await createStore(server, master, "alpha");
    await server.put("/stores/alpha/objects/keep.txt", "keep", master);
    const blocker = server.mint({ stores: ["alpha"], perms: ["read"], label: "the-blocker" });
    const blockerId = keyId(blocker);

    const refused = await server.del("/stores/alpha?confirm=alpha", master);
    expect(refused.status).toBe(409);
    const error = await readError(refused);
    expect(error.code).toBe("conflict");
    expect(error.message, "the refusal must NAME the blocking key").toContain(blockerId);
    expect(error.message).toContain("the-blocker");

    // The store still lists, its objects still read, and its directory is still on disk.
    expect((await server.get("/stores/alpha/objects", master)).status).toBe(200);
    expect(await (await server.get("/stores/alpha/objects/keep.txt", master)).text()).toBe("keep");
    expect(await storeNames(server, master)).toContain("alpha");
    expect(existsSync(join(server.dataRoot, "stores", "alpha"))).toBe(true);

    // Delete the blocking key (X1's route), then the store delete SUCCEEDS and the
    // directory goes with it.
    expect((await server.del(`/keys/${blockerId}`, master)).status).toBe(200);
    const deleted = await server.del("/stores/alpha?confirm=alpha", master);
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({ name: "alpha", deletedAt: FIXED_DELETED_AT });
    expect(await storeNames(server, master)).not.toContain("alpha");
    expect((await server.get("/stores/alpha/objects", master)).status).toBe(404);
    expect(existsSync(join(server.dataRoot, "stores", "alpha"))).toBe(false);
  });

  test("PIN X6: the confirm token is server-side", async () => {
    const server = createTestServer();
    const master = server.mint({ stores: ["*"], perms: ["admin"] });
    await createStore(server, master, "alpha");
    await createStore(server, master, "beta");
    await server.put("/stores/alpha/objects/a.txt", "aaa", master);
    await server.put("/stores/beta/objects/b.txt", "bbb", master);
    const blocker = server.mint({ stores: ["alpha"], perms: ["read"], label: "blocker" });

    // EMPTY: a missing, empty or mismatched token is 400 and NOTHING is deleted.
    for (const query of ["", "?confirm=", "?confirm=beta", "?confirm=ALPHA"]) {
      const response = await server.del(`/stores/alpha/objects${query}`, master);
      expect(response.status, query).toBe(400);
      expect((await readError(response)).code, query).toBe("bad_request");
    }
    expect(await (await server.get("/stores/alpha/objects/a.txt", master)).text()).toBe("aaa");
    expect(server.listBlobFiles().some((path) => path.startsWith("alpha/"))).toBe(true);

    // DELETE STORE: the same rule, and the object, the store, the key and its scope are
    // ALL still there afterwards.
    for (const query of ["", "?confirm=", "?confirm=alpha", "?confirm=BETA"]) {
      const response = await server.del(`/stores/beta${query}`, master);
      expect(response.status, query).toBe(400);
      expect((await readError(response)).code, query).toBe("bad_request");
    }
    expect(await (await server.get("/stores/beta/objects/b.txt", master)).text()).toBe("bbb");
    expect(await storeNames(server, master)).toContain("beta");
    expect((await server.get("/whoami", blocker)).status).toBe(200);
    expect(scopeRows(server, keyId(blocker))).toBe(1);

    // The CORRECT token works — both bulk routes.
    expect((await server.del("/stores/alpha/objects?confirm=alpha", master)).status).toBe(200);
    const storeDeleted = await server.del("/stores/beta?confirm=beta", master);
    expect(storeDeleted.status).toBe(200);
    expect(await storeDeleted.json()).toEqual({ name: "beta", deletedAt: FIXED_DELETED_AT });
  });

  test("PIN X7: deleting one object reclaims only UNSHARED content", async () => {
    const server = createTestServer();
    const master = server.mint({ stores: ["*"], perms: ["admin"] });
    const payload = "identical bytes, one blob\n";
    const sha = sha256Hex(payload);
    const blob = `master/blobs/${sha.slice(0, 2)}/${sha}`;

    await server.put("/stores/master/objects/twin-a", payload, master);
    await server.put("/stores/master/objects/twin-b", payload, master);
    // Content-addressed storage: two name rows, ONE file on disk.
    expect(server.listBlobFiles()).toEqual([blob]);
    const rows = server.direct(
      (db) =>
        (db
          .prepare("SELECT COUNT(*) AS n FROM objects WHERE store = 'master' AND sha256 = ?")
          .get(sha) as { n: number }).n,
    );
    expect(rows).toBe(2);

    // Delete ONE: the survivor still READS correctly, so the blob was NOT reclaimed.
    expect((await server.del("/stores/master/objects/twin-a", master)).status).toBe(204);
    expect(await (await server.get("/stores/master/objects/twin-b", master)).text()).toBe(payload);
    expect(server.listBlobFiles()).toEqual([blob]);

    // Delete the LAST: the row is gone AND the blob file is gone.
    expect((await server.del("/stores/master/objects/twin-b", master)).status).toBe(204);
    expect((await server.get("/stores/master/objects/twin-b", master)).status).toBe(404);
    expect(server.listBlobFiles()).toEqual([]);
  });

  test("PIN X8: authorization and the error surface are unchanged in kind", async () => {
    const server = createTestServer();
    const master = server.mint({ stores: ["*"], perms: ["admin"] });
    await createStore(server, master, "alpha");
    await server.put("/stores/alpha/objects/a.txt", "aaa", master);
    const reader = server.mint({ stores: ["alpha"], perms: ["read"] });
    const scopedAdmin = server.mint({ stores: ["alpha"], perms: ["admin"] });
    const masterRead = server.mint({ stores: ["*"], perms: ["read"] });

    // Emptying requires `delete`: a read-only key is 403 and NOTHING is deleted.
    const refusedEmpty = await server.del("/stores/alpha/objects?confirm=alpha", reader);
    expect(refusedEmpty.status).toBe(403);
    expect((await readError(refusedEmpty)).code).toBe("forbidden");
    expect(await (await server.get("/stores/alpha/objects/a.txt", master)).text()).toBe("aaa");

    // Deleting a store requires a MASTER admin: a store-scoped admin and a `["*"]` key
    // without `admin` are both 403. Deleting a KEY needs `admin` at all, so the same
    // read-only key is 403 there too.
    expect((await server.del("/stores/alpha?confirm=alpha", scopedAdmin)).status).toBe(403);
    expect((await server.del("/stores/alpha?confirm=alpha", masterRead)).status).toBe(403);
    expect((await server.del(`/keys/${keyId(reader)}`, reader)).status).toBe(403);

    // An unknown store or key is 404 — the SAME `not_found` the rest of the API uses.
    expect((await server.del("/stores/nope/objects?confirm=nope", master)).status).toBe(404);
    expect((await server.del("/stores/nope?confirm=nope", master)).status).toBe(404);
    const missingKey = await server.del("/keys/aaaaaaaaaaaa", master);
    expect(missingKey.status).toBe(404);
    expect((await readError(missingKey)).code).toBe("not_found");

    // No key at all: 401 on every destructive route.
    for (const path of [
      "/keys/aaaaaaaaaaaa",
      "/stores/master/objects?confirm=master",
      "/stores/master?confirm=master",
    ]) {
      expect((await server.del(path)).status, path).toBe(401);
    }

    // A traversal attempt never builds a path: the store name goes through the ONE name
    // parser, and the raw-target guard refuses the segment first.
    for (const path of [
      "/stores/..%2F..%2Fetc/objects?confirm=x",
      "/stores/..%2F..%2Fetc?confirm=x",
    ]) {
      const response = await server.del(path, master);
      expect(response.status, path).toBe(400);
      expect((await readError(response)).code, path).toBe("invalid_name");
    }
  });

  test("PIN X9: the docs match the code", () => {
    const doc = readFileSync(API_DOC, "utf8");
    const routeTable = doc.slice(doc.indexOf("\n## Routes\n"), doc.indexOf("### Names"));
    const row = (method: string, path: string): string | undefined =>
      routeTable
        .split("\n")
        .find((line) => line.startsWith(`| \`${method}\` | \`${path}\` |`));

    // The three routes are in docs/API.md's table, with their permissions and statuses.
    const deleteKeyRow = row("DELETE", "/keys/{id}");
    expect(deleteKeyRow, "docs/API.md has no DELETE /keys/{id} row").toBeDefined();
    expect(deleteKeyRow).toMatch(/admin/);
    for (const status of ["200", "401", "403", "404", "409"]) {
      expect(deleteKeyRow, `DELETE /keys/{id} does not list ${status}`).toContain(`\`${status}\``);
    }

    const emptyRow = row("DELETE", "/stores/{store}/objects");
    expect(emptyRow, "docs/API.md has no DELETE /stores/{store}/objects row").toBeDefined();
    expect(emptyRow, "the empty-store row does not name the confirm token").toMatch(/confirm/);
    expect(emptyRow, "the empty-store row does not require `delete`").toMatch(/`delete`/);
    for (const status of ["200", "400", "401", "403", "404"]) {
      expect(emptyRow, `empty-store row does not list ${status}`).toContain(`\`${status}\``);
    }

    const storeRow = row("DELETE", "/stores/{store}");
    expect(storeRow, "docs/API.md has no DELETE /stores/{store} row").toBeDefined();
    expect(storeRow, "the store-delete row does not require a master admin").toMatch(/master admin/);
    expect(storeRow, "the store-delete row does not name the confirm token").toMatch(/confirm/);
    expect(storeRow, "the store-delete row does not list the 409 refusal").toContain("`409`");

    // …and the code REGISTERS exactly those routes (the doc half of PIN A1, checked here
    // so X9 fails if the doc is right and the route was never written).
    const registered = registeredRoutes();
    for (const route of [
      "DELETE /keys/:id",
      "DELETE /stores/:store/objects",
      "DELETE /stores/:store",
    ]) {
      expect(registered, `the app does not register ${route}`).toContain(route);
    }

    // The new 409 code is in the error table with the status `src/core/errors.ts` maps.
    expect(doc, "docs/API.md does not document `conflict` at 409").toMatch(
      /\|\s*`conflict`\s*\|\s*`409`\s*\|/,
    );

    // The rules the routes implement are STATED, so the pin is about the contract and not
    // only about route presence: the last-live-admin rule, the confirm token, and the
    // reclamation with its sharing trap.
    expect(doc, "the last-live-admin rule is not documented").toMatch(/[Ll]ast live admin/);
    expect(doc, "the confirm rule is not documented").toMatch(/confirm=/);
    expect(doc, "the shared-content rule is not documented").toMatch(
      /no other entry in that store/,
    );
  });
});
