# The seam index — the one way to do X

**Start here.** When one idea is implemented twice, this file should have prevented
it. Each entry says the ONE place a thing lives, and why it is there.

Written on 2026-09-27 with the first feature slice (ledger row 19). Behaviour is not
restated here — the test **is** the statement, and `docs/TESTING.md` names the pins.

## The ONE seam: the request pipeline

```
request
  └─ path guard            src/server/app.ts          (raw target, before routing)
       └─ CORS step        src/server/app.ts          (BEFORE the key guard: a preflight needs a keyless 2xx)
            └─ rate limit  src/server/ratelimit.ts     (AFTER CORS, BEFORE the key guard: bounds an UNKEYED flood)
                 └─ resolve key src/core/keys.ts      resolveKey() — loads the key AND its scope once
                      └─ authorize   src/server/app.ts     Auth.authorize() / requireAdmin() / requireMasterAdmin()
                           └─ dispatch to the store kind  src/storage/kinds.ts   handlerFor(kind)
                                └─ storage                src/storage/fs.ts    bytes on disk
```

**The CORS step is the ONE place a browser on another origin is answered, and it sits
BEFORE the key guard on purpose** (ledger row 57). The guard matches EVERY path before
routing, so a preflight (`OPTIONS` + `Access-Control-Request-Method`) that reached it
would be answered `401` and the browser would block the real request — and no edge rule
can fix that, because a preflight needs a 2xx the ORIGIN owns. The step is middleware,
not a route: it adds no entry to `createApp().routes`, so PIN A1's route table is
unchanged. A disallowed origin is NOT refused there — CORS is a browser-READ control,
and the key guard behind it remains the perimeter (ledger row 21).

**The rate-limit step sits BETWEEN the CORS step and the key guard, and BOTH halves of
that position are load-bearing** (ledger rows 64, 65). BEFORE the guard, because a limiter
behind authentication bounds only callers who already hold a key, while the flood a public
endpoint actually faces is the one with NO key — and the key comparison is the work worth
protecting. AFTER CORS, because the CORS step is what sets `Access-Control-Allow-Origin` and
`Access-Control-Expose-Headers` on the way out, which is how a browser can READ a `429`'s
`Retry-After`. The step is middleware, not a route: `createApp().routes` is unchanged, so
PIN A1's route table is unchanged. A refusal is answered THERE (`c.json` with the one error
envelope), so it never reads the body and never reaches a handler — a 429 has no side
effects, which PIN R2 proves with a refused `PUT`. The exemptions (`/healthz`, the three UI
assets and CORS preflights) and the identity order live in ONE module,
`src/server/ratelimit.ts`, and the exempt asset paths are DERIVED from `UI_ASSETS`.

Everything the project will ever do is either **core** (a step above `dispatch`) or a
**store kind** (a handler at `dispatch`). There is no third mechanism.

**The `POST /keys` authorization decision is the `authorize` step applied to a GRANT**,
not a separate path: it enforces WHO may mint (a key that holds `admin` — ledger row 39)
and the store boundary (a scoped key mints only within its own SET of stores) in ONE
branch of the route handler — see the "Who may MINT" row below. A key without `admin` is
refused `403 forbidden` **before the body is read**, and the slice-6 subset rule it used
to carry was **DELETED as unreachable** (an `admin` key implies every permission, so a
subset check could never fire). There is no second authorization middleware.

**The key LIFECYCLE (`GET /keys`, `POST /keys/:id/revoke`) is the SAME decision applied
to the other two halves of key administration** (ledger row 46): `Auth.requireAdmin(action)`
is the one "who may administer keys" predicate shared by mint, list and revoke, and
`Auth.holdsStores(stores)` is the one scope-CONTAINMENT predicate shared by the mint
boundary, the list filter and the revoke boundary. Neither route invents a second path,
and neither emits key material.

**`PATCH /keys/:id` is the SECOND WAY TO GRANT PERMISSIONS, and it is the SAME decision**
(ledger rows 51, 52): `Auth.requireAdmin("edit keys")` is that same "who may administer
keys" predicate, `Auth.holdsStores(stores)` is that same ONE containment predicate (read
four ways — the target's scope, the target's `admin`, the resulting scope, the resulting
`admin`), and `parseStores`/`parsePermissions`/the label rule are the parsers mint uses.
The route decides WHO may edit and to WHAT; `src/core/keys.ts editKey()` is the one place
the new grant is WRITTEN, in one transaction, and it never names `id`, `key_hash`,
`prefix` or `created_at` — so the key's VALUE survives the edit (pin E6).

**PREREQUISITE (do not lose this): any future slice that lets a NON-admin key mint MUST
reinstate the subset rule — "a key may pass on only what it holds" — in the SAME commit.**
Until then `requireAdmin()` is the ONLY thing between a read-only key and the write+delete
escalation of ledger row 35, because the permissions of the key being minted are not
checked against the minter's at all (the minter holds `admin`, which implies them all).

| Concern | The one place | Notes |
| --- | --- | --- |
| HTTP app, built from injected deps | `src/server/app.ts` `createApp({dataRoot, dbPath, now, maxBytes, corsOrigins, rateLimit})` | Tests drive it with `app.request()`; no port is bound outside `main.ts`. An app built WITHOUT `rateLimit` gets `DEFAULT_RATE_LIMIT` (600/60 s), never "unlimited" — the ONE fixture passes `0` explicitly. |
| The only env read | `src/server/config.ts` `resolveConfig()` | Called by `main.ts` and the admin CLI, never at module import time. It parses AND validates `SERVERSTORE_CORS_ORIGINS` (`parseCorsOrigins()`): a bare origin per entry, unset = `*`, and a value that could never match a request fails the BOOT loudly rather than silently matching nothing. It parses AND validates `SERVERSTORE_RATE_LIMIT` (`parseRateLimit()`): unset = 600, `0` = disabled, and any other non-integer/negative value — including SET-but-EMPTY, which `Number("")` would silently read as "disabled" — fails the BOOT loudly. |
| **The CORS policy** (which browser origins may read this API) | `src/server/config.ts` `parseCorsOrigins()` for the allowlist; the step itself is the `app.use("*", …)` registered in `src/server/app.ts` **before** `app.use("*", guard)` | ONE step, and the ORDER is its whole reason to exist (ledger rows 56, 57): a preflight is answered `204` there with NO key, while every other request walks the pipeline unchanged and gets its headers on the way out. The values a browser sees — `Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS`, `Allow-Headers: authorization, x-api-key, content-type` (`authorization` named EXPLICITLY, because the `*` wildcard does not cover it), `Expose-Headers: x-serverstore-sha256`, `Max-Age: 600` — are the four constants at the top of `app.ts`. `Access-Control-Allow-Credentials` is NEVER sent. The allowlist reaches the app as a DEPENDENCY (`corsOrigins`), never through `process.env`, so which origins a given app answers is always an explicit argument. Pinned O1–O6 (`tests/cors.test.ts`) and D7 (`tests/entrypoint.test.ts` — the spawned service proves `main.ts` WIRES the config). |
| **The rate limiter** (volume, per client identity) | `src/server/ratelimit.ts` `createRateLimiter()` + `clientIdentity()`; the limit is parsed by `src/server/config.ts` `parseRateLimit()`; the middleware is the `app.use("*", …)` registered in `src/server/app.ts` **after** the CORS step and **before** `app.use("*", guard)` | ONE module carries the whole feature (ledger rows 64/65): a per-identity FIXED WINDOW driven by the app's INJECTED `now` (so a pin freezes the clock and drives the exact boundary — never synthetic load), `limit === 0` disables it, and the bucket table is HARD-CAPPED (`DEFAULT_MAX_BUCKETS` 4096) with an expired sweep plus least-recently-used eviction (a used bucket is re-inserted, so a flooding identity keeps its bucket and is still refused). **Identity** is `CF-Connecting-IP`, else the FIRST `X-Forwarded-For` hop, else one shared `local` — NEVER the socket address, which is always the tunnel; the bucket key is truncated to `MAX_IDENTITY_LENGTH` so the attacker-controlled header LENGTH cannot inflate the table either. **Never limited:** `/healthz`, the three UI assets (paths DERIVED from `UI_ASSETS`) and CORS preflights (`OPTIONS` + `Access-Control-Request-Method`). A refusal is `429 rate_limited` in the one envelope, plus `Retry-After` (an integer in `[1, window]`), answered before the guard so an unkeyed flood is bounded and a refused write has no side effect. `retry-after` is in `Access-Control-Expose-Headers` (`CORS_EXPOSE_HEADERS`), without which a browser could not read the back-off. In-memory and per process: a restart forgets the counters. Pinned R1–R8 (`tests/ratelimit.test.ts`). |
| Binding a socket | `src/server/main.ts` | `127.0.0.1` only; the host is NOT configurable |
| Metadata schema | `src/core/db.ts` `openDatabase()` | One file `<dataRoot>/serverstore.db`; idempotent `CREATE TABLE IF NOT EXISTS` |
| What a key IS | `src/core/keys.ts` | mint, hash, resolve, touch, revoke; `ssk_<id>_<secret>` |
| **A key's SCOPE** (which stores it may touch) | stored in `src/core/db.ts` (`access_keys.scope_all` + `key_stores`); parsed by `src/core/validate.ts` `parseStores()`; loaded by `src/core/keys.ts` `resolveKey()`; TESTED by `src/server/app.ts` `Auth.authorize()` | ONE model, four steps, each in exactly one place. `["*"]` is the master case: `scope_all = 1` on the key, because `*` is not a row in `stores` and an FK cannot hold it; every OTHER scope is one `key_stores(key_id, store)` row, whose `store` IS an FK into `stores`, so a stored scope can never name a missing store. `scope_all` and rows are never both set for one key (`parseStores()` refuses a mixed list; `rowToRecord()` builds `["*"]` OR the rows, never both). `resolveKey` loads the scope **with** the key (one extra `SELECT`), so `authorize` never queries — a request is one scope read, not one per store. `describeStores()` is the ONE renderer of a scope for a message (the 403, the CLI's stderr). Pinned G1–G6, `tests/keys.test.ts` (ledger row 42). |
| **A pre-slice-8 key row** (one `access_keys.store`) | `src/core/db.ts` `migrateLegacyKeyScope()` | Detects the OLD column, and in ONE transaction: `scope_all = 1` for `store = '*'`, one `key_stores` row per named store, then `DROP COLUMN store`. Idempotent (the column's absence is the guard) and LOUD (a legacy row naming a store that no longer exists fails the FK at boot, never an empty scope). After it runs, the old column is GONE everywhere — fresh databases never create it — so there is no second source of truth to read by accident. Pinned G6 (which seeds the old shape from the REAL key format in `tests/helpers/server.ts`). |
| **Who may MINT** (the authorization boundary of `POST /keys`) | `src/server/app.ts` `Auth.requireAdmin()` inside the `app.post("/keys")` handler | ONE check, in the SAME authorization decision as the store boundary beside it: a key that does not hold `admin` is refused 403 `forbidden` ("only an admin key may mint keys") **before the body is read**, so a refusal has no side effect. A key scoped to a SET of stores mints only WITHIN that set (the game-backend flow; the set may only contain stores the minter itself holds and may never include `["*"]`); a master admin key (`["*"]`) mints any non-admin permission for any existing store and is the ONLY key that may grant `admin`, only for scope `["*"]`. **The slice-6 subset rule (`lacks` / `Auth.grantablePermissions`) was DELETED as unreachable** — with minting restricted to holders of `admin`, `admin` implies every permission, so it could never fire; keeping it would have left an untested branch that reads as a security control. Pinned M1–M5, `tests/keys.test.ts` (ledger row 39). **Reinstatement prerequisite: a future slice that lets a NON-admin key mint must restore the subset rule in the same commit.** A store-scoped admin key with a SET has no HTTP mint path (an `admin` grant needs `["*"]`): the operator's `pnpm run admin:key --store a --store b --perms admin` is it (row 40). |
| **The key LIFECYCLE** (listing + revocation) | `src/core/keys.ts` `listKeys()` / `findKeyById()` / `revokeKey()`; the scope rules in `src/server/app.ts` `Auth.holdsStores()`; routes `app.get("/keys")` and `app.post("/keys/:id/revoke")` | The read and revoke halves of key administration, beside the mint route they belong to (ledger row 46). **`listKeys()`** loads every row plus every `key_stores` row in TWO queries (never one per key), ordered `created_at, id` — total because `id` is the primary key — and includes REVOKED keys with `revoked_at` set, so the inventory is also the audit view. **No pagination**, deliberately (small population; stated rather than unstated). **`revokeKey()`** matches only `revoked_at IS NULL`, so a second call changes nothing, and the route reports the timestamp read back from the ROW — never from the clock — which is what makes `changed:false` and a frozen timestamp the same fact. **WHO may list or revoke** is `Auth.requireAdmin("list keys"|"revoke keys")` — the ONE predicate the mint route uses, with the action in the message — and **WHICH keys** is `Auth.holdsStores()`: a master sees/revokes anything (`["*"]` contains every scope, including another `["*"]`); a store-scoped admin sees/revokes only keys whose scope lies inside its own set, and may never revoke a key holding `admin`. **SELF-REVOCATION is ALLOWED deliberately** (the caller's own credential; it is the one case exempt from the scope rules) and takes effect on the NEXT request because `resolveKey` refuses a revoked row per request — no cache to invalidate. An unknown id is `404`. **No key material leaves either route**: the entries carry `id`/`label`/`stores`/`prefix`/`perms`/the four timestamps and never the raw key, its secret or its `sha256`; `prefix` is returned because it is `ssk_` + the first 8 chars of the PUBLIC `id`, which is not a secret byte. Pinned L1–L6, `tests/keys.test.ts`. |
| Key id from a raw key | `src/core/keys.ts` `keyIdFromRaw()` | Never `split("_")[1]` — see gotchas |
| **Editing what a key HOLDS** (the second granting door) | route `app.patch("/keys/:id")` in `src/server/app.ts`; the write seam `editKey()` in `src/core/keys.ts`; validation in `src/core/validate.ts` (`parseLabel`, `parseStores`, `parsePermissions`); the audit columns in `src/core/db.ts` (`updated_at`, `updated_by`) | `PATCH` accepts any subset of `{label, stores, perms}`: an OMITTED field is unchanged, while an EMPTY object, an unknown field, a non-object body or unparseable fields are `400` and change **nothing** (pin E7 — an unknown field beside a valid one refuses the WHOLE request, never a partial edit). Validation is IDENTICAL to mint through the SAME three parsers, with the label rule folded into `parseLabel`/`assertLabel` so "blank means `unlabelled`" is one rule for both doors. WHO may edit is the SAME boundary as minting: `Auth.requireAdmin("edit keys")` **before the body is read** (pin E5), then, for a store-scoped admin, `Auth.holdsStores()` **four times** — the target's scope inside its own set, the target not holding `admin`, the RESULT's scope inside its own set, the RESULT not holding `admin` (so it can neither grant `admin` nor widen into a store it does not hold, nor DEMOTE a peer admin key). A master may narrow or widen anything; an edit that **ADDS** `admin` is an admin grant and needs `["*"]` (row 39's rule, reached through this door). **A REVOKED key is refused `403`** before any field decision (pin E3): revocation is terminal. On success `editKey()` rewrites `label`/`perms`/`scope_all` plus the `key_stores` rows in ONE transaction, stamps `updated_at` + `updated_by` (the **caller's** public id — pin E4), re-reads the row, and never names `id`/`key_hash`/`prefix`/`created_at` (pin E6). `GET /keys` and the `PATCH` response share ONE projection (`keyEntry()` in `src/server/app.ts`), so the two cannot drift. Pinned E1–E8, `tests/keys.test.ts`. |
| **The admin UI** (the served console) | `src/server/assets.ts` `UI_ASSETS` + `readUiAsset()`; the routes are registered in `src/server/app.ts`; the served files are `web/index.html`, `web/app.js`, `web/app.css` | THREE literal `GET` routes (`/`, `/app.js`, `/app.css`), each mapping a fixed route to a fixed file — **no directory walking and no static-file subsystem**, so no client-supplied string can ever become a path (ledger row 49). The assets live in `web/` at the checkout root and are resolved from `assets.ts` via `import.meta.url`, never from the process's cwd. The routes are registered **before** `app.use("*", guard)`: the console must load without a key (it is the page that ASKS for one), and `GET /whoami` is what proves it. `GET /` is a literal route, not a catch-all — it shadows no API route and an unknown path is still the API's JSON 404. Every response carries `cache-control: no-store`; a missing asset is a LOUD 500, never a blank page. **The key is memory-only by construction**: `web/app.js` holds it in ONE module variable and must never touch `localStorage`, `sessionStorage`, `document.cookie`, `location.search`, `location.hash` or `history.pushState` — pinned by scanning the SERVED bytes, and every path it calls is pinned to the route set (U1–U4, `tests/admin-ui.test.ts`). Plain JS is still not typechecked by the cheap tier, but the console IS now EXECUTED in a real browser by `tests/browser.test.ts` pins B1–B3: the served module runs with no page error, a typed key authenticates through the UI (and is asserted absent from the URL, both storage areas, a cookie and the field), and the Edit flow really `PATCH`es — asserted through the API. See the browser seam row above. |
| Error codes → HTTP status | `src/core/errors.ts` | The only place an error body is shaped |
| Name/scope/permission parsing | `src/core/validate.ts` | Store names, object names, scopes, permissions, expiry |
| The store registry | `src/stores/registry.ts` | `master` is seeded idempotently here |
| The store-kind dispatch point | `src/storage/kinds.ts` `handlerFor()` | Add a kind HERE and nowhere else |
| **The object LISTING and its ONE filter** (`prefix=`) | the SQL lives in `src/storage/kinds.ts` (`StoreKindHandler.list(db, store, prefix?)`, with `OBJECT_LIST_PREFIX_SQL` and `objectPrefixRange()`); the prefix is parsed by `src/core/validate.ts` `parseObjectPrefix()`; the route is `GET /stores/:store/objects` in `src/server/app.ts` | ONE filter, in ONE kind handler — the route only reads the query parameter and never builds SQL (ledger row 61). The filter is a **RANGE on the objects primary key**: `WHERE store = ? AND name >= ? AND name < ?`, upper bound `prefix + U+FFFF` (`objectPrefixRange()` computes it, so the handler and PIN P7 cannot disagree). It is never `LIKE` and never `substr(name, 1, length(?)) = ?` — both still say `SEARCH objects USING INDEX … (store=?)`, an index probe followed by a row-by-row filter, which is exactly the full-store work this slice exists to avoid. The prefix must ITSELF be a valid object name through the SAME `parseName`, because the legal-name language is **prefix-closed**: that one rule accepts every string that can match and refuses every string that can never match (empty/whitespace, uppercase, `/`, a leading `.`, `..`, over 64 chars) with the existing `invalid_name` (400). Absent `prefix` is the unchanged full listing; a valid prefix matching nothing is `200 {"objects":[]}`, never `404`. Pinned P1–P8 (`tests/objects.test.ts`, `tests/api-doc.test.ts`). |
| Bytes on disk | `src/storage/fs.ts` | Content-addressed, atomic temp-file + rename |
| Minting an admin key | `src/admin/mint-key.ts` (`pnpm run admin:key`) | Local, direct-to-SQLite. **No HTTP route may do this** |
| **Starting the service** (the PROCESS seam) | `src/server/main.ts`, started as `node --experimental-strip-types src/server/main.ts` | The ONLY way the server starts: `pnpm run serve`, `deploy/serverstore.service` and `tests/entrypoint.test.ts` all run exactly this. Do not add a second entrypoint, a `--daemon` mode, or a wrapper script |
| The service definition | `deploy/serverstore.service` (a systemd USER unit) | Absolute paths; `WorkingDirectory` is the `main` checkout, **never a worktree**; data root `/home/administrator/serverstore-data` (outside the repo, ledger row 13). It sets `SERVERSTORE_PORT`/`SERVERSTORE_DATA_ROOT` and **no host**, and `tests/deploy.test.ts` pins both halves (D5/D6) |
| The process contract as a test | `tests/entrypoint.test.ts` | Spawns the entrypoint on a free port with a temp data root, polls `/healthz` for ≤5s, asserts the **loopback-only** bind from `/proc/net/tcp`/`/proc/net/tcp6`, the unauthenticated 401, and SIGTERM-then-gone. Every child is SIGKILLed in `afterEach` (`reapSpawnedServices()`) |
| **Starting the service for a process-level test** (the test-side PROCESS seam) | `tests/helpers/entrypoint.ts` — `startEntrypoint()`, `waitForHealthz()`, `reapSpawnedServices()`, `freePort()` | ONE module, shared by `tests/entrypoint.test.ts` (pins D1–D4/D7) and `tests/browser.test.ts` (pins B1–B8): a free loopback port, the child spawned as `node --experimental-strip-types src/server/main.ts` in `REPO_ROOT`, a boot poll that FAILS on a deadline (and fails IMMEDIATELY if the child exited), and a reap that SIGKILLs whatever is left. `dataRoot` is an option, so the browser test keeps its scratch UNDER the worktree while the D pins keep the system temp dir. A second copy of "how the service starts" is the thing this seam exists to prevent |
| **Driving a real browser** (the ONE browser seam) | `tests/helpers/browser.ts` — `launchBrowser()`, `BrowserPage`, `killAllBrowsers()`, `resolveChromePath()`, `BrowserMissingError` | THE only place a browser is launched, driven or killed (ledger row 67). Chrome is `/usr/bin/google-chrome --headless=new` with a temp `--user-data-dir` under `<worktree>/.browser-scratch/` (never `/tmp`) and `--remote-debugging-port=0`; the chosen port is read back from `DevToolsActivePort`. The session is Node's BUILT-IN global `WebSocket` speaking just enough CDP (`Target.createTarget`/`attachToTarget`, `Page.navigate`, `Runtime.evaluate` with `awaitPromise`, `Input.dispatchMouseEvent`/`dispatchKeyEvent`/`insertText`) — **no npm dependency**. Interaction is TRUSTED `Input.*`; script only FINDS the element (`BrowserPage.clickElement` is the escape hatch for a target CSS cannot name — the lookup is scripted, the click is not). **The kill is a process-GROUP kill** (`spawn(…, {detached:true})`, then `process.kill(-pid, SIGTERM→SIGKILL)`) because a headless Chrome is a TREE of processes, and it runs from the helper's OWN `afterAll` (registered on import), from `killAllBrowsers()` on a failure path, and from a synchronous `process.once("exit")` net. A missing binary throws the NAMED `BrowserMissingError` naming the path — never a skip |
| The unit-file contract as a test | `tests/deploy.test.ts` | `systemd-analyze verify` (D5) and "no bind host is configurable" (D6). Reads the unit's DIRECTIVES, not raw text: the header comment names `SERVERSTORE_HOST` in the sentence forbidding it |
| Probing a RUNNING service | `scripts/probe-live.sh <base-url>` | The same two checks D1/D3 pin, against any URL — loopback or `https://store.futuremagic.de`. **Never takes, prints or logs a key** (the key-bearing round-trip is the owner's) |
| The deployment runbook | `docs/DEPLOYMENT.md` | The ordered install/verify/ingress/restart/mint/rollback steps, and where every path lives |
| **The client-facing CONTRACT** | `docs/API.md`, pinned by `tests/api-doc.test.ts` | The ONE doc a client developer reads: base URLs, both auth headers, 401-vs-403, every route (including `GET /whoami`, the `stores` scope of `POST /keys`, and the key lifecycle `GET /keys` / `POST /keys/{id}/revoke`), the error table, the size cap, a curl walkthrough, the non-goals. It is a contract because **PIN A1** derives the route set from `createApp({dataRoot, dbPath}).routes` and compares it to the doc's table **both ways** (middleware registers as `ALL` on `/*` and is filtered), **PIN A2** requires every `ERROR_CODES` entry in the doc's error table with the status `src/core/errors.ts` maps it to, and **PIN A3** compares the stated `SERVERSTORE_MAX_BYTES` default to the imported `DEFAULT_MAX_BYTES`. **Edit the doc and the code together** — the pin is what makes that true |
| Where a secret in the tracked tree is checked | `tests/helpers/secrets.ts` `scanTrackedTree()`, called only by `tests/secrets.test.ts` | **Tracked = what would be PUBLISHED** (`git ls-files`). Scans `ghp_`/`gho_`/`ghu_`/`ghs_`/`ghr_`+36 and `github_pat_`+22, PEM private-key headers, the literal value of the host credential read from `~/.git-credentials` (**compared in memory, never printed**), and tracked `.db`/`.sqlite`/`.sqlite3` paths; `*.db`/`*.sqlite`/`*.sqlite3` were added to `.gitignore` as the preventive half. Deliberately **no bare `ssk_` rule** (ledger row 23): our own fixtures are necessarily key-shaped, so it would red on the suite or force an exclusion list over the files most likely to hide a real leak. **Not in `scripts/gate.sh`**: the gate is the ONE way the suite runs, and a second check path there multiplies the ways a check can be silently skipped. An absent credential file makes PIN S3 FAIL with "cannot check" — never a silent pass (AGENTS.md rule 1). |

## The seam is extensible without a rewrite (the point of the slice)

A second store kind is **one handler** in `src/storage/kinds.ts` plus its name in
`STORE_KINDS` (`src/core/types.ts`). The registry already reads `stores.kind`, the
`store_kinds` table already enforces the value, and `handlerFor` already refuses an
unimplemented kind with a named 500 (`unsupported_store_kind`) rather than falling
back to `bytes`.

A second *instance* is a row: `POST /stores` or `ensureMasterStore`. No code changes.

A new principal (`user`) is already modelled: `access_keys.subject_kind` exists and
this slice implements `token` only; a `user` row fails LOUDLY today (ledger row 8).

## Gotchas

1. **Loopback, and only loopback.** `src/server/main.ts` binds `127.0.0.1`. The host
   is a constant, not an env var, because turning it into configuration is how a
   service ends up on `0.0.0.0` (AGENTS.md GUARD g1). Exposure is the cloudflared
   tunnel's job, not the app's.
2. **Keys are stored hashed, and the raw key exists exactly once.** `mintKey` returns
   `{raw, record}`; every caller must print `raw` immediately. Nothing can read a key
   back. The bootstrap for a lost master key is **shell on the box**
   (`pnpm run admin:key`), never an HTTP route — the API cannot mint an admin key
   without an existing admin key (pinned).
3. **The data root lives OUTSIDE the repo** (ledger row 13): `SERVERSTORE_DATA_ROOT`,
   default `~/serverstore-data`. The repo must stay clonable and disposable. Nothing
   in `src/` writes inside the checkout, and `app.request()` tests point it at a temp
   dir.
4. **Never parse a key with `split("_")`.** base64url's alphabet contains `_`, so ids
   like `_pCJkMlkqPPA` exist. Use `keyIdFromRaw()` — the server does, and the test
   helper exposes it so a test cannot do it differently.
5. **A traversal is refused on the RAW request target, not the parsed path.** A
   Web-standard `Request` has already collapsed `/a/../b` to `/b` by the time any
   handler sees it. `src/server/app.ts` checks the undecoded target and answers 400;
   nothing below is allowed to "sanitise" a name into a different name.
6. **The `servers/` floor is the store name, and the store name is schema-checked.**
   Paths are built only in `src/storage/fs.ts`, always from a parsed name, so there
   is no second place that could join an unvalidated string onto the data root.
7. **`journal_mode = DELETE`, deliberately not WAL.** One process, one file; WAL would
   scatter a just-minted key's row into a `-wal` sidecar and weaken the pin that says
   the raw key is absent from the database BYTES.
8. **GC does not exist yet.** `DELETE /stores/:store/objects/:name` removes the row
   and leaves the blob. `deleteBlob()` exists and is never called; this is the
   documented omission (brief §4), not an accident.
9. **The service runs from the `main` CHECKOUT, and the unit is versioned but not
   installed.** `deploy/serverstore.service` names
   `/home/administrator/projects/ServerStore` — never a worktree, which is retired
   when its slice lands. Installing it (and adding the ingress line) is a HOST change:
   it is the dispatcher's, and the tunnel restart needs the owner's go-ahead at that
   moment (`TRAP t1`). A test reads and verifies the unit; it never installs it.
10. **`/proc/net/tcp` counts every socket on the port, not just the listener.** After
   SIGTERM the probe's own sockets can sit in `TIME_WAIT` (`state 06`) on that port for
   a minute, so the process pins assert on the **`0A` (TCP_LISTEN)** subset — treating
   a kernel leftover as "still listening" is a false failure that never clears. The
   loopback pin reads BOTH `/proc/net/tcp` and `/proc/net/tcp6`, because a `[::]` bind
   does not appear in the IPv4 table at all.
11. **The UI asset routes MUST stay registered before the key guard.** `app.use("*",
    guard)` applies only to routes registered AFTER it — the same ordering `/healthz`
    relies on (PIN 7). Move the three asset routes below it and the console itself
    answers `401`: a browser cannot present a key to load the page that asks for one.
    `GET /` is a literal path, so it is not a catch-all and shadows no API route; the
    three entries in `UI_ASSETS` are the whole static surface, and adding a fourth is a
    change to that table plus `docs/API.md` (PIN A1 lists every registered route).
12. **An edit must never write the key's VALUE.** `editKey()`'s UPDATE names only
    `label`, `perms`, `scope_all`, `updated_at` and `updated_by`; `id`, `key_hash`,
    `prefix` and `created_at` are absent from it, and no new raw key is generated. That is
    what "edit in place" MEANS (the owner's *"no need to show them again"*, ledger row
    51): the credential a holder already has keeps working, with its new grant, so a
    widening takes effect on whoever holds it and a narrowing is how it is taken back. A
    future edit route — or a "re-mint on edit" convenience — MUST NOT be added: it is
    exactly the defect pin E6 catches (`checkpoints/key-edit-differential.sh`, arm A).
13. **`updated_at`/`updated_by` are ADDED columns, not just fresh-`CREATE TABLE`
    entries.** A database created before slice 11 has neither, so `openDatabase()` runs
    `migrateKeyAuditColumns()` on every boot: add-if-absent, guarded by `PRAGMA
    table_info`, one step per column, in ONE transaction. A never-edited key keeps NULL
    and the console says "never changed" — nothing is ever back-filled from `created_at`.
    Pinned E8, which DROPS the columns from a real database and proves the next boot adds
    them back and that the migrated column is usable through the route.
14. **The CORS step MUST stay registered before the key guard.** `app.use("*", guard)`
    applies only to routes registered AFTER it, and the guard matches EVERY path — so if
    the CORS `app.use` moves below it, a preflight is answered `401` and a browser on
    another origin can never send the real request. That is the defect
    `checkpoints/cors-differential.sh` arm A injects on purpose to redden PIN O1. Two
    consequences worth knowing: an `OPTIONS` carrying no `Access-Control-Request-Method`
    is NOT a preflight and still walks to the guard (`401` without a key), and because
    the step runs before ROUTING, a preflight to a path that does not exist is answered
    `204` too — harmless, since the real request is still `401`/`404`, but it is the
    reason a preflight is not a route-shaped probe of the API surface.
15. **`Access-Control-Allow-Headers` must name `authorization` EXPLICITLY.** The `*`
    wildcard is defined NOT to cover `Authorization`, so `Allow-Headers: *` would let a
    preflight succeed while the browser then refused to send the very header this API
    authenticates with — a silent failure only a real browser would reveal. The pinned
    list is `authorization, x-api-key, content-type`; a new auth header must be added
    there in the SAME commit (PIN O1 checks `authorization` as a whole word). Related, and
    deliberate: `Access-Control-Allow-Credentials` is NEVER sent, because this API has no
    cookies and there must never appear to be.
16. **A `prefix=` filter must stay a RANGE on the primary key — and "no `SCAN objects`" is
    NOT the assertion that proves it.** A `substr(name, 1, length(?)) = ?` (or `LIKE 'p%'`)
    implementation EXPLAINs as `SEARCH objects USING INDEX sqlite_autoindex_objects_1
    (store=?)`: it probes the index for the store and then filters every one of that
    store's rows, so it is still a `SEARCH`, never a `SCAN`. PIN P7 therefore asserts the
    DISPLACING signal — the index search must carry the `name>? AND name<?` range
    (`SEARCH objects USING INDEX sqlite_autoindex_objects_1 (store=? AND name>? AND
    name<?)`) and the statement must contain no `LIKE`/`substr`. Both shapes were measured
    on this box, and differential arm B (`checkpoints/prefix-differential.sh`) reddens P7
    while every result row stays correct. The upper bound is `prefix + "\uffff"`, which is
    EXACT here and not a fudge: the name charset is ASCII (greatest code point `z`), U+FFFF
    encodes as `EF BF BF` and sorts after every ASCII byte under the BINARY collation, and
    no legal name can contain it — so `< prefix+U+FFFF` selects exactly the names that
    start with the prefix. If the charset or the collation ever changes, this bound and
    P7's regex are the two things to re-derive together.
17. **The rate-limit step must stay between the CORS step and the key guard — moving it
    either way breaks a different half.** BELOW `app.use("*", guard)` it would bound only
    callers who already hold a key, which is not the flood a public endpoint faces (the
    unkeyed flood IS the threat), and a preflight would be answered `401` before the
    limiter ever saw it. ABOVE the CORS step, a `429` would be returned before the CORS
    step could add `Access-Control-Expose-Headers` — so a browser would see the refusal but
    NOT be able to read `Retry-After`, which is the difference between a rate limit and a
    client-side outage (ledger row 64f). Two more traps worth naming: **eviction must
    prefer the COLDEST bucket** (plain insertion-order eviction would evict an actively
    flooding identity between its own requests and silently stop limiting it — the reason
    `check` re-inserts a used bucket), and **the identity must never be the peer socket
    address**, because the unit binds loopback behind cloudflared, so the socket is the
    tunnel for every caller on Earth. Do not "improve" either one.
18. **A headless browser is a PROCESS TREE, and only the process GROUP kills it.** One
    `/usr/bin/google-chrome --headless=new` run leaves the browser plus its zygote, GPU
    and renderer children (the host rule records a measured 33). Killing the launcher
    kills nothing else, so `tests/helpers/browser.ts` starts Chrome `detached` (its own
    group) and signals `-pid` — SIGTERM, bounded grace, SIGKILL — from the helper's OWN
    `afterAll` (registered on import, so a caller cannot forget it), from
    `killAllBrowsers()` on a failure path, and from a synchronous `process.once("exit")`
    net. **Never pattern-kill from a shell whose own argv contains the pattern**, and
    verify with a count that cannot self-match: `ps -eo comm= | grep -c '^chrome$'` → `0`.
    Two more rules ride the same seam: the temp `--user-data-dir` lives UNDER the
    worktree (never `/tmp`), and a missing binary throws `BrowserMissingError` naming the
    path — **never a skip**, because a skipped pin is a pin that cannot fail. Finally, the
    interaction must be TRUSTED: read the geometry with `Runtime.evaluate`, then CLICK
    with `Input.dispatchMouseEvent` and TYPE with `Input.dispatchKeyEvent`/
    `Input.insertText`. `element.click()` would pass the same assertions while proving
    nothing about what a user's mouse does — do not "simplify" it back.

## Known debt (and where it is recorded)

- **The admin UI's browser behaviour is now EXERCISED for the three flows that matter,
  and stays UNPROVEN for everything else.** Slice 15 (ledger row 68) added
  `tests/browser.test.ts`, which drives the installed Chrome over CDP: PIN B1 runs the
  served `web/app.js` and fails on a page error, PIN B2 types a master key and asserts
  the UI authenticates it through `GET /whoami` (and that the key is in no URL, storage,
  cookie or field), and PIN B3 opens the row editor and asserts the label/permission edit
  really reached the API. What REMAINS unproven: every other console control (mint,
  revoke, `confirm()`, store creation, the copy button, the revoked-key disabled state)
  and anything VISUAL — a scripted flow is not a claim about layout, and only one browser
  engine runs. Those lines change only when a pin exists for them.
- **No garbage collection** for orphaned blobs — ledger row 19, brief §4.
- **Memory ceiling (GUARD g3) not implemented.** The suite still runs in seconds, so
  there is nothing to bound; the debt is board `g3` and this line changes when the
  suite stops being trivial. (This line used to carry a test COUNT, which went stale
  within the same landing — 49 written, 52 landed. A volatile number restated in prose
  is exactly what the ledger warns about; point at the suite, not at its tally.)
- **`POST /keys` exists** (admin keys mint scoped keys); it is not in the brief's
  minimum route list and is pinned in the direction that matters — only a key holding
  `admin` may mint at all, an `admin` grant still needs a MASTER admin key and scope
  `["*"]`, and a scoped key still cannot mint outside its SET (`Auth.requireAdmin()`,
  ledger rows 39, 42). The slice-6 subset rule was removed as unreachable; the seam row
  above carries the reinstatement prerequisite.
- **A key's scope is a SET of stores** (ledger rows 41, 42): `scope_all` on the key, or
  one `key_stores` row per store, parsed by `parseStores()`, loaded once by `resolveKey()`
  and tested once by `Auth.authorize()`. `POST /keys` takes `stores: string[]` and
  `GET /whoami` reports it; the legacy `store` column is migrated then dropped.
  ~~Still open for B2: **no route LISTS keys and there is no REVOKE route**
  (`revokeKey()` is called only by tests)~~ — **CLOSED by ledger row 46**: `GET /keys`
  and `POST /keys/:id/revoke` are the lifecycle seam above, and `revokeKey()` is now
  reached from HTTP. Step C (the admin UI) has both calls it needs.
- **`store_kinds` is enforced by a foreign key**, so `kind` is a real vocabulary in
  the file and not a comment. `key_stores.store` is a foreign key for the same reason:
  a key's scope cannot name a store that does not exist.
- **The client contract's own findings** (ledger row 33, `docs/API.md`): `name_taken`
  (409) is in `ERROR_CODES` and **no route emits it** — the doc says "reserved";
  ~~`POST /keys` bounds minting by **store**, not by the minter's permissions (a
  `read`-only key mints a `write`+`delete` key for its own store)~~ — **CLOSED by
  ledger row 36** (the permission boundary held, pinned K1–K5) and then **NARROWED by
  ledger row 39**: only a key holding `admin` may mint at all, so the subset rule is
  no longer the live boundary and K1–K5 were replaced by M1–M5; ~~there is **no
  whoami route**~~ — **CLOSED by ledger row 42** (`GET /whoami`, pinned G4); ~~there is
  **no revoke route**~~ — **CLOSED by ledger row 46** (`POST /keys/:id/revoke`, pinned
  L1–L6); and a key scoped elsewhere learns a store's existence from a `404` because
  `requireStore()` runs before `authorize()` — still true, and still a separate
  owner-visible decision. (`GET /keys` narrows that oracle for KEYS only: a scoped admin
  gets `404` for an unknown id and `403` for a key outside its scope, so it can tell
  "no such key" from "not yours" — the same shape, recorded in `docs/TESTING.md` as an
  honest unknown rather than hidden.) `name_taken` is the one finding that remains open.
