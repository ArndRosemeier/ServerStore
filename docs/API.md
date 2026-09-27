# ServerStore — the client contract

This is the document a **client developer** reads. It describes the HTTP surface as
it exists today, checkably: `tests/api-doc.test.ts` derives the route list and the
error vocabulary from the running code and compares them to this file, so the tables
below cannot silently rot (pins **A1–A3**, `docs/TESTING.md`).

## What it is

ServerStore is a small self-hosted **multi-store object service**: named *stores*
(a store is a name plus a kind; today the only kind is `bytes`) each hold opaque
byte objects under string names. Every request is authenticated by an **access key**
— an opaque bearer token **scoped to a SET of stores** (or to `["*"]`, every store,
for a master key) and carrying a subset of `read`, `write`, `delete`, `admin`. There
is no user account, no session and no cookie: the key **is** the principal. It is one
Node process (Node 24, TypeScript, `node:sqlite` for metadata, content-addressed files
for bytes), it is meant for shared state between programs and players, and it is
deliberately small: an object is a name and a byte string, nothing more.

## Where it lives

| Environment | Base URL | Notes |
| --- | --- | --- |
| Deployed | `https://store.futuremagic.de` | HTTPS terminates at the Cloudflare tunnel; the service itself listens on loopback only |
| On the box | `http://127.0.0.1:8477` | The service is bound to loopback and is never reachable directly from another host |

**Reachability is a command, not an assumption** — run it from the repo checkout:

```bash
bash scripts/probe-live.sh <base-url>     # e.g. ... https://store.futuremagic.de
# exit 0 = PASS · exit 1 = FAIL · exit 2 = could not run
```

It performs exactly two checks and **never takes, prints or logs a key**: `GET
/healthz` must answer `200 {"ok":true}`, and an unauthenticated `GET /stores` must
answer `401`. Without the repo, the same two checks are:

```bash
curl -s -o /dev/null -w '%{http_code}\n' "$BASE/healthz"                 # expect 200
curl -s -o /dev/null -w '%{http_code}\n' "$BASE/stores"                  # expect 401
```

**Current status of the public name (re-measured 2026-09-27):** the deployed hostname
resolves, the tunnel routes it, and it answers the service **directly** —
`bash scripts/probe-live.sh https://store.futuremagic.de` → `PASS, exit 0` (`GET
/healthz` `200 {"ok":true}`, unauthenticated `GET /stores` `401` with the service's own
`unauthorized` envelope). The zone-wide Cloudflare Access policy that used to answer
`302` to a `*.cloudflareaccess.com` login was removed for this hostname by the owner
(ledger rows 31 → 43), so **the access key is the only perimeter here**: nothing in
front of the service authenticates a caller. `probe-live.sh` distinguishes a broken
service (exit 1) from a probe that could not run (exit 2).

## The admin UI (no build, same origin)

The service also serves a small **admin console** at the root of the same origin
(`https://store.futuremagic.de/`, or `http://127.0.0.1:8477/` on the box): enter a
master key, see what that key is, list and create stores, list keys, mint one (shown
once), **edit one in place** (rename, stores, permissions — the key's value is never
shown again and never changes), and revoke one. Each row also shows **when it was last
changed and by which key** ("never changed" until an edit happens). It is plain HTML,
one ES module and one stylesheet — **no build step, no bundler, no framework** — served
from `web/` at three **literal** routes (`/`, `/app.js`, `/app.css`); there is no
static-file subsystem, no directory walking, and no other path is served.

- **The key lives in a JavaScript variable for the life of the page.** It is never
  written to `localStorage`, `sessionStorage`, a cookie, the URL, `history` or the
  console, and a reload forgets it — "Forget key" clears it immediately. The page
  itself carries no secret.
- **Same origin is the whole point** (ledger row 48): the browser calls this API with
  `fetch` on its own origin, so there is no CORS and the key never crosses an origin.
- **Nothing is fetched until the key is proven.** The console calls `GET /whoami`
  first and shows what the key is (label, scope, permissions) or the refusal; every
  later call presents the key in the `Authorization` header.
- **Errors are rendered, not swallowed**: the `{error:{code,message}}` envelope is
  shown in the page, code and message both.
- **It is the operator's console, not a client API.** The paths it calls are pinned to
  the routes below (pin U3), and its behaviour inside a real browser is **not**
  exercised by any automated check yet — a headless-browser test is owed
  (`docs/TESTING.md`, honest unknowns).

## Authentication

Every route except `GET /healthz` requires a key. Present it either way:

```http
Authorization: Bearer ssk_<id>_<secret>
```

```http
x-api-key: ssk_<id>_<secret>
```

If both headers are present, `Authorization` wins. The header is the **only** place a
key belongs: never put a key in a query string, a URL path, a `Referer`-visible page,
or a log line — it would end up in access logs and browser history.

- **A key is shown exactly once**, in the `201` response of `POST /keys` (or from the
  operator's local mint command). Only `sha256(key)` is stored. **A key can never be
  read back**: a lost key is *replaced*, not recovered — mint a new one. Keys may be
  minted with an expiry (`expiresAt`) and revoked through `POST /keys/{id}/revoke`
  (admin-only; see Routes). Revocation takes effect on the **next request** — there is
  no cache to invalidate and no restart.
- **`401 unauthorized`** — no key was presented, or the presented key is **unknown,
  revoked or expired**. The three are deliberately indistinguishable to the caller;
  do not try to tell them apart.
- **`403 forbidden`** — the key **verified**, but it is not permitted for that store
  or that operation. The key is real; the permission is not there.
- **Permissions** are exactly `read`, `write`, `delete`, `admin`; `admin` **implies
  all of them**. What each operation needs:

  | Operation | Permission required |
  | --- | --- |
  | `GET /stores/{store}/objects`, `GET …/objects/{name}` | `read` or `admin` |
  | `PUT …/objects/{name}` | `write` or `admin` |
  | `DELETE …/objects/{name}` | `delete` or `admin` |
  | `GET /stores`, `POST /stores` | a **master admin** key: scope `["*"]` **and** `admin` |
  | `GET /keys`, `POST /keys/{id}/revoke`, `PATCH /keys/{id}` | an **`admin`** key — see "Who may list and revoke" and "Who may edit" |

- **A key's scope is a SET of stores.** At mint time you name the stores the key may
  touch (`"stores": ["game", "notes"]`), or `["*"]` for **every store** — the master
  case. `["*"]` also covers stores created *after* the key was minted; a named set is
  exactly those stores. Every request is checked against that set: a key is refused
  `403 forbidden` for a store outside it, and the message names the key's actual scope.
  A key's own scope is reported by `GET /whoami`.
- **A `*` + `admin` key is a master admin**: it may administer stores and mint keys.
  Via `POST /keys`, an `admin` grant is only ever issued by a master admin, and only
  for scope `["*"]`.
- **There is no identity beyond the key.** A player pasting a key is not "logged in":
  the server keeps no session, and `last_used_at` on the key row is the only audit
  trail. Treat every key as a password.
- **Who may mint: only a key that holds `admin`.** `POST /keys` refuses every other key
  with `403 forbidden` ("only an admin key may mint keys") **before anything is
  minted** — a read-only key cannot mint even a read-only key, so **every key traces
  back to an admin action** (the operator's UI, or a game backend he handed an admin key
  for its stores). An admin key **scoped to a set of stores** is the **game-backend
  flow**: it may mint keys **for stores inside its own set only**, and is the kind of key
  an operator mints on the box with `pnpm run admin:key --store <store> --perms admin`
  (repeat `--store` for a set). A **master admin** key
  (`["*"]` + `admin`) may mint any non-`admin` permission for any existing store — the
  operator's bootstrap path. Granting `admin` is stricter than minting at all: it
  requires a **master admin caller and scope `["*"]`**, so neither a scoped admin key
  nor any non-admin key can create another admin. A request refused for any of these
  reasons mints nothing (no key row, no scope row, no side effect).
- **Who may LIST and REVOKE.** Both lifecycle routes need a key that holds `admin`.
  A **master admin** (`["*"]` + `admin`) lists every key and may revoke any key,
  including another master's. A **store-scoped admin** lists only the keys whose scope
  lies **inside its own set** — so it never sees another master, nor a key touching a
  store it does not hold — and may revoke only keys **it could have minted**: scope
  inside its own set and never a key holding `admin`. **A key may always revoke
  itself**, which is the one deliberate exception, and it takes effect immediately.
- **Who may EDIT: the same rule, through a second door.** `PATCH /keys/{id}` rewrites
  what a key **holds** — its `label`, its `stores`, its `perms` — and **never its
  value**: the same raw key keeps working, so a widening takes effect on whoever already
  holds it and a narrowing is how you take something back short of revoke-and-mint. It
  needs a key that holds `admin`, and a **store-scoped admin** may edit only a key it
  could have minted — scope inside its own set, target not holding `admin`, result not
  holding `admin` and not reaching a store it does not hold. A **master admin** may
  narrow or widen anything; only a master may **grant** `admin`, and only with scope
  `["*"]`. **A revoked key cannot be edited** (`403`): revocation is terminal. An edit
  that succeeds stamps `updatedAt`/`updatedBy` (see `GET /keys`).

## Routes

Every route that exists. `{store}` and `{name}` are path placeholders. Request and
response bodies are JSON unless the row says otherwise.

| Method | Path | Who may call it | Request | Response | Statuses |
| --- | --- | --- | --- | --- | --- |
| `GET` | `/healthz` | anyone — no key required | — | `{"ok":true}` | `200` |
| `GET` | `/` | anyone — no key required | — | the admin console (HTML) | `200` |
| `GET` | `/app.js` | anyone — no key required | — | the admin console's ES module (`text/javascript`) | `200` |
| `GET` | `/app.css` | anyone — no key required | — | the admin console's stylesheet (`text/css`) | `200` |
| `GET` | `/whoami` | any valid key — reports the CALLER | — | `{"id","label","stores","perms","expiresAt","lastUsedAt"}` | `200`, `401` |
| `GET` | `/stores` | master admin key | — | `{"stores":[{"name","kind","createdAt"}]}` | `200`, `401`, `403` |
| `POST` | `/stores` | master admin key | `{"name":"game","kind":"bytes"?}` | `{"store":{"name","kind","createdAt"}}` | `201`, `400`, `401`, `403`, `409` |
| `POST` | `/keys` | an **`admin`** key — a store-scoped admin key only within its own set; an `admin` grant needs a master admin key and `["*"]` | `{"stores":[…],"perms":[…],"label"?,"expiresAt"?}` | `{"key":"ssk_…","id","prefix","stores","perms","expiresAt"}` | `201`, `400`, `401`, `403`, `404` |
| `GET` | `/keys` | an **`admin`** key — a master admin sees every key, a store-scoped admin only keys inside its own set | — | `{"keys":[{"id","label","stores","prefix","perms","createdAt","expiresAt","lastUsedAt","revokedAt","updatedAt","updatedBy"}]}` | `200`, `401`, `403` |
| `PATCH` | `/keys/{id}` | an **`admin`** key — a master admin may narrow or widen anything, a store-scoped admin only keys it could have minted | `{"label"?,"stores"?,"perms"?}` (any subset) | the updated entry, exactly as `GET /keys` lists it | `200`, `400`, `401`, `403`, `404` |
| `POST` | `/keys/{id}/revoke` | an **`admin`** key — a master admin may revoke any key, a store-scoped admin only keys it could have minted; a key may always revoke itself | — (no body) | `{"id","revokedAt","changed"}` | `200`, `401`, `403`, `404` |
| `GET` | `/stores/{store}/objects` | `read` or `admin` on `{store}` | — | `{"objects":[{"store","name","sha256","size","createdAt"}]}` | `200`, `401`, `403`, `404` |
| `PUT` | `/stores/{store}/objects/{name}` | `write` or `admin` on `{store}` | raw bytes (any `content-type`; ignored) | `{"store","name","sha256","size","createdAt"}` | `201`, `400`, `401`, `403`, `404`, `413` |
| `GET` | `/stores/{store}/objects/{name}` | `read` or `admin` on `{store}` | — | raw bytes (+ `x-serverstore-sha256`) | `200`, `401`, `403`, `404` |
| `DELETE` | `/stores/{store}/objects/{name}` | `delete` or `admin` on `{store}` | — | empty body | `204`, `401`, `403`, `404` |

There is **no `405`**. An unknown path or an unsupported method on a known path answers
**`401` `unauthorized` when the request carries no valid key** — the key guard matches EVERY
path before routing, so the API never reveals which routes exist — and `404`
`{"error":{"code":"not_found",…}}` once a valid key is presented.

### Names

Store names and object names use the **same** rule:

- `[a-z0-9][a-z0-9._-]{0,63}` — lowercase letters, digits, `.`, `_`, `-`; 1 to 64
  characters; must start with a letter or digit.
- `.` or `..` as a whole name is refused, as is a leading `.` or `/`. A name that
  *contains* two dots (`a..b`) is legal.
- Any URL path carrying a `.` or `..` **segment** (raw or percent-encoded) is refused
  as `400 invalid_name` before routing. Names are parsed, never sanitised into a
  different name.

A **`PUT` of an existing name overwrites** it (the response is `201` with the new
`sha256`/`size`/`createdAt`). There is no create-only variant.

### Route details

- **`GET /stores`** — every store, ordered by name. `master` always exists (seeded at
  boot). A store returns `{"name":"…","kind":"bytes","createdAt":"<ISO-8601>"}`.
- **`POST /stores`** — `name` required; `kind` optional, and `"bytes"` is the only
  value that exists today; an absent `kind` means `bytes`. `409 store_exists` if the
  name is taken. The response is `201` with the new store.
- **`GET /whoami`** — the **caller's own** key, for a client that needs to know which
  player it is holding a key for. Fields:
  - `id` — the key's public lookup id (the same value `POST /keys` returned).
  - `label` — the operator's label for the key.
  - `stores` — the key's scope: `["*"]` for a master key, otherwise the store names it
    may touch, sorted.
  - `perms` — the key's permissions, in the canonical order.
  - `expiresAt` — the key's expiry, or `null`.
  - `lastUsedAt` — when the key was last used, **including this request** (it is
    updated on every authenticated request, so it is never older than the response).

  **No secret is ever in this body** — not the raw key, not its hash, not its prefix.
  Without a key the route is `401 unauthorized`, like every route except `/healthz`.
- **`POST /keys`** — the request body:
  - `stores` (**required**, non-empty array) — the key's scope. Either `["*"]` alone
    (every store: the **master** case) or a list of store names. A single-element list
    is a normal, legal scope. The list may not be **empty** (`400 invalid_scope`), may
    not **mix** `"*"` with names (`400 invalid_scope`), and may not repeat a store
    (`400 invalid_scope`). Every named store must already exist (`404 not_found`).
    The OLD single-string field is gone: a body carrying `"store"` is refused
    `400 bad_request`, naming `stores`, rather than silently scored as one store.
  - `perms` (**required**, non-empty array) — a subset of `read|write|delete|admin`.
    The stored order is always `read,write,delete,admin`. Only an **`admin`** key may
    mint at all (see Authentication): any other key is `403 forbidden` and **no key is
    minted**. An `admin` value additionally requires a **master admin** caller and
    `stores: ["*"]`.
  - `label` (optional string; defaults to `"unlabelled"`).
  - `expiresAt` (optional ISO-8601 string or `null`) — after this instant the key is
    refused with `401`.

  Every requested store must lie **inside the minter's own set**: a store-scoped admin
  key may mint only for stores it already holds (`403 forbidden` naming both sets),
  and may not escape to `["*"]`. A refusal mints nothing.

  The `201` body is `{"key":"ssk_…","id","prefix","stores","perms","expiresAt"}`.
  `stores` is always the canonical scope (`["*"]`, or the names sorted). **The
  `key` field is the raw key. It is returned here and nowhere else, ever.**
- **`GET /keys`** — the key inventory, ordered by creation then id. **Admin-only.**
  Each entry has exactly these fields:
  - `id` — the key's public lookup id (the same value `POST /keys` returned).
  - `label` — the operator's label for the key.
  - `stores` — the key's scope: `["*"]` for a master key, otherwise the store names it
    may touch, sorted.
  - `prefix` — the stored **display** prefix: `ssk_` plus the first 8 characters of
    `id` (12 characters, the same string `POST /keys` returned). It is **not** key
    material — the secret begins after the id, so this contains no byte of it — and it
    is returned so a console shows the handle the operator saw at mint without
    re-deriving it.
  - `perms` — the key's permissions, in the canonical order.
  - `createdAt`, `expiresAt`, `lastUsedAt`, `revokedAt` — ISO-8601, or `null`.
  - `updatedAt`, `updatedBy` — the **edit audit stamp**: when the key's grant was last
    changed by `PATCH /keys/{id}`, and the **id** of the key that changed it (the same
    public id this inventory lists, never a secret). Both are `null` on a key that has
    never been edited — do not read `createdAt` as "when it changed".

  **Revoked keys are listed**, with `revokedAt` set, so the inventory doubles as the
  audit view (`lastUsedAt` is the only per-key usage record). **The raw key, its secret
  and its `sha256` are never in this body.** There is **no pagination**, and no filter,
  sort or search parameter: the population is the operator's keys and one response is
  the whole inventory. A store-scoped admin sees only the keys whose scope lies inside
  its own set. `401` without a key; `403` for a valid key that does not hold `admin`.
- **`PATCH /keys/{id}`** — **edit a key in place.** Rewrites what the key **holds** and
  leaves what it **is** alone: `id`, `prefix`, `keyHash`/the stored hash and `createdAt`
  are untouched, and **no new key is issued** — the raw key the holder already has keeps
  working, with the new grant. The body may carry **any subset** of the three editable
  fields; every omitted field is left **unchanged**:
  - `label` (string) — the operator's name for the key. A present but blank or
    whitespace-only label means `"unlabelled"`, exactly as at mint.
  - `stores` (array) — the new scope, validated exactly as at mint: `["*"]` alone for
    every store, or a non-empty list of distinct, existing store names. The list
    **replaces** the old scope; it is not merged with it.
  - `perms` (array) — the new permissions, a non-empty subset of
    `read|write|delete|admin`, stored in the canonical order.

  **Anything else is refused `400` and nothing changes**: an empty object (no recognised
  field), an unknown field (including the pre-slice-8 `store`), a non-object body, a
  malformed `stores`/`perms`, or a store that does not exist (`404 not_found` for a
  missing store). An unknown field beside a valid one refuses the **whole** request —
  a field is never silently dropped while the rest is applied.

  **Authorization** is the same boundary as minting. A key that does not hold `admin` is
  refused `403 forbidden` ("only an admin key may edit keys"), before the key is even
  looked up. A **store-scoped admin** may edit only a key it could have minted: the
  target's scope must lie inside its own set, the target may not hold `admin`, and the
  **result** must obey both too — so it can neither grant `admin` nor widen a key into a
  store it does not hold (nor demote a peer admin key). A **master admin** may narrow or
  widen anything; an edit that **adds** `admin` is an admin grant and requires scope
  `["*"]` — a rename of a key that already holds `admin` is not held to that rule.

  **A revoked key cannot be edited**: the route answers `403 forbidden` naming the
  revocation instant, and `revokedAt` never moves. Undoing a revocation means minting a
  new key.

  The `200` body is the updated entry, in exactly the shape `GET /keys` lists
  (`id`, `label`, `stores`, `prefix`, `perms`, `createdAt`, `expiresAt`, `lastUsedAt`,
  `revokedAt`, `updatedAt`, `updatedBy`) — **no key material**, and `updatedAt`/`updatedBy`
  now carry the stamp of this edit (`updatedBy` is the **caller's** id).
- **`POST /keys/{id}/revoke`** — revoke a key. **Admin-only** and **idempotent**. The
  request carries **no body** (one is ignored), and the response is
  `{"id","revokedAt","changed"}`: `changed` is `true` the first time and `false`
  afterwards, and `revokedAt` is the timestamp **stored on the row** — a second call
  never moves it. An unknown `id` is `404 not_found`. A **master admin** may revoke any
  key, including another master's. A **store-scoped admin** may revoke only a key it
  could have minted: a scope inside its own set (`403` otherwise) and not a key holding
  `admin` (`403`).

  **A key may revoke itself** — it is the caller's own credential, and the scope rules
  do not apply to it. This takes effect on the **next request**: any later call with
  that key is `401`, with no cache and no restart. Plan for it — revoking the last admin
  key leaves the store administrable only by a key minted from the box
  (`pnpm run admin:key`). **No key material is in the response.**
- **`GET /stores/{store}/objects`** — all objects in the store, ordered by name.
  Fields: `store`, `name`, `sha256` (the content address), `size` (bytes),
  `createdAt`. No pagination: a store with many objects returns them all.
- **`PUT /stores/{store}/objects/{name}`** — the body **is** the object, byte for
  byte; `content-type` is ignored and nothing is parsed. An **empty body is refused**
  (`400 invalid_body`) — a PUT never creates an empty object. The `201` body reports
  `sha256` (lowercase hex of the stored bytes), `size`, and `createdAt`.
- **`GET /stores/{store}/objects/{name}`** — the exact bytes that were PUT, with
  `content-type: application/octet-stream`, `content-length`, and
  `x-serverstore-sha256` (the same sha256 the PUT response reported; verify it if you
  care about integrity end to end).
- **`DELETE /stores/{store}/objects/{name}`** — `204` with an empty body. Deleting a
  name that does not exist is `404`. **The bytes are not reclaimed** (see Non-goals).

## Errors

Every failure is one JSON envelope:

```json
{"error":{"code":"not_found","message":"no object \"room-1\" in store \"game\""}}
```

`code` is stable and safe to branch on; `message` is for humans and **may change**.
Every code in the service's vocabulary is below, with the HTTP status it carries and
what a client should do about it:

| Code | HTTP | What it means, and what to do |
| --- | --- | --- |
| `bad_request` | `400` | The request was understood but malformed — e.g. an unknown `kind`, an unknown permission, an unparseable `expiresAt`. Fix the request; retrying it unchanged will fail again. |
| `invalid_name` | `400` | A store/object name failed the charset rule, or the path carried a `.`/`..` segment. Fix the name; do not try to encode around it. |
| `invalid_body` | `400` | A JSON body was missing, empty, not valid JSON, not a JSON object, or a `PUT` carried no bytes. Send a JSON object / non-empty body. |
| `invalid_scope` | `400` | A key scope (`stores`) was not a legal set: not an array, empty, mixing `"*"` with store names, or naming the same store twice. Send `["*"]` alone, or a non-empty list of distinct store names. |
| `payload_too_large` | `413` | The request body exceeded `SERVERSTORE_MAX_BYTES`. The body was **not** stored (never truncated). Send less. |
| `unauthorized` | `401` | No key, or the key is unknown/revoked/expired. Present a valid key; if you had one, it is gone — mint a replacement. |
| `forbidden` | `403` | A valid key that is not permitted for this store, operation or scope. Use a key whose `stores` include this store and whose `perms` include the operation; retrying will not help. |
| `not_found` | `404` | No such store, no such object, or no such route/method. Create the store, check the name, or fix the path. |
| `store_exists` | `409` | `POST /stores` with a name already in use. Pick another name (or treat it as success after `GET /stores`). |
| `name_taken` | `409` | **Reserved.** No route emits this code today; it exists in the vocabulary. Treat it as "pick another name". |
| `unsupported_store_kind` | `500` | The store's registered kind has no handler in the running process. Server-side; report it to the operator. |
| `internal` | `500` | An unexpected server-side failure. Do not assume the write did or did not happen — re-`GET` the object to find out, then retry or report. |

## Limits

| Knob | Default | Meaning |
| --- | --- | --- |
| `SERVERSTORE_MAX_BYTES` | `67108864` bytes (64 MiB) | The maximum request body, enforced per request. It is an operator setting on the host, not a per-request field. |

- A body over the cap is refused with **`413 payload_too_large`**; it is **never
  truncated** and **never partially stored**.
- **A failing request writes nothing.** Bytes and the metadata row are written only
  after the whole body has been read and the name/authorisation checks have passed, so
  a `400`, `403`, `404` or `413` leaves the store exactly as it was — and a refused
  `PATCH /keys/{id}` leaves the key, its scope rows and its audit stamp unchanged. (A
  blob from an *earlier successful* PUT of the same bytes may still be on disk — see the
  next point.)
- A `DELETE` removes the object's metadata row and **leaves the stored bytes on disk**.
  There is no garbage collection yet.
- There is no rate limit and no documented request timeout at the application layer.

## First five minutes (curl)

Two placeholders, never a real secret in a script or a shell history: `$BASE` (the
base URL) and `$ADMIN_KEY` (a master admin key, minted **on the box** by the operator
with `pnpm run admin:key`). Step 2 mints a per-player key — copy it into
`$PLAYER_KEY` immediately; it is shown once and is not recoverable.

```bash
export BASE=https://store.futuremagic.de        # or http://127.0.0.1:8477 on the box
export ADMIN_KEY=ssk_...                        # the operator holds this, not the client

# 0. Is it up? (no key needed)
curl -s "$BASE/healthz"
# {"ok":true}

# 1. Create a store for the game.
curl -s -X POST "$BASE/stores" \
  -H "Authorization: Bearer $ADMIN_KEY" -H 'content-type: application/json' \
  -d '{"name":"game"}'
# {"store":{"name":"game","kind":"bytes","createdAt":"2026-09-27T20:24:33.498Z"}}

# 2. Mint one key per player, scoped to a SET of stores. THE KEY IN THIS RESPONSE IS THE ONLY TIME IT IS EVER SHOWN.
curl -s -X POST "$BASE/keys" \
  -H "Authorization: Bearer $ADMIN_KEY" -H 'content-type: application/json' \
  -d '{"stores":["game"],"perms":["read","write","delete"],"label":"player-1"}'
# {"key":"ssk_…","id":"…","prefix":"ssk_…","stores":["game"],"perms":["read","write","delete"],"expiresAt":null}
export PLAYER_KEY=ssk_...                       # from the line above, once

# 3. Write an object (the body IS the object — JSON here, any bytes in general).
curl -s -X PUT "$BASE/stores/game/objects/room-1" \
  -H "Authorization: Bearer $PLAYER_KEY" \
  --data-binary '{"score":7}'
# {"store":"game","name":"room-1","sha256":"60ba8907…b395","size":11,"createdAt":"…"}

# 4. Read it back byte for byte.
curl -s "$BASE/stores/game/objects/room-1" -H "Authorization: Bearer $PLAYER_KEY"
# {"score":7}   (content-type: application/octet-stream, plus x-serverstore-sha256)

# 5. List the store.
curl -s "$BASE/stores/game/objects" -H "Authorization: Bearer $PLAYER_KEY"
# {"objects":[{"store":"game","name":"room-1","sha256":"…","size":11,"createdAt":"…"}]}

# 6. Delete it (204, empty body).
curl -s -o /dev/null -w '%{http_code}\n' -X DELETE "$BASE/stores/game/objects/room-1" \
  -H "Authorization: Bearer $PLAYER_KEY"
# 204
```

`x-api-key: $PLAYER_KEY` works in place of every `Authorization: Bearer` above.

A caller can always ask which key it is holding — the answer carries no secret:

```bash
# 7. Who am I? (id, label, the scope this key may touch, its permissions)
curl -s "$BASE/whoami" -H "Authorization: Bearer $PLAYER_KEY"
# {"id":"…","label":"player-1","stores":["game"],"perms":["read","write","delete"],"expiresAt":null,"lastUsedAt":"2026-09-27T20:31:02.114Z"}
```

The operator, holding `$ADMIN_KEY`, can see and revoke keys. Neither response carries
key material:

```bash
# 8. The key inventory (admin only; revoked keys included, no secrets).
curl -s "$BASE/keys" -H "Authorization: Bearer $ADMIN_KEY"
# {"keys":[{"id":"…","label":"player-1","stores":["game"],"prefix":"ssk_…","perms":["read","write","delete"],"createdAt":"…","expiresAt":null,"lastUsedAt":"…","revokedAt":null}]}

# 9. Revoke a key (admin only, idempotent; effective on the NEXT request).
curl -s -X POST "$BASE/keys/<id>/revoke" -H "Authorization: Bearer $ADMIN_KEY"
# {"id":"<id>","revokedAt":"2026-09-27T20:40:00.000Z","changed":true}

# 10. Edit a key IN PLACE — rename it, and/or rewrite its stores and permissions.
#     The key itself is unchanged: the holder keeps using the same key. Omitted
#     fields are left alone; send "label":"" to reset it to "unlabelled".
curl -s -X PATCH "$BASE/keys/<id>" -H "Authorization: Bearer $ADMIN_KEY" \
  -H 'content-type: application/json' \
  -d '{"label":"key for Tom","stores":["game","notes"],"perms":["read","write"]}'
# {"id":"<id>","label":"key for Tom","stores":["game","notes"],"prefix":"ssk_…",
#  "perms":["read","write"],"createdAt":"…","expiresAt":null,"lastUsedAt":"…",
#  "revokedAt":null,"updatedAt":"2026-09-27T21:10:00.000Z","updatedBy":"<your key id>"}
```

## Non-goals (read this before you design around it)

These are **not** implemented today. A client that assumes them will break:

1. **No garbage collection.** `DELETE` removes the row and leaves the blob on disk.
   Deleted data still occupies space (and, being content-addressed, an identical PUT
   later reuses it).
2. **No concurrency control.** A `PUT` is an unconditional overwrite. Two writers
   racing one name lose one update (last write wins); there is **no** `ETag`,
   `If-Match`, version number or compare-and-swap. If two players must not clobber
   each other, serialise on one writer (or one key per object) in your client
   (ledger row 28).
3. **No CORS.** The service sends no `Access-Control-Allow-*` headers and has no
   preflight handling, so a browser page served from a **different origin** cannot
   call it directly with `fetch`. A same-origin page, a server-side proxy, or a
   non-browser client can.
4. **No rate limiting** and no per-key quota. Nothing throttles a determined client.
5. **No identity beyond keys.** No registration, login, sessions, cookies, OAuth or
   users. A key pasted into a browser belongs to whoever reads it, and the server
   cannot tell two holders of the same key apart.
6. **No bulk, range or streaming APIs.** One object per request; `GET` always returns
   the whole body (no `Range`); lists are unpaginated and have no `since=` filter;
   there are no multi-object transactions.
7. **No server-side format.** Objects are opaque bytes; the service never parses or
   validates their contents.
8. **No ROTATION route.** There **is** a revoke route (`POST /keys/{id}/revoke`,
   admin only), but rotation is a client-side convention: mint a new key, move the
   client, then revoke the old one. Nothing revokes the old key for you when a new one
   is minted, and nothing warns you that a key is about to expire.
9. **No per-store permissions.** A key's `perms` apply to every store in its scope:
   "read on `a`, write on `b`" is not expressible yet (ledger row 41 records it as
   unproven). Mint a separate key per permission shape if you need that today.
10. **No key listing for a CALLER, and no pagination on the inventory.** `GET /keys`
    is the **operator's** inventory and is admin-only; a caller cannot enumerate keys,
    it asks `GET /whoami` about the one it holds. The inventory has no pagination,
    filter, sort or search parameter, and it does not page.
11. **No edit HISTORY, and no editing of `expiresAt`.** `PATCH /keys/{id}` records only
    the LAST change (`updatedAt` + `updatedBy`); there is no event log, so what a key
    used to hold is not recoverable through the API. `expiresAt` is set at mint time and
    cannot be changed by an edit (ledger row 52 records both as deferred).
