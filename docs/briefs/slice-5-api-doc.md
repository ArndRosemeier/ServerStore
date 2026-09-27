# Brief — slice 5: the client contract (`docs/API.md`)

Cut from `docs/BRIEF.md`. Self-contained. Ledger row assigned by the dispatcher: **33**.

---

You are a WRITER on **ServerStore** (Node 24 + TypeScript, pnpm, vitest, ONE gate). Read
`/home/administrator/projects/ServerStore/AGENTS.md` FIRST, then `docs/DECISION-LEDGER.md` rows 2,
6, 7, 8, 21, 28, 30 and `docs/SEAM-INDEX.md`.

## Where you work (READ THIS TWICE)

Worktree `/home/administrator/projects/ServerStore/worktrees/api-doc`, branch `feat/api-doc`, base
`origin/main` = **2991ec6**, already installed. EVERY read/edit/write/bash call MUST use an ABSOLUTE
path under that worktree (or pass a working directory) — relative paths resolve against the MAIN
repo. Never touch the main tree. You are the only writer in flight.

You are a subagent: your background jobs DIE when your turn ends. Run the gate IN-TURN, foreground.

## The intent

The owner wants **another agent to build a browser game against this store** (multiplayer state, one
key per registered player). Asked whether a doc exists that it could code against, the answer
measured today was **NO**: every doc under `docs/` is internal — seams, pins, decisions, runbook.
This slice is that missing artifact, and it is the FIRST thing a client developer reads.

**The ONE seam: the CONTRACT between the service and a client.** You are not changing the service.
If you find that the contract and the code disagree, **report it — do not silently change `src/`**.

## Deliverable

`docs/API.md` — self-contained for an agent that has never seen this repo:

1. **What it is**, in one paragraph, and **where it lives**: deployed at
   `https://store.futuremagic.de`; locally `http://127.0.0.1:8477`; reachability is checked with
   `bash scripts/probe-live.sh <base-url>` (exit `0` pass · `1` fail · `2` could-not-run).
2. **Authentication.** `Authorization: Bearer ssk_…` (also `x-api-key: ssk_…`). A key is returned
   **exactly once**, at mint; only its hash is stored, so it can never be read back — a lost key is
   replaced, not recovered. Say what **401** means (missing / unknown / revoked / expired) versus
   **403** (a valid key that is not permitted for that store or operation), and that permissions are
   a subset of `read | write | delete | admin` with `admin` implying the rest. State today's scope
   honestly: **one store name, or `*`** (row 30 retires that limit; do not promise the future).
3. **Every route**, one table row each: method, path, who may call it, request shape, response
   shape, statuses. All EIGHT exist today — `GET /healthz`; `GET` and `POST /stores`; `POST /keys`;
   `GET /stores/:store/objects`; `PUT`, `GET` and `DELETE /stores/:store/objects/:name`. Name the
   object-name charset (`[a-z0-9][a-z0-9._-]{0,63}`, no `.`/`..` segments) and that a PUT of an
   existing name OVERWRITES.
4. **The error envelope** — `{"error":{"code":"…","message":"…"}}` — with a table of **every code in
   `ERROR_CODES`** (`src/core/errors.ts`), its HTTP status, and what a client should DO about it.
5. **Limits**: `SERVERSTORE_MAX_BYTES` (default 64 MiB); an over-cap body is refused (`413`), never
   truncated; a failing request writes nothing.
6. **A "first five minutes" worked example** with `curl`: create a store, mint a scoped key, PUT an
   object, GET it, list, delete — using `$BASE` and `$ADMIN_KEY` placeholders, never a real key.
7. **Explicit non-goals** so a client developer is not surprised: no garbage collection (a DELETE
   leaves the blob), **no concurrency control** (two writers racing one name lose an update — row 28),
   no CORS yet, no rate limiting yet, **no identity beyond keys** (a player pasting a key is not
   logged in), and no bulk/range/streaming APIs.

## Pins (a pin's NAME is part of the deliverable)

The doc must be **checkable**, or it is the prose that rots.

1. `PIN A1: every route the app registers is in the API doc, and every route in the doc is registered`
   — derive the truth from `createApp({dataRoot, dbPath}).routes` (middleware appears with path `*`:
   filter it) and compare the `METHOD /path` set against the doc's table, in BOTH directions.
2. `PIN A2: every code in ERROR_CODES appears in the doc's error table`.
3. `PIN A3: the doc's stated max-bytes default equals the code's` (import the constant; do not retype
   it).

## Verification (yours)

1. `bash scripts/gate.sh` IN-TURN, FOREGROUND, raw log kept. `0` = VERIFIED, `2` = the suite did NOT
   run, `9` = lock busy → wait and retry. Report a FULL green run.
2. Your differential: **commit first**, then add a NINTH route to `src/server/app.ts` (e.g.
   `app.get("/ping", (c) => c.json({ ok: true }))`) and watch **PIN A1** go RED; restore from `HEAD`
   in an `EXIT INT TERM` trap; print hashes before and after; identical arms = VOID. Second arm if
   cheap: add a fake row to the doc's table and watch A1/A3 go RED.
3. `git -C <worktree> pull --rebase origin main`, then `git push origin HEAD:main`.
4. If you cannot finish, COMMIT the coherent partial state on your branch and report BLOCKED.

## Docs to amend in the SAME commit

`docs/DECISION-LEDGER.md` **row 33**; `docs/SEAM-INDEX.md` (one row: the client contract's home and
its pin); `docs/TESTING.md` (A1–A3 plus your arm with its hashes); `docs/BOARD.md` LANDED row. Carry
the `COPIES:` line.

## Your report (short)

`LANDED` or `BLOCKED`, then: sha; gate counts + peak; each arm with its printed hash and what went
red; the `COPIES:` line; judgement calls; docs amended; and anything this brief got wrong — including
any place where the contract and the code disagreed. Silence until then.
