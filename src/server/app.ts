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
import { describeStores, editKey, findKeyById, listKeys, mintKey, resolveKey, revokeKey, touchKey } from "../core/keys.ts";
import {
  assertNoTraversalSegments,
  DEFAULT_LABEL,
  parseExpiresAt,
  parseLabel,
  parsePermissions,
  parseObjectName,
  parseStoreKind,
  parseStores,
} from "../core/validate.ts";
import { ALL_STORES, type Permission, type AccessKeyRecord } from "../core/types.ts";
import { UI_ASSETS, readUiAsset } from "./assets.ts";
import { DEFAULT_MAX_BYTES, DEFAULT_HOST, DEFAULT_PORT, CORS_WILDCARD } from "./config.ts";
import { createStore, ensureMasterStore, listStores, requireStore } from "../stores/registry.ts";
import { handlerFor } from "../storage/kinds.ts";

export { DEFAULT_HOST, DEFAULT_MAX_BYTES, DEFAULT_PORT };

/**
 * The CORS surface (ledger row 57). These four values ARE the contract a browser
 * sees, so they are named once here and pinned by name in `tests/cors.test.ts`.
 *
 * `authorization` is spelled out because the `Access-Control-Allow-Headers: *`
 * wildcard does NOT cover it — a preflight that names only `*` silently fails to
 * authorise the very header this API authenticates with.
 */
const CORS_ALLOW_METHODS = "GET, POST, PUT, PATCH, DELETE, OPTIONS";
const CORS_ALLOW_HEADERS = "authorization, x-api-key, content-type";
const CORS_EXPOSE_HEADERS = "x-serverstore-sha256";
const CORS_MAX_AGE_SECONDS = 600;

export interface AppDependencies {
  /** Root of every store's bytes. Lives OUTSIDE the repo (ledger row 13). */
  readonly dataRoot: string;
  /** The metadata database file. */
  readonly dbPath: string;
  /** Injectable clock, milliseconds since epoch. */
  readonly now?: () => number;
  /** Body size cap. An over-cap body fails the request; it is never truncated. */
  readonly maxBytes?: number;
  /**
   * The CORS allowlist (ledger row 57). `[CORS_WILDCARD]` — the default, and what an
   * unset `SERVERSTORE_CORS_ORIGINS` resolves to — answers any origin, which is safe
   * here because the API uses no cookies and no ambient credentials: the key is an
   * explicit header.
   */
  readonly corsOrigins?: readonly string[];
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

/**
 * THE public projection of a key — the entry `GET /keys` lists and `PATCH /keys/:id`
 * returns (ledger rows 46, 52).
 *
 * One function, so the two routes cannot drift and no key material can appear on one
 * and not the other. `prefix` is `ssk_` + the first 8 characters of the PUBLIC `id`
 * (the secret begins after the id, so it carries no secret byte); the raw key, its
 * secret half and its `sha256` are not in this shape and never will be.
 */
function keyEntry(key: AccessKeyRecord): {
  id: string;
  label: string;
  stores: readonly string[];
  prefix: string;
  perms: readonly Permission[];
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
} {
  return {
    id: key.id,
    label: key.label,
    stores: key.stores,
    prefix: key.prefix,
    perms: key.perms,
    createdAt: key.createdAt,
    expiresAt: key.expiresAt,
    lastUsedAt: key.lastUsedAt,
    revokedAt: key.revokedAt,
    // The EDIT stamp (pin E4): `null` on a never-edited key — the console says "never
    // changed" rather than inventing a time from `createdAt` — and otherwise when it
    // was last changed and by which (public) key id.
    updatedAt: key.updatedAt,
    updatedBy: key.updatedBy,
  };
}

export function createApp(dependencies: AppDependencies): Hono<{ Variables: Variables }> {  const deps: Required<AppDependencies> = {
    dataRoot: dependencies.dataRoot,
    dbPath: dependencies.dbPath,
    now: dependencies.now ?? (() => Date.now()),
    maxBytes: dependencies.maxBytes ?? DEFAULT_MAX_BYTES,
    corsOrigins: dependencies.corsOrigins ?? [CORS_WILDCARD],
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

  /**
   * CORS — registered BEFORE the key guard, and that ORDER is the whole reason this
   * step exists (ledger rows 56, 57). The guard matches EVERY path before routing, so
   * an `OPTIONS` preflight that reached it would be answered `401` and a browser on
   * another origin could never send the real request; an edge rule cannot fix that,
   * because a preflight needs a 2xx the origin owns. A preflight is therefore answered
   * HERE, with no key, and never reaches the guard. Every other request walks the
   * pipeline unchanged and gets its CORS headers on the way out.
   *
   * A DISALLOWED origin gets NO `Access-Control-Allow-Origin` and is NOT refused: CORS
   * is a browser-READ control, not the API perimeter (ledger row 21). `curl` ignores
   * it, and the key guard behind this step is what refuses an unkeyed call — so the
   * response is the guard's own 401, not a 403 invented here.
   *
   * `Access-Control-Allow-Credentials` is NEVER sent, on any response (pin O4): there
   * are no cookies in this API and there must never appear to be.
   */
  app.use("*", async (c, next) => {
    const origin = c.req.header("origin");
    const wildcard = deps.corsOrigins.includes(CORS_WILDCARD);
    // The value to echo: `*` under the wildcard policy, the CONCRETE origin when an
    // allowlist is in use (a browser needs an exact match once credentials — or any
    // origin-dependent answer — is in play), or `null` when this policy does not
    // answer for the caller's origin.
    const allowedOrigin =
      origin === undefined
        ? null
        : wildcard
          ? CORS_WILDCARD
          : deps.corsOrigins.includes(origin)
            ? origin
            : null;
    const isPreflight =
      c.req.method.toUpperCase() === "OPTIONS" &&
      c.req.header("access-control-request-method") !== undefined;

    if (isPreflight) {
      if (allowedOrigin === null) {
        // Fall through to the normal pipeline, which answers 401 without a key and
        // carries no allow-origin header. Deliberately NOT a 403: the browser is the
        // party that blocks this, and the API never refuses a caller over CORS.
        await next();
        return;
      }
      const headers: Record<string, string> = {
        "access-control-allow-origin": allowedOrigin,
        "access-control-allow-methods": CORS_ALLOW_METHODS,
        "access-control-allow-headers": CORS_ALLOW_HEADERS,
        "access-control-max-age": String(CORS_MAX_AGE_SECONDS),
        "access-control-expose-headers": CORS_EXPOSE_HEADERS,
      };
      if (!wildcard) headers.vary = "Origin";
      return c.body(null, 204, headers);
    }

    await next();
    if (allowedOrigin !== null) {
      c.res.headers.set("access-control-allow-origin", allowedOrigin);
    }
    // `Vary: Origin` whenever the ANSWER depends on the origin — i.e. whenever an
    // allowlist is in use. Under the `*` policy the answer is identical for every
    // origin, so the header would only fragment a cache for nothing.
    if (!wildcard) appendVary(c.res.headers, "Origin");
    c.res.headers.set("access-control-expose-headers", CORS_EXPOSE_HEADERS);
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
    // The ONE label rule (src/core/validate.ts `parseLabel`): an absent, non-string or
    // blank label means `DEFAULT_LABEL` — the same normalisation the edit route uses,
    // so the two granting doors cannot disagree about what "unlabelled" means.
    const label = parseLabel(body.label) ?? DEFAULT_LABEL;
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

  // THE SECOND GRANTING DOOR (ledger rows 51, 52): `PATCH /keys/:id` rewrites what a
  // key HOLDS without changing what it IS. It reuses the SAME boundary the mint route
  // above enforces — `Auth.requireAdmin()` for WHO may grant, `Auth.holdsStores()` for
  // the store boundary, and `parseStores`/`parsePermissions`/the label rule for
  // validation — so there is no second authorization path. The key's VALUE (`id`,
  // `key_hash`, `prefix`, `created_at`) is never written and no new raw key is made,
  // which is what turns "edit in place" into a fact (pin E6).
  app.patch("/keys/:id", async (c) => {
    const auth = c.get("auth");
    // WHO MAY EDIT is the row-39 predicate reached through this new door (pin E5),
    // decided BEFORE the body is read exactly as minting decides it.
    auth.requireAdmin("edit keys");
    const id = c.req.param("id");
    const body = await readJsonObject(c.req.raw, deps.maxBytes);

    // A body may carry ONLY the three editable fields, each optional. An unknown field
    // is refused BY NAME rather than ignored: a client written against a different
    // contract (the pre-slice-8 `store` field, say) must get neither a silent no-op nor
    // a PARTIAL edit (pin E7). `EDITABLE` is also what "no recognised field" is read
    // against, so the two halves of that pin cannot drift.
    const EDITABLE = ["label", "stores", "perms"] as const;
    const unknown = Object.keys(body).filter(
      (field) => !(EDITABLE as readonly string[]).includes(field),
    );
    if (unknown.length > 0) {
      throw new StoreError(
        "bad_request",
        `unknown field(s) ${unknown.map((field) => JSON.stringify(field)).join(", ")}; ` +
          `an edit may carry any subset of: ${EDITABLE.join(", ")}`,
      );
    }
    // Validation IDENTICAL to mint: the same scope parser, the same permission parser,
    // the same label rule. `undefined` means the field was OMITTED, and the row's
    // current value is kept — that is what makes an edit change EXACTLY what was given
    // (pin E1).
    const label = parseLabel(body.label);
    const stores = body.stores === undefined ? undefined : parseStores(body.stores);
    const perms = body.perms === undefined ? undefined : parsePermissions(body.perms);
    if (label === undefined && stores === undefined && perms === undefined) {
      throw new StoreError(
        "bad_request",
        `an edit must carry at least one of: ${EDITABLE.join(", ")}`,
      );
    }

    const target = findKeyById(ctx.db, id);
    if (target === null) {
      throw new StoreError("not_found", `no key with id ${JSON.stringify(id)}`);
    }
    // A REVOKED key cannot be edited back to life (pin E3): revocation is terminal, or
    // revoking a key (row 45) would mean nothing. Refused BEFORE any field decision, so
    // no part of the request is applied.
    if (target.revokedAt !== null) {
      throw new StoreError(
        "forbidden",
        `key ${id} is revoked (at ${target.revokedAt}) and cannot be edited; mint a new key instead`,
      );
    }

    const nextStores = stores ?? target.stores;
    const nextPerms = perms ?? target.perms;

    // THE BOUNDARY, in the same shape as the mint route: what the key would HOLD must
    // be something the CALLER could have minted (pin E2).
    if (auth.spansStores) {
      // A master may narrow or widen anything. Granting `admin` is still stricter than
      // editing at all: an edit that ADDS `admin` is an admin GRANT, and row 39's rule
      // says an admin grant is `["*"]` or it is refused. The check reads the CHANGE,
      // not the resulting set, so a key that already holds `admin` (a store-scoped
      // admin minted out of band, row 40) can still be renamed or narrowed by its
      // master; only a NEW admin grant is held to `["*"]`.
      if (
        nextPerms.includes("admin") &&
        !target.perms.includes("admin") &&
        !(nextStores.length === 1 && nextStores[0] === ALL_STORES)
      ) {
        throw new StoreError("forbidden", `an admin grant must be scoped to ["${ALL_STORES}"]`);
      }
    } else {
      // A store-scoped admin may edit only keys it could have minted — the rule the
      // revoke boundary already applies (row 46), reached through `holdsStores`, the
      // ONE containment predicate: the target must lie inside its own set and may not
      // hold `admin` (it could never have minted one), and the RESULT must obey the
      // same two rules, so it can neither grant `admin` nor widen a key into a store it
      // does not hold — nor DEMOTE a peer admin key, which the target rule already
      // refuses. One predicate, four readings, no second copy.
      if (!auth.holdsStores(target.stores)) {
        throw new StoreError(
          "forbidden",
          `key is scoped to ${describeStores(auth.key.stores)}; ` +
            `it may not edit a key scoped to ${describeStores(target.stores)}`,
        );
      }
      if (target.perms.includes("admin")) {
        throw new StoreError(
          "forbidden",
          `key is scoped to ${describeStores(auth.key.stores)}; ` +
            `only a master admin key may edit a key holding 'admin'`,
        );
      }
      if (!auth.holdsStores(nextStores)) {
        throw new StoreError(
          "forbidden",
          `key is scoped to ${describeStores(auth.key.stores)}; ` +
            `it may not grant ${describeStores(nextStores)}`,
        );
      }
      if (nextPerms.includes("admin")) {
        throw new StoreError(
          "forbidden",
          `key is scoped to ${describeStores(auth.key.stores)}; ` +
            `only a master admin key may grant 'admin'`,
        );
      }
    }

    // Every named store must already exist (the master scope has no names to check) —
    // the same check the mint route makes, BEFORE anything is written, so a refusal
    // leaves the key exactly as it was.
    for (const store of nextStores) {
      if (store !== ALL_STORES) requireStore(ctx.db, store);
    }

    const updated = editKey(ctx.db, {
      id,
      // The merged state: an omitted field keeps the row's value, so only what was
      // given changes (pin E1).
      label: label ?? target.label,
      stores: nextStores,
      perms: nextPerms,
      // The CALLER's own key id — an id the inventory already lists, never a secret.
      by: auth.key.id,
      now: deps.now,
    });
    return c.json(keyEntry(updated));
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
      .map(keyEntry);
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

/**
 * Add one name to a response's `Vary`, without ever OVERWRITING one already there.
 *
 * A `Vary` is a list: `headers.set("vary", "Origin")` on a response that already
 * varies by something else would drop that other dimension and let a cache serve the
 * wrong body. This app sets no other `Vary` today; the append is what keeps this
 * step from becoming the second place that forgets.
 */
function appendVary(headers: Headers, value: string): void {
  const existing = headers.get("vary");
  if (existing === null) {
    headers.set("vary", value);
    return;
  }
  const names = existing.split(",").map((name) => name.trim().toLowerCase());
  if (!names.includes(value.toLowerCase())) headers.set("vary", `${existing}, ${value}`);
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
