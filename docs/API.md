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

**Honest current status of the public name (measured 2026-09-27, ledger row 31):** the
deployed hostname resolves and the tunnel routes it, but a **zone-wide Cloudflare
Access policy** currently sits in front of it, so `https://store.futuremagic.de/healthz`
answers `302` to a Cloudflare Access login instead of `200`. That is a configuration
gap on the host, not an API behaviour: a client developer should expect a **302 to
`*.cloudflareaccess.com`** there until the owner's dashboard change lands, and can
always reach the service on loopback in the meantime. `probe-live.sh` distinguishes
this (exit 1) from a broken service.

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
  minted with an expiry (`expiresAt`); revoking a key today is an operator action on
  the box (there is no revoke route yet).
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

## Routes

All nine routes that exist. `{store}` and `{name}` are path placeholders. Request and
response bodies are JSON unless the row says otherwise.

| Method | Path | Who may call it | Request | Response | Statuses |
| --- | --- | --- | --- | --- | --- |
| `GET` | `/healthz` | anyone — no key required | — | `{"ok":true}` | `200` |
| `GET` | `/whoami` | any valid key — reports the CALLER | — | `{"id","label","stores","perms","expiresAt","lastUsedAt"}` | `200`, `401` |
| `GET` | `/stores` | master admin key | — | `{"stores":[{"name","kind","createdAt"}]}` | `200`, `401`, `403` |
| `POST` | `/stores` | master admin key | `{"name":"game","kind":"bytes"?}` | `{"store":{"name","kind","createdAt"}}` | `201`, `400`, `401`, `403`, `409` |
| `POST` | `/keys` | an **`admin`** key — a store-scoped admin key only within its own set; an `admin` grant needs a master admin key and `["*"]` | `{"stores":[…],"perms":[…],"label"?,"expiresAt"?}` | `{"key":"ssk_…","id","prefix","stores","perms","expiresAt"}` | `201`, `400`, `401`, `403`, `404` |
| `GET` | `/stores/{store}/objects` | `read` or `admin` on `{store}` | — | `{"objects":[{"store","name","sha256","size","createdAt"}]}` | `200`, `401`, `403`, `404` |
| `PUT` | `/stores/{store}/objects/{name}` | `write` or `admin` on `{store}` | raw bytes (any `content-type`; ignored) | `{"store","name","sha256","size","createdAt"}` | `201`, `400`, `401`, `403`, `404`, `413` |
| `GET` | `/stores/{store}/objects/{name}` | `read` or `admin` on `{store}` | — | raw bytes (+ `x-serverstore-sha256`) | `200`, `401`, `403`, `404` |
| `DELETE` | `/stores/{store}/objects/{name}` | `delete` or `admin` on `{store}` | — | empty body | `204`, `401`, `403`, `404` |

There is **no `405`**: an unknown path or an unsupported method on a known path is a
`404` with `{"error":{"code":"not_found",…}}`.

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
  a `400`, `403`, `404` or `413` leaves the store exactly as it was. (A blob from an
  *earlier successful* PUT of the same bytes may still be on disk — see the next
  point.)
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
8. **No revoke or rotate route.** Keys are minted over HTTP and by the operator's
   local command; revocation is an operator action on the box, and rotation is
   "mint a new key, stop using the old one" until a revoke route exists. `GET
   /whoami` **does** exist (above).
9. **No per-store permissions.** A key's `perms` apply to every store in its scope:
   "read on `a`, write on `b`" is not expressible yet (ledger row 41 records it as
   unproven). Mint a separate key per permission shape if you need that today.
10. **No key listing.** There is no route that lists the keys you hold; `POST /keys`
    and the operator's local command are the only ways to see one (once, at mint).
