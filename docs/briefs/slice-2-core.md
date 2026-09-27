# Brief — slice 2: the multi-store core

Cut from `docs/BRIEF.md`. Self-contained: the writer never sees the dispatcher's
conversation. Ledger row assigned by the dispatcher: **19**.

---

You are a WRITER on **ServerStore** (a self-hosted, multi-store data service: Node 24 +
TypeScript on pnpm, vitest, ONE gate). Read `/home/administrator/projects/ServerStore/AGENTS.md`
FIRST — the binding rules, especially §critique the instruction, §Centralization, §parallel
writers, §host hygiene. Then read `docs/DECISION-LEDGER.md` rows 2, 5, 6, 8, 10, 11, 13 and
`docs/BOARD.md`.

## Where you work (READ THIS TWICE)

Your worktree is `/home/administrator/projects/ServerStore/worktrees/core` on branch `feat/core`,
already based on `origin/main` and already installed (`pnpm install --frozen-lockfile` has run;
`node_modules` is present). Confirm your base with
`git -C /home/administrator/projects/ServerStore/worktrees/core log --oneline -1`.

Every bash call runs in a fresh shell whose cwd is the MAIN repo, and file tools resolve RELATIVE
paths against it — so EVERY read/edit/write/bash call MUST use an ABSOLUTE path under
`/home/administrator/projects/ServerStore/worktrees/core` (or pass a working directory). Never
touch `/home/administrator/projects/ServerStore` outside `worktrees/core`. You are the only writer
in flight; no other branch is being written.

## The owner's words (verbatim) and the intent

> *"I want to make a flexible store that i can access from anywhere and where i can grant limited
> permissions. Details TBD."*
> *"I guess, in reality, this should be a collection of stores with the ability to easily add new
> ones."*
> *"Lets use access keys similar to LLM keys."*
> *"Generic is ok, but a collection of stores from the start, so i can have specific stores. We can
> have one Master Store from the start."*

**Intent:** prove, end to end, that a request bearing a **scoped key** can round-trip bytes through
a **named store**, with **many stores from day one**. The deliverable is not "a file uploader" — it
is the core seam every later store kind and every later permission hangs on. Today the repo
contains NO feature code at all: `src/` does not exist, and the only test is
`tests/process/gate-contract.test.ts`, which pins the process itself.

## What to build

**The ONE seam this slice extends:** the request pipeline — `resolve key → authorize against a
named store → dispatch to that store's storage`. Everything else in the project is either a store
kind plugged into it or a client of it. Name it in the seam index.

1. **HTTP app factory** — `src/server/app.ts` exporting `createApp(deps)`. Use **Hono** (decision
   already made; rejected: Fastify — more machinery than a handful of routes needs; Express — no
   Web-standard Request/Response, so it cannot be tested in-process). Hono's `app.request()` must
   let every test exercise a full request **without binding a port**. A separate
   `src/server/main.ts` binds `127.0.0.1` only, port from `SERVERSTORE_PORT` (default **8477**,
   verified free), and MUST NOT bind `0.0.0.0` (AGENTS.md GUARD g1).
2. **Injected dependencies** — `createApp` takes `{ dataRoot, dbPath, now? }` explicitly. No module
   reads `process.env` at import time; `main.ts` reads env and passes it in. Tests pass a temp dir.
3. **Metadata** — `node:sqlite` (`DatabaseSync`), Node 24 built-in, **verified to load without any
   flag**; rejected: `better-sqlite3` (a native dependency this box does not need). One database at
   `<dataRoot>/serverstore.db`, schema applied idempotently at boot. Minimum tables:
   - `stores(name TEXT PRIMARY KEY, kind TEXT NOT NULL, created_at TEXT NOT NULL)`
   - `objects(store TEXT NOT NULL, name TEXT NOT NULL, sha256 TEXT NOT NULL, size INTEGER NOT NULL,
     created_at TEXT NOT NULL, PRIMARY KEY(store, name))`
   - `access_keys(id TEXT PRIMARY KEY, store TEXT, label TEXT NOT NULL, key_hash TEXT NOT NULL,
     prefix TEXT NOT NULL, perms TEXT NOT NULL, subject_kind TEXT NOT NULL, created_at TEXT NOT NULL,
     expires_at TEXT, last_used_at TEXT, revoked_at TEXT)`
   `subject_kind` exists because ledger row 8 requires the grants model to accept a `user` subject
   later; implement **`token` only** and let the column say so.
4. **Storage** — bytes on disk under `<dataRoot>/stores/<store>/blobs/<sha256[0:2]>/<sha256>`,
   written atomically (temp file + rename). Content-addressed; deletions remove the row and leave
   the blob for now (garbage collection is OUT of scope — say so in the ledger row).
5. **Store registry** — a store is `{name, kind}`. Kind for this slice: **`bytes` only**, but the
   column and the dispatch point must make a second kind an addition, not a rewrite. Seed the
   **`master`** store idempotently at boot (ledger row 10). `POST /stores` (admin) creates one.
6. **Access keys** — format `ssk_<id>_<secret>` where `id` is a short public lookup id and `secret`
   is 32 random bytes (base64url). **The raw key is returned exactly once, from the create call.**
   Persist only `sha256(raw)`, the `prefix` (first 12 chars, for display), and `id`. Verification
   compares hashes in constant time. Permissions are a subset of `read | write | delete | admin`;
   scope is one store name, or `*` for admin keys. A **master key** is `scope=*` + `admin`.
7. **Local bootstrap** (ledger row 7: a lost master key is re-minted *from the box*). Add
   `pnpm run admin:key` → a local script that opens the database directly (NOT over HTTP), mints an
   admin key, prints it once to stdout, and never stores it. **There must be NO HTTP route that
   mints an admin key without an existing admin key** — pin that.
8. **Auth middleware** — `Authorization: Bearer <key>` (also accept `x-api-key`). Missing/unknown/
   revoked/expired → **401**. Known but not permitted for this store or this operation → **403**.
   Updates `last_used_at`.
9. **Routes (minimum)** — `GET /healthz` (no auth); `GET /stores`, `POST /stores` (admin);
   `GET /stores/:store/objects` (read); `PUT /stores/:store/objects/:name` (write);
   `GET /stores/:store/objects/:name` (read); `DELETE /stores/:store/objects/:name` (delete).
10. **One error surface** — every failure returns JSON `{ error: { code, message } }` with a stable
    code, and a failing request writes NOTHING to the data root or the database. No silent
    fallbacks (AGENTS.md rule 1): never finalize an object from a failed or empty body, never
    `catch`-and-continue around parsing, never a placeholder value for required data.
11. **Validate at every boundary** — store names and object names are parsed against an explicit
    schema: allowed charset `[a-z0-9][a-z0-9._-]{0,63}`, and `..`, leading `/` or `.` are refused
    with **400**. A path like `../../etc` must be refused, not sanitized into something else.
    Request bodies are read with a size cap (`SERVERSTORE_MAX_BYTES`, default 64 MiB) and an
    over-cap body fails the request, it is not truncated.

## Pins (each must go RED when the behaviour is broken; a pin's NAME is part of the deliverable)

1. A request with no key is refused **401** and nothing is written to the data root.
2. A key scoped to store **A** cannot read or write store **B** (**403**) — and the bytes of B are
   untouched.
3. A **revoked** key is refused (401); an **expired** key is refused (401).
4. `PUT` then `GET` returns **byte-identical** content (sha256 equal).
5. **The presented key string never appears in the database file.** After minting, read
   `serverstore.db` as bytes and assert the raw key is absent — this is the "stored hashed" claim.
6. The `master` store exists after first boot, and a **second boot does not duplicate it**.
7. `GET /healthz` needs no key; every other route needs one.
8. The path-traversal and over-cap cases above each produce their named error code.
9. `pnpm run admin:key` mints a key the HTTP API accepts as admin.

Reuse the existing harness (`vitest`, `tests/**`); **never build a second fixture set.**

## Verification (yours)

1. The ONE gate: `bash scripts/gate.sh`, run **IN YOUR OWN TURN, FOREGROUND** — your background
   jobs die when your turn ends. Keep the RAW log (`.gate-logs/gate.log`). Exit `0` = fully
   verified; `2` = the suite did NOT run (not a pass); `9` = lock busy → wait and retry, never reap
   another actor's processes. You must report a FULL green run; a compile-only result is not a
   landing.
2. Your own differential: at least one injection that breaks a pin, with the **file hash printed
   before and after**, the lock held before injecting, and the restore done in a `trap`. Two arms
   with identical output are a VOID probe, not evidence. **Commit your slice first**, then inject —
   in an uncommitted tree `git checkout HEAD -- <path>` destroys your own work.
3. Update `tsconfig.json` `include` to cover `src/**/*.ts`. That file is verification machinery, so
   the full suite is owed regardless.
4. Commit style: one coherent commit, imperative subject. Then
   `git -C /home/administrator/projects/ServerStore/worktrees/core pull --rebase origin main` and
   `git push origin HEAD:main`.
5. If you cannot finish, **COMMIT the coherent partial state on your branch** and report BLOCKED
   with the reasoning. Uncommitted work dies with your session.

## Docs to amend in the SAME commit

- `docs/DECISION-LEDGER.md` — your **row 19** (append only; never edit another row).
- `docs/SEAM-INDEX.md` — **create it**: the request pipeline, the key-resolution seam, the storage
  seam, the store-kind dispatch point, and the gotchas (loopback binding, hashed keys, the data
  root being OUTSIDE the repo).
- `docs/TESTING.md` — **create it**: the pins above, plus your differential arms with their hashes
  and any VOID probe.
- `docs/BOARD.md` — your `LANDED` row (a docs conflict here is a mechanical UNION: renumber YOUR
  row only and touch nothing of another landing).
- Carry the `COPIES:` line: `COPIES: n→1 — <the seam>` or
  `COPIES: 1 — checked, no duplication (grepped: <what>)`.

## Your report (short)

`LANDED` or `BLOCKED`, then: sha; gate counts + peak; each arm with its printed hash and what went
red; the `COPIES:` line; how the deliverable actually works (which read, which lookup); your
judgement calls; the docs you amended; and **anything this brief got wrong**.

Report NOTHING in between — silence until LANDED or BLOCKED. If you can PROVE a rule here is wrong
(including this brief's own design), report BLOCKED with the evidence rather than implementing it.
