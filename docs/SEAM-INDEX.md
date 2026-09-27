# The seam index — the one way to do X

**Start here.** When one idea is implemented twice, this file should have prevented
it. Each entry says the ONE place a thing lives, and why it is there.

Written on 2026-09-27 with the first feature slice (ledger row 19). Behaviour is not
restated here — the test **is** the statement, and `docs/TESTING.md` names the pins.

## The ONE seam: the request pipeline

```
request
  └─ path guard            src/server/app.ts          (raw target, before routing)
       └─ resolve key      src/core/keys.ts           resolveKey() — loads the key AND its scope once
            └─ authorize   src/server/app.ts          Auth.authorize() / requireAdmin() / requireMasterAdmin()
                 └─ dispatch to the store kind       src/storage/kinds.ts   handlerFor(kind)
                      └─ storage                     src/storage/fs.ts    bytes on disk
```

Everything the project will ever do is either **core** (a step above `dispatch`) or a
**store kind** (a handler at `dispatch`). There is no third mechanism.

**The `POST /keys` authorization decision is the `authorize` step applied to a GRANT**,
not a separate path: it enforces WHO may mint (a key that holds `admin` — ledger row 39)
and the store boundary (a scoped key mints only within its own SET of stores) in ONE
branch of the route handler — see the "Who may MINT" row below. A key without `admin` is
refused `403 forbidden` **before the body is read**, and the slice-6 subset rule it used
to carry was **DELETED as unreachable** (an `admin` key implies every permission, so a
subset check could never fire). There is no second authorization middleware.

**PREREQUISITE (do not lose this): any future slice that lets a NON-admin key mint MUST
reinstate the subset rule — "a key may pass on only what it holds" — in the SAME commit.**
Until then `requireAdmin()` is the ONLY thing between a read-only key and the write+delete
escalation of ledger row 35, because the permissions of the key being minted are not
checked against the minter's at all (the minter holds `admin`, which implies them all).

| Concern | The one place | Notes |
| --- | --- | --- |
| HTTP app, built from injected deps | `src/server/app.ts` `createApp({dataRoot, dbPath, now, maxBytes})` | Tests drive it with `app.request()`; no port is bound outside `main.ts` |
| The only env read | `src/server/config.ts` `resolveConfig()` | Called by `main.ts` and the admin CLI, never at module import time |
| Binding a socket | `src/server/main.ts` | `127.0.0.1` only; the host is NOT configurable |
| Metadata schema | `src/core/db.ts` `openDatabase()` | One file `<dataRoot>/serverstore.db`; idempotent `CREATE TABLE IF NOT EXISTS` |
| What a key IS | `src/core/keys.ts` | mint, hash, resolve, touch, revoke; `ssk_<id>_<secret>` |
| **A key's SCOPE** (which stores it may touch) | stored in `src/core/db.ts` (`access_keys.scope_all` + `key_stores`); parsed by `src/core/validate.ts` `parseStores()`; loaded by `src/core/keys.ts` `resolveKey()`; TESTED by `src/server/app.ts` `Auth.authorize()` | ONE model, four steps, each in exactly one place. `["*"]` is the master case: `scope_all = 1` on the key, because `*` is not a row in `stores` and an FK cannot hold it; every OTHER scope is one `key_stores(key_id, store)` row, whose `store` IS an FK into `stores`, so a stored scope can never name a missing store. `scope_all` and rows are never both set for one key (`parseStores()` refuses a mixed list; `rowToRecord()` builds `["*"]` OR the rows, never both). `resolveKey` loads the scope **with** the key (one extra `SELECT`), so `authorize` never queries — a request is one scope read, not one per store. `describeStores()` is the ONE renderer of a scope for a message (the 403, the CLI's stderr). Pinned G1–G6, `tests/keys.test.ts` (ledger row 42). |
| **A pre-slice-8 key row** (one `access_keys.store`) | `src/core/db.ts` `migrateLegacyKeyScope()` | Detects the OLD column, and in ONE transaction: `scope_all = 1` for `store = '*'`, one `key_stores` row per named store, then `DROP COLUMN store`. Idempotent (the column's absence is the guard) and LOUD (a legacy row naming a store that no longer exists fails the FK at boot, never an empty scope). After it runs, the old column is GONE everywhere — fresh databases never create it — so there is no second source of truth to read by accident. Pinned G6 (which seeds the old shape from the REAL key format in `tests/helpers/server.ts`). |
| **Who may MINT** (the authorization boundary of `POST /keys`) | `src/server/app.ts` `Auth.requireAdmin()` inside the `app.post("/keys")` handler | ONE check, in the SAME authorization decision as the store boundary beside it: a key that does not hold `admin` is refused 403 `forbidden` ("only an admin key may mint keys") **before the body is read**, so a refusal has no side effect. A key scoped to a SET of stores mints only WITHIN that set (the game-backend flow; the set may only contain stores the minter itself holds and may never include `["*"]`); a master admin key (`["*"]`) mints any non-admin permission for any existing store and is the ONLY key that may grant `admin`, only for scope `["*"]`. **The slice-6 subset rule (`lacks` / `Auth.grantablePermissions`) was DELETED as unreachable** — with minting restricted to holders of `admin`, `admin` implies every permission, so it could never fire; keeping it would have left an untested branch that reads as a security control. Pinned M1–M5, `tests/keys.test.ts` (ledger row 39). **Reinstatement prerequisite: a future slice that lets a NON-admin key mint must restore the subset rule in the same commit.** A store-scoped admin key with a SET has no HTTP mint path (an `admin` grant needs `["*"]`): the operator's `pnpm run admin:key --store a --store b --perms admin` is it (row 40). |
| Key id from a raw key | `src/core/keys.ts` `keyIdFromRaw()` | Never `split("_")[1]` — see gotchas |
| Error codes → HTTP status | `src/core/errors.ts` | The only place an error body is shaped |
| Name/scope/permission parsing | `src/core/validate.ts` | Store names, object names, scopes, permissions, expiry |
| The store registry | `src/stores/registry.ts` | `master` is seeded idempotently here |
| The store-kind dispatch point | `src/storage/kinds.ts` `handlerFor()` | Add a kind HERE and nowhere else |
| Bytes on disk | `src/storage/fs.ts` | Content-addressed, atomic temp-file + rename |
| Minting an admin key | `src/admin/mint-key.ts` (`pnpm run admin:key`) | Local, direct-to-SQLite. **No HTTP route may do this** |
| **Starting the service** (the PROCESS seam) | `src/server/main.ts`, started as `node --experimental-strip-types src/server/main.ts` | The ONLY way the server starts: `pnpm run serve`, `deploy/serverstore.service` and `tests/entrypoint.test.ts` all run exactly this. Do not add a second entrypoint, a `--daemon` mode, or a wrapper script |
| The service definition | `deploy/serverstore.service` (a systemd USER unit) | Absolute paths; `WorkingDirectory` is the `main` checkout, **never a worktree**; data root `/home/administrator/serverstore-data` (outside the repo, ledger row 13). It sets `SERVERSTORE_PORT`/`SERVERSTORE_DATA_ROOT` and **no host**, and `tests/deploy.test.ts` pins both halves (D5/D6) |
| The process contract as a test | `tests/entrypoint.test.ts` | Spawns the entrypoint on a free port with a temp data root, polls `/healthz` for ≤5s, asserts the **loopback-only** bind from `/proc/net/tcp`/`/proc/net/tcp6`, the unauthenticated 401, and SIGTERM-then-gone. Every child is SIGKILLed in `afterEach` |
| The unit-file contract as a test | `tests/deploy.test.ts` | `systemd-analyze verify` (D5) and "no bind host is configurable" (D6). Reads the unit's DIRECTIVES, not raw text: the header comment names `SERVERSTORE_HOST` in the sentence forbidding it |
| Probing a RUNNING service | `scripts/probe-live.sh <base-url>` | The same two checks D1/D3 pin, against any URL — loopback or `https://store.futuremagic.de`. **Never takes, prints or logs a key** (the key-bearing round-trip is the owner's) |
| The deployment runbook | `docs/DEPLOYMENT.md` | The ordered install/verify/ingress/restart/mint/rollback steps, and where every path lives |
| **The client-facing CONTRACT** | `docs/API.md`, pinned by `tests/api-doc.test.ts` | The ONE doc a client developer reads: base URLs, both auth headers, 401-vs-403, all nine routes (including `GET /whoami` and the `stores` scope of `POST /keys`), the error table, the size cap, a curl walkthrough, the non-goals. It is a contract because **PIN A1** derives the route set from `createApp({dataRoot, dbPath}).routes` and compares it to the doc's table **both ways** (middleware registers as `ALL` on `/*` and is filtered), **PIN A2** requires every `ERROR_CODES` entry in the doc's error table with the status `src/core/errors.ts` maps it to, and **PIN A3** compares the stated `SERVERSTORE_MAX_BYTES` default to the imported `DEFAULT_MAX_BYTES`. **Edit the doc and the code together** — the pin is what makes that true |
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

## Known debt (and where it is recorded)

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
  `GET /whoami` reports it; the legacy `store` column is migrated then dropped. Still
  open for B2: **no route LISTS keys and there is no REVOKE route** (`revokeKey()` is
  called only by tests), which is what the step-C UI needs next.
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
  whoami route**~~ — **CLOSED by ledger row 42** (`GET /whoami`, pinned G4); and a key
  scoped elsewhere learns a store's existence from a `404` because `requireStore()` runs
  before `authorize()` — still true, and still a separate owner-visible decision.
  `name_taken` and the missing REVOKE route are the two findings that remain open
  (revoke is step B2).
