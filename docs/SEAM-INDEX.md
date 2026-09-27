# The seam index — the one way to do X

**Start here.** When one idea is implemented twice, this file should have prevented
it. Each entry says the ONE place a thing lives, and why it is there.

Written on 2026-09-27 with the first feature slice (ledger row 19). Behaviour is not
restated here — the test **is** the statement, and `docs/TESTING.md` names the pins.

## The ONE seam: the request pipeline

```
request
  └─ path guard            src/server/app.ts          (raw target, before routing)
       └─ resolve key      src/core/keys.ts           resolveKey()
            └─ authorize   src/server/app.ts          Auth.authorize() / requireMasterAdmin()
                 └─ dispatch to the store kind       src/storage/kinds.ts   handlerFor(kind)
                      └─ storage                     src/storage/fs.ts    bytes on disk
```

Everything the project will ever do is either **core** (a step above `dispatch`) or a
**store kind** (a handler at `dispatch`). There is no third mechanism.

| Concern | The one place | Notes |
| --- | --- | --- |
| HTTP app, built from injected deps | `src/server/app.ts` `createApp({dataRoot, dbPath, now, maxBytes})` | Tests drive it with `app.request()`; no port is bound outside `main.ts` |
| The only env read | `src/server/config.ts` `resolveConfig()` | Called by `main.ts` and the admin CLI, never at module import time |
| Binding a socket | `src/server/main.ts` | `127.0.0.1` only; the host is NOT configurable |
| Metadata schema | `src/core/db.ts` `openDatabase()` | One file `<dataRoot>/serverstore.db`; idempotent `CREATE TABLE IF NOT EXISTS` |
| What a key IS | `src/core/keys.ts` | mint, hash, resolve, touch, revoke; `ssk_<id>_<secret>` |
| Key id from a raw key | `src/core/keys.ts` `keyIdFromRaw()` | Never `split("_")[1]` — see gotchas |
| Error codes → HTTP status | `src/core/errors.ts` | The only place an error body is shaped |
| Name/scope/permission parsing | `src/core/validate.ts` | Store names, object names, scopes, permissions, expiry |
| The store registry | `src/stores/registry.ts` | `master` is seeded idempotently here |
| The store-kind dispatch point | `src/storage/kinds.ts` `handlerFor()` | Add a kind HERE and nowhere else |
| Bytes on disk | `src/storage/fs.ts` | Content-addressed, atomic temp-file + rename |
| Minting an admin key | `src/admin/mint-key.ts` (`pnpm run admin:key`) | Local, direct-to-SQLite. **No HTTP route may do this** |
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

## Known debt (and where it is recorded)

- **No garbage collection** for orphaned blobs — ledger row 19, brief §4.
- **Memory ceiling (GUARD g3) not implemented.** The suite still runs in seconds, so
  there is nothing to bound; the debt is board `g3` and this line changes when the
  suite stops being trivial. (This line used to carry a test COUNT, which went stale
  within the same landing — 49 written, 52 landed. A volatile number restated in prose
  is exactly what the ledger warns about; point at the suite, not at its tally.)
- **`POST /keys` exists** (admin keys mint scoped keys); it is not in the brief's
  minimum route list and is pinned in the direction that matters — it cannot mint an
  admin key without a master admin key, and a scoped key cannot escape its store.
- **`store_kinds` is enforced by a foreign key**, so `kind` is a real vocabulary in
  the file and not a comment.
