/**
 * `createApp` — the HTTP surface, built as a factory over injected dependencies.
 *
 * The pipeline every request walks (this is THE seam):
 *
 *   path guard → resolve key → authorize against a NAMED store → dispatch to that
 *   store kind's handler → storage
 *
 * Everything before "dispatch" is store-kind agnostic; everything after it is one
 * handler in `src/storage/kinds.ts`. Tests drive the whole thing through
 * `app.request()` — no port is ever bound outside `main.ts`.
 */

import { HTTPException } from "hono/http-exception";
import { Hono, type Context } from "hono";
import { getPath } from "hono/utils/url";
import type { DatabaseSync } from "node:sqlite";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { openDatabase } from "../core/db.ts";
import { errorBody, StoreError, toStoreError, type ErrorCode } from "../core/errors.ts";
import { describeStores, findKeyById, listKeys, mintKey, resolveKey, revokeKey, touchKey } from "../core/keys.ts";
import {
  assertNoTraversalSegments,
  parseExpiresAt,
  parsePermissions,
  parseObjectName,
  parseStoreKind,
  parseStores,
} from "../core/validate.ts";
import { ALL_STORES, type Permission, type AccessKeyRecord } from "../core/types.ts";
import { UI_ASSETS, readUiAsset } from "./assets.ts";
import { DEFAULT_MAX_BYTES, DEFAULT_HOST, DEFAULT_PORT } from "./config.ts";
import { createStore, ensureMasterStore, listStores, requireStore } from "../stores/registry.ts";
import { handlerFor } from "../storage/kinds.ts";

export { DEFAULT_HOST, DEFAULT_MAX_BYTES, DEFAULT_PORT };

export interface AppDependencies {
  /** Root of every store's bytes. Lives OUTSIDE the repo (ledger row 13). */
  readonly dataRoot: string;
  /** The metadata database file. */
  readonly dbPath: string;
  /** Injectable clock, milliseconds since epoch. */
  readonly now?: () => number;
  /** Body size cap. An over-cap body fails the request; it is never truncated. */
  readonly maxBytes?: number;
}

export interface AppContext {
  readonly deps: Required<AppDependencies>;
  readonly db: DatabaseSync;
}

/** What a resolved key is allowed to do, and against which store. */
class Auth {
  // NOT parameter properties (`constructor(readonly key: ...)`): Node 24 runs this
  // file with `--experimental-strip-types`, which strips types but cannot transform
  // them, and parameter properties are exactly the thing it refuses. The suite would
  // still pass (vitest transpiles) while `pnpm run serve` died at import — so these
  // are plain fields, assigned in the body.
  readonly key: AccessKeyRecord;
  readonly ctx: AppContext;

  constructor(key: AccessKeyRecord, ctx: AppContext) {
    this.key = key;
    this.ctx = ctx;
  }

  get spansStores(): boolean {
    return this.key.stores.includes(ALL_STORES);
  }

  /**
   * 403 unless this key may administer keys at all — mint, list or revoke.
   *
   * WHO MAY ADMINISTER KEYS is the FIRST thing every key-administering route decides
   * (ledger rows 39, 46): only a key that holds `admin`. `action` completes the
   * message ("only an admin key may mint keys"), so the ONE predicate serves the mint,
   * list and revoke routes and each refusal says which action it refused. The message
   * of the mint case is pinned by M1 and is unchanged.
   *
   * This replaced the subset rule of ledger row 36 (`grantablePermissions` + the `lacks`
   * check), which became UNREACHABLE once only admins may mint — `admin` implies every
   * permission, so a subset check could never fire. Unreachable code that reads as a
   * security control is a trap, so it was deleted rather than kept behind a comment. A
   * future slice that lets a NON-admin key mint MUST reinstate the subset rule in the
   * SAME commit (docs/SEAM-INDEX.md, "Who may MINT").
   */
  requireAdmin(action: string): void {
    if (!this.key.perms.includes("admin")) {
      throw new StoreError("forbidden", `only an admin key may ${action}`);
    }
  }

  /**
   * Does this key's SCOPE CONTAIN every store in `stores`?
   *
   * THE scope-containment predicate, and the only one (ledger row 46): the `POST /keys`
   * store boundary, the `GET /keys` inventory filter and the `POST /keys/:id/revoke`
   * scope boundary all route through it, so the three cannot drift apart. A key that
   * spans every store (`["*"]`) contains every scope — including another `["*"]`; a
   * scoped key never contains `["*"]`, and contains a set only when every member of it
   * is in its own set.
   */
  holdsStores(stores: readonly string[]): boolean {
    if (this.spansStores) return true;
    return stores.every((store) => store !== ALL_STORES && this.key.stores.includes(store));
  }

  /**
   * 403 unless the key carries `permission` for `store` (admin implies all).
   *
   * THE membership test for a key's scope, and the only one (ledger row 41): the key
   * passes when it spans every store (`["*"]`) OR when `store` is in its SET. The
   * record was loaded whole by `resolveKey`, so nothing here queries: a request is
   * one scope read, never one per store.
   */
  authorize(store: string, permission: Permission): void {
    if (!this.spansStores && !this.key.stores.includes(store)) {
      throw new StoreError(
        "forbidden",
        `key is scoped to ${describeStores(this.key.stores)}; ` +
          `it does not include store ${JSON.stringify(store)}`,
      );
    }
    if (this.key.perms.includes("admin") || this.key.perms.includes(permission)) {
      // The operation must also be one this store kind implements.
      handlerFor(requireStore(this.ctx.db, store).kind);
      return;
    }
    throw new StoreError(
      "forbidden",
      `key lacks '${permission}' on store ${JSON.stringify(store)}`,
    );
  }

  /** 403 unless the key is an admin key scoped to every store. */
  requireMasterAdmin(): void {
    if (!this.spansStores || !this.key.perms.includes("admin")) {
      throw new StoreError("forbidden", "this operation requires a master admin key");
    }
  }
}

interface Variables {
  ctx: AppContext;
  auth: Auth;
}

/**
 * Read the whole body under a byte cap.
 *
 * The cap is enforced on the STREAM, not on `Content-Length` (which a client can
 * lie about), and an over-cap body fails with 413 — it is never truncated and never
 * partially stored.
 */
async function readBodyCapped(request: Request, maxBytes: number): Promise<Uint8Array | null> {
  const body = request.body;
  if (body === null) return null;
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value === undefined) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new StoreError(
        "payload_too_large",
        `request body exceeds the ${maxBytes}-byte cap for this server (read at least ${total})`,
      );
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out.length === 0 ? null : out;
}

function authFrom(header: string | undefined): string | null {
  if (header === undefined) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (match === null) return null;
  const token = match[1]?.trim();
  return token !== undefined && token.length > 0 ? token : null;
}

/** The pathname of a request target, WITHOUT decoding it. */
function rawPathname(request: Request): string {
  return getPath(request);
}

export function createApp(dependencies: AppDependencies): Hono<{ Variables: Variables }> {  const deps: Required<AppDependencies> = {
    dataRoot: dependencies.dataRoot,
    dbPath: dependencies.dbPath,
    now: dependencies.now ?? (() => Date.now()),
    maxBytes: dependencies.maxBytes ?? DEFAULT_MAX_BYTES,
  };
  const db = openDatabase(deps.dbPath);
  ensureMasterStore(db, deps.now);
  const ctx: AppContext = { deps, db };

  const app = new Hono<{ Variables: Variables }>();

  app.use("*", async (c, next) => {
    c.set("ctx", ctx);
    await next();
  });

  // A traversal segment is refused before any route sees it, so no layer below can
  // be tempted to "sanitise" it into a different path. Like the raw-target guard,
  // this runs on the UNDECODED path, so `%2e%2e` is caught rather than silently
  // decoded into `..`.
  app.use("*", async (c, next) => {
    assertNoTraversalSegments(rawPathname(c.req.raw));
    await next();
  });

  const guard = async (c: Context<{ Variables: Variables }>, next: () => Promise<void>) => {
    const raw = authFrom(c.req.header("authorization")) ?? c.req.header("x-api-key") ?? null;
    const record = resolveKey(ctx.db, raw, deps.now);
    if (record === null) {
      throw new StoreError(
        "unauthorized",
        raw === null
          ? "no access key presented (Authorization: Bearer <key> or x-api-key)"
          : "access key is unknown, revoked or expired",
      );
    }
    // The record is kept in step with the row just touched, so `GET /whoami` reports
    // the use it is part of rather than the one before it.
    const usedAt = touchKey(ctx.db, record.id, deps.now);
    c.set("auth", new Auth({ ...record, lastUsedAt: usedAt }, ctx));
    await next();
  };

  app.get("/healthz", (c) => c.json({ ok: true }));

  // THE ADMIN UI (ledger row 49): the THREE literal asset routes from `web/`, served
  // with no directory walking and no static-file middleware. They are registered HERE,
  // before the key guard, because the console itself must load without a key — the
  // operator types the key INTO it, and `GET /whoami` is what proves it. `GET /` is a
  // literal route, not a catch-all: it shadows no API route and an unknown path is
  // still the API's JSON 404. `no-store` keeps a stale console out of a browser cache.
  for (const asset of UI_ASSETS) {
    app.get(asset.route, async () => {
      const body = await readUiAsset(asset);
      return new Response(body, {
        status: 200,
        headers: { "content-type": asset.contentType, "cache-control": "no-store" },
      });
    });
  }

  app.use("*", guard);

  app.get("/stores", (c) => {
    c.get("auth").requireMasterAdmin();
    return c.json({ stores: listStores(ctx.db) });
  });

  app.post("/stores", async (c) => {
    c.get("auth").requireMasterAdmin();
    const body = await readJsonObject(c.req.raw, deps.maxBytes);
    const kind = body.kind === undefined ? undefined : parseStoreKind(body.kind);
    const store = createStore(ctx.db, body.name, kind, deps.now);
    return c.json({ store }, 201);
  });

  app.post("/keys", async (c) => {
    const auth = c.get("auth");
    // WHO MAY MINT (ledger row 39) — decided BEFORE the body is read, so a non-admin
    // key's request is refused with no parsing and no side effect at all.
    auth.requireAdmin("mint keys");
    const body = await readJsonObject(c.req.raw, deps.maxBytes);
    if (body.store !== undefined) {
      // The single-store field was replaced by the SET (ledger row 41). Named
      // explicitly rather than ignored: a client written against the old contract
      // must not silently get a scope it did not ask for.
      throw new StoreError(
        "bad_request",
        `the 'store' field was replaced by 'stores' (an array): send stores: [<name>]`,
      );
    }
    const stores = parseStores(body.stores);
    const perms = parsePermissions(body.perms);
    if (perms.includes("admin")) {
      // Only a master admin key may hand out admin, and only for the master scope:
      // a store-scoped admin grant is a second kind of admin this model does not have
      // (it is minted out of band by `pnpm run admin:key`, ledger row 40).
      auth.requireMasterAdmin();
      if (!(stores.length === 1 && stores[0] === ALL_STORES)) {
        throw new StoreError("forbidden", `an admin grant must be scoped to ["${ALL_STORES}"]`);
      }
    } else if (!auth.spansStores) {
      // A scoped admin mints only WITHIN its own set: every requested store must be one
      // the minter itself holds. (`["*"]` is never inside a scoped set.) The containment
      // test is the ONE shared predicate, so this boundary cannot drift from the one
      // `GET /keys` filters by or the one `POST /keys/:id/revoke` enforces (ledger 46).
      const outside = stores.filter((store) => !auth.holdsStores([store]));
      if (outside.length > 0) {
        throw new StoreError(
          "forbidden",
          `key is scoped to ${describeStores(auth.key.stores)}; ` +
            `it may not mint for ${describeStores(outside)}`,
        );
      }
    }
    // Every named store must already exist (the master scope has no names to check).
    for (const store of stores) {
      if (store !== ALL_STORES) requireStore(ctx.db, store);
    }
    // The slice-6 subset check (`lacks` / `grantablePermissions`) is DELETED as
    // unreachable: `requireAdmin()` above means every minter holds `admin`, which
    // implies every permission, so a subset check could never fire. The rule that
    // replaced it — "a non-admin key cannot mint" — is pinned M1 in tests/keys.test.ts.
    // Any future slice that lets a NON-admin key mint MUST reinstate the subset rule in
    // the SAME commit (docs/SEAM-INDEX.md, "Who may MINT").
    const expiresAt = parseExpiresAt(body.expiresAt);
    const label = typeof body.label === "string" && body.label.trim() !== "" ? body.label : "unlabelled";
    const minted = mintKey(ctx.db, {
      stores,
      label,
      perms,
      now: deps.now,
      expiresAt,
    });
    // The ONLY time the raw key is ever emitted.
    return c.json(
      {
        key: minted.raw,
        id: minted.record.id,
        prefix: minted.record.prefix,
        stores: minted.record.stores,
        perms: minted.record.perms,
        expiresAt: minted.record.expiresAt,
      },
      201,
    );
  });

  // THE KEY LIFECYCLE (ledger row 46): listing and revocation live here, beside the
  // mint route they are the other half of, and reuse the SAME scope predicate
  // (`Auth.holdsStores`) that route already enforces. There is no second authorization
  // path, and no key material ever leaves these handlers.
  app.get("/keys", (c) => {
    const auth = c.get("auth");
    auth.requireAdmin("list keys");
    // A MASTER sees every key. A STORE-SCOPED admin sees only the keys it could have
    // minted — scope inside its own set — so it cannot enumerate credentials it could
    // not have created. `["*"]` is never inside a scoped set, so a scoped admin never
    // sees another master.
    const keys = listKeys(ctx.db)
      .filter((key) => auth.holdsStores(key.stores))
      .map((key) => ({
        id: key.id,
        label: key.label,
        stores: key.stores,
        // `prefix` is `ssk_` + the first 8 characters of the PUBLIC `id` (the stored
        // DISPLAY_PREFIX_LENGTH is 12); the secret begins after the id, so this carries
        // no secret byte, and it is returned so a console shows the same handle the
        // operator saw at mint without re-deriving it (ledger row 46).
        prefix: key.prefix,
        perms: key.perms,
        createdAt: key.createdAt,
        expiresAt: key.expiresAt,
        lastUsedAt: key.lastUsedAt,
        revokedAt: key.revokedAt,
      }));
    return c.json({ keys });
  });

  app.post("/keys/:id/revoke", (c) => {
    const auth = c.get("auth");
    auth.requireAdmin("revoke keys");
    const id = c.req.param("id");
    const target = findKeyById(ctx.db, id);
    if (target === null) {
      throw new StoreError("not_found", `no key with id ${JSON.stringify(id)}`);
    }
    // SELF-REVOCATION IS ALLOWED, deliberately rather than by accident (ledger row 46,
    // pin L6): it is the caller's OWN credential, so the scope rules below do not apply
    // to it — including for a store-scoped admin, whose own key holds `admin` and would
    // otherwise be un-revokable by the rule beneath. It takes effect on the NEXT request
    // (`resolveKey` refuses a revoked row) — docs/API.md warns that plainly.
    if (target.id !== auth.key.id && !auth.spansStores) {
      // A scoped admin revokes only keys it could have minted: scope inside its own set
      // and never a key holding `admin`. Both halves read the ONE containment predicate.
      if (!auth.holdsStores(target.stores)) {
        throw new StoreError(
          "forbidden",
          `key is scoped to ${describeStores(auth.key.stores)}; ` +
            `it may not revoke a key scoped to ${describeStores(target.stores)}`,
        );
      }
      if (target.perms.includes("admin")) {
        throw new StoreError(
          "forbidden",
          `key is scoped to ${describeStores(auth.key.stores)}; ` +
            `only a master admin key may revoke a key holding 'admin'`,
        );
      }
    }
    const changed = revokeKey(ctx.db, id, deps.now);
    // The timestamp comes from the ROW, never from the clock: on a second call
    // `revokeKey` matches no row (`revoked_at IS NULL` is false), so the first call's
    // timestamp is what this reports and it cannot move (pin L5). Re-reading also
    // proves the write landed rather than trusting `changes`.
    const revoked = findKeyById(ctx.db, id);
    if (revoked === null || revoked.revokedAt === null) {
      throw new StoreError("internal", `key ${id} could not be revoked`);
    }
    return c.json({ id, revokedAt: revoked.revokedAt, changed });
  });

  // WHO AM I — the caller's own identity and scope, and NEVER a secret (ledger rows
  // 30, 41). `id` is the public lookup id already shown at mint time; the raw key,
  // its secret and its hash are not in this body and never will be.
  app.get("/whoami", (c) => {
    const key = c.get("auth").key;
    return c.json({
      id: key.id,
      label: key.label,
      stores: key.stores,
      perms: key.perms,
      expiresAt: key.expiresAt,
      lastUsedAt: key.lastUsedAt,
    });
  });

  app.get("/stores/:store/objects", (c) => {
    const store = requireStore(ctx.db, c.req.param("store"));
    c.get("auth").authorize(store.name, "read");
    const handler = handlerFor(store.kind);
    return c.json({ objects: handler.list(ctx.db, store.name) });
  });

  app.put("/stores/:store/objects/:name", async (c) => {
    const store = requireStore(ctx.db, c.req.param("store"));
    const name = parseObjectName(c.req.param("name"));
    const auth = c.get("auth");
    auth.authorize(store.name, "write");
    const bytes = await readBodyCapped(c.req.raw, deps.maxBytes);
    if (bytes === null) {
      // No silent fallback: an empty body never becomes an object.
      throw new StoreError("invalid_body", "a PUT must carry a non-empty body");
    }
    const handler = handlerFor(store.kind);
    const metadata = await handler.write(ctx.db, deps.dataRoot, store.name, name, bytes, deps.now);
    return c.json({ store: store.name, name, ...metadata }, 201);
  });

  app.get("/stores/:store/objects/:name", async (c) => {
    const store = requireStore(ctx.db, c.req.param("store"));
    const name = parseObjectName(c.req.param("name"));
    c.get("auth").authorize(store.name, "read");
    const handler = handlerFor(store.kind);
    const found = await handler.read(ctx.db, deps.dataRoot, store.name, name);
    if (found === null) {
      throw new StoreError("not_found", `no object ${JSON.stringify(name)} in store ${JSON.stringify(store.name)}`);
    }
    return new Response(found.bytes.slice().buffer, {
      status: 200,
      headers: {
        "content-type": "application/octet-stream",
        "content-length": String(found.metadata.size),
        "x-serverstore-sha256": found.metadata.sha256,
      },
    });
  });

  app.delete("/stores/:store/objects/:name", (c) => {
    const store = requireStore(ctx.db, c.req.param("store"));
    const name = parseObjectName(c.req.param("name"));
    c.get("auth").authorize(store.name, "delete");
    // The row goes; the blob stays (GC is out of scope, brief §4). The existence
    // check keeps a delete of a missing object a 404 rather than a silent success.
    const found = ctx.db
      .prepare("SELECT name FROM objects WHERE store = ? AND name = ?")
      .get(store.name, name) as { name: string } | undefined;
    if (found === undefined) {
      throw new StoreError("not_found", `no object ${JSON.stringify(name)} in store ${JSON.stringify(store.name)}`);
    }
    ctx.db.prepare("DELETE FROM objects WHERE store = ? AND name = ?").run(store.name, name);
    return c.body(null, 204);
  });

  app.notFound((c) =>
    c.json(errorBody("not_found", `no route for ${c.req.method} ${c.req.path}`), 404),
  );

  app.onError((error, c) => {
    if (error instanceof HTTPException) {
      return c.json(errorBody("bad_request", error.message), error.status as 400);
    }
    const storeError = toStoreError(error);
    if (storeError.code === "internal") {
      // The message is surfaced (no silent failure) but the stack is not.
      console.error(`[serverstore] internal error: ${storeError.message}`);
    }
    return c.json(errorBody(storeError.code, storeError.message), storeError.status as 400);
  });

  // A traversal segment is refused as a 400 before ANY layer can normalise it into a
  // different path. It is checked twice on purpose:
  //   - here, on the raw request target, because `new Request("http://host/a/../b")`
  //     has ALREADY collapsed to `/b` by the time the router sees it (and Hono's
  //     `request()` builds exactly such a Request from a test's string path) — a
  //     refusal that depends on the platform's URL parser is not a refusal;
  //   - and in the middleware below, on the undecoded path, so an encoded `%2e%2e`
  //     is refused too instead of being decoded under our feet.
  const wrapped = Object.create(app) as Hono<{ Variables: Variables }> & {
    fetch(request: Request, ...rest: unknown[]): Response | Promise<Response>;
    request(input: Request | string | URL, init?: RequestInit): Response | Promise<Response>;
  };
  const delegateFetch = app.fetch.bind(app);
  const delegateRequest = app.request.bind(app) as unknown as (
    input: Request | string | URL,
    init?: RequestInit,
  ) => Response | Promise<Response>;

  const traversalRefusal = (target: string): Response | null =>
    TRAVERSAL_ANY.test(target) || TRAVERSAL_ENCODED.test(target) ? refusalResponse() : null;

  wrapped.fetch = (request: Request, ...rest: unknown[]): Response | Promise<Response> =>
    traversalRefusal(rawPathname(request)) ??
    (delegateFetch(request, ...rest) as Response | Promise<Response>);

  wrapped.request = (
    input: Request | string | URL,
    init?: RequestInit,
  ): Response | Promise<Response> => {
    if (input instanceof Request) {
      return wrapped.fetch(init === undefined ? input : new Request(input, init));
    }
    const path = typeof input === "string" ? input : input.toString();
    return traversalRefusal(path) ?? delegateRequest(path, init);
  };

  return wrapped;
}

/** `.` or `..` as a WHOLE path segment. */
const TRAVERSAL_ANY = /(^|\/)(\.|\.\.)(\/|$)/;

/**
 * A percent-encoded `.` or `..` segment (`%2e`, `%2e%2e`, `%2E.`).
 *
 * This one matters more than it looks: `new Request("http://h/a/%2E%2E/b")`
 * normalises to `/a/b` in the URL parser, so by the time any Request-based check can
 * look, the traversal has already been rewritten. The RAW TARGET string is the last
 * place it is still visible, so the refusal has to happen there. A segment is only a
 * traversal when it is ENTIRELY `.` or `..` — `a..b` is a legal name, and this
 * pattern does not touch it.
 */
const TRAVERSAL_ENCODED = /(^|\/)(%2e%2e|%2e)(\/|$)/i;

/** The only 400 the traversal guards return. */
function refusalResponse(): Response {
  const error = new StoreError("invalid_name", "path may not contain a '.' or '..' segment");
  return Response.json(errorBody(error.code, error.message), { status: error.status });
}

/** Read a JSON object body under the cap. A non-object or bad JSON is a 400. */
async function readJsonObject(request: Request, maxBytes: number): Promise<Record<string, unknown>> {
  const bytes = await readBodyCapped(request, maxBytes);
  if (bytes === null) {
    throw new StoreError("invalid_body", "a JSON body is required");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    throw new StoreError("invalid_body", `body is not valid JSON: ${(error as Error).message}`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new StoreError("invalid_body", "body must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

/** Create the data root on disk. Called by `main.ts` before the app is served. */
export async function ensureDataRoot(deps: AppDependencies): Promise<void> {
  await mkdir(dirname(deps.dbPath), { recursive: true });
}

export type { ErrorCode };
