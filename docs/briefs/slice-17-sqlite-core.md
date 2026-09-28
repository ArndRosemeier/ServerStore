# Brief — slice 17 (I1): the SQLite core — items in the database, concurrency asserted

Cut from `docs/BRIEF.md`. Self-contained. Ledger row assigned by the dispatcher: **79**.

---

You are a WRITER on **ServerStore** (Node 24 + TypeScript, pnpm, vitest, ONE gate). Read
`/home/administrator/projects/ServerStore/AGENTS.md` FIRST, then `docs/DECISION-LEDGER.md` rows **13**
(the data root lives outside the repo), **19** (the storage seam and the original GC debt), **42/53**
(the idempotent boot-migration pattern), **70/71/73** (the destructive routes that must keep working),
**74–77** (the storage discussion this slice settles) and **78** (the owner's decision — the authority
for every choice below), plus `docs/STORAGE.md`, `docs/SEAM-INDEX.md` and `docs/API.md`.

## Where you work (READ THIS TWICE)

Worktree `/home/administrator/projects/ServerStore/worktrees/sqlite-core`, branch `feat/sqlite-core`,
already created and installed. EVERY read/edit/write/bash call MUST use an ABSOLUTE path under that
worktree. Never touch the main tree. You are the only writer in flight.

Your base is the tip of `origin/main` that carries THIS brief — **resolve it and record the resolved
sha in your landing row** (`git -C /home/administrator/projects/ServerStore/worktrees/sqlite-core
rev-parse --short origin/main`). Do not trust a sha quoted from memory, including this one.

**You must NEVER touch the live data root** (`/home/administrator/serverstore-data`) or the live
service: your tests use their own scratch data roots. The dispatcher migrates and restarts the live
unit itself, after your work is verified.

You are a subagent: your background jobs DIE when your turn ends. Run the gate IN-TURN, foreground.

## Why this slice exists

The owner has decided (row 78): **one SQLite database holds keys, scopes, stores AND item bytes.**
The per-item blob files go away. Two of his requirements are CONDITIONS, not preferences —
concurrency must be **asserted** not to corrupt (a wait is fine), and the storage layer must be
**encapsulated** so a replacement stays easy.

## What to build

1. **Items live in the database.** `objects` gains a content column (an idempotent add-if-absent
   migration of the kind rows 42/53 established). Keep `store`, `name`, `sha256`, `size`,
   `created_at` exactly as they are — `sha256` is the content hash the API exposes as
   `x-serverstore-sha256` and pins depend on it; it is now simply computed from the bytes you are
   already holding. The `kind` vocabulary does NOT change: `bytes` still means "an entry is opaque
   bytes" — only the MEDIUM moves.
2. **Migration of the existing content, LOUD on any surprise.** At boot, in ONE transaction per
   store (or one per row — your call, but say which and why): for every `objects` row whose content
   is not yet in the database, read its blob file, **re-verify that the bytes hash to the row's
   `sha256`**, store them, and only after EVERY row of that store is migrated, remove that store's
   blob tree. A missing blob, a size mismatch or a hash mismatch is a **LOUD failure that stops the
   boot** — never a silent skip, never an invented value, never a partially migrated store with its
   files already deleted. The migration must be idempotent and safe to re-run.
3. **The item path stops touching the filesystem.** `read`/`write`/`list`/`remove`/`empty` all go
   through the database. `remove` and `empty` no longer need the "is this content shared?" check
   (each row carries its own bytes — say in the docs that this also REMOVES the orphan-blob class of
   bug entirely). The store-delete path removes rows and the store row; there is no blob tree left
   to remove.
4. **Concurrency hardening, in the database open path:** `PRAGMA journal_mode = WAL`,
   `PRAGMA busy_timeout = <a sensible value>` (choose one, state it, make it a named constant), and
   `PRAGMA synchronous = FULL` (corruption-safety over speed — the owner has no heavy traffic).
   **Every multi-statement mutation must run inside `BEGIN IMMEDIATE`** (minting a key writes the key
   plus its scope rows; emptying/deleting a store writes many rows) so a concurrent writer QUEUES
   rather than failing with `database is locked`.
5. **Encapsulation, which the owner asked for by name.** All item SQL and every byte of file/path
   knowledge live under `src/storage/`. No route, no core module, no console may know the medium: if
   `src/server/app.ts` or `src/core/*` still imports a path helper for items, that is a defect. The
   storage layer must present the SAME handler interface as before, so replacing the medium later is
   one handler plus a migration.
6. **Docs rewritten to match reality** (they currently describe the layout you are deleting):
   `docs/STORAGE.md` (one database file; WAL names `-wal`/`-shm` sidecars; the NEW backup rule — copy
   all three files with the service stopped, or use SQLite's own backup/`VACUUM INTO`, and NEVER a
   plain copy of the database alone, because the newest commits live in the WAL), and
   `docs/DEPLOYMENT.md`'s backup guidance updated to match. `docs/API.md` should be checked for any
   sentence that promises blob files (its wire contract does not change).

## Pins (a pin's NAME is part of the deliverable; use the **Y** prefix)

1. `PIN Y1: an entry's bytes live in the database and the blob files are gone` — write through the
   real app, read it back byte-identical, and assert there is no file under the data root holding
   that content; assert the content column is populated and `x-serverstore-sha256` still matches the
   bytes.
2. `PIN Y2: the migration imports existing content and verifies it` — build a scratch data root in
   the OLD layout (rows plus blob files), boot, and assert every entry reads back with its original
   `sha256`, that the blob tree is gone, and that a SCRATCH database with a CORRUPTED or MISSING blob
   **fails the boot loudly** rather than dropping or inventing the entry.
3. `PIN Y3: the migration preserves the keys` — before/after, every `access_keys` row (id, hash,
   label, perms, scope, timestamps) is byte-identical and a key still authenticates. This is the
   owner's one stated must-survive.
4. `PIN Y4: two PROCESSES writing at once do not corrupt and do not error` — spawn two child
   processes against the SAME database, each doing many small writes, and assert both complete
   without error, every committed row is present, and `PRAGMA integrity_check` returns `ok`.
   (In-process is not enough: `node:sqlite` is synchronous, so the real "bad luck" case is two
   processes.)
5. `PIN Y5: a reader is never blocked while a writer is working` — during a burst of writes, a reader
   in a second process must answer within a bounded latency (measure it; a bound like 100 ms with a
   large margin is fine, but it must FAIL on a rollback-journal build — prove that with an arm).
6. `PIN Y6: an abrupt kill mid-write cannot corrupt` — SIGKILL a child process in the middle of a
   multi-row transaction, then assert the database still opens, `integrity_check` is `ok`, and the
   uncommitted rows are ABSENT (atomic, not partially applied).
7. `PIN Y7: the configuration is what the claim rests on` — `journal_mode = WAL`, a non-zero
   `busy_timeout`, `synchronous = FULL` on the real connection, and every multi-statement mutation
   inside `BEGIN IMMEDIATE` (assert it by driving a mutation while another process holds a write
   lock: it must WAIT and then succeed, never fail with `database is locked`).
8. `PIN Y8: the medium is encapsulated` — grep-level and behavioural: no item SQL or path helper
   outside `src/storage/`; the handler interface is the only surface the routes use; the existing
   object, destructive and API-doc pins stay green (X1–X9, P1–P8, A1–A3).

## Verification (yours)

1. `bash scripts/gate.sh` IN-TURN, FOREGROUND, raw log kept. `0` = VERIFIED, `2` = the suite did NOT
   run, `9` = lock busy → wait and retry. Report a FULL green run with its counts, and the wall time
   the new multi-process pins add to the gate.
2. **Commit first**, then TWO arms aimed at DIFFERENT mechanisms, each watched RED against a NAMED
   pin: (a) set the journal mode back to `DELETE` → **Y5 must go RED** (a reader blocked) while the
   other pins stay green; (b) remove the `BEGIN IMMEDIATE` wrapper (or the busy timeout) so a
   concurrent mutation fails instead of waiting → **Y7 must go RED**. Print each mutated file's
   sha256 before and after; hold the gate lock across BOTH arms; restore from `HEAD` in an
   `EXIT INT TERM` trap and assert each hash is back; `error TS` = VOID; name any pin that falls as a
   declared twin of the same mechanism.
3. `git -C /home/administrator/projects/ServerStore/worktrees/sqlite-core pull --rebase origin main`,
   then `git push origin HEAD:main`.
4. If you cannot finish, COMMIT the coherent partial state on your branch and report BLOCKED — and if
   you can PROVE a choice in row 78 wrong (including the content column, the migration shape, or the
   concurrency settings), report BLOCKED with the evidence rather than implementing around it.

## Docs to amend in the SAME commit

`docs/DECISION-LEDGER.md` **row 79**; `docs/SEAM-INDEX.md` (the storage seam: the handler as the ONE
medium boundary, the WAL/busy-timeout/`BEGIN IMMEDIATE` rules and WHY, the migration's order
verify-then-delete, and the removal of the shared-blob concept); `docs/TESTING.md` (Y1–Y8, both arms
with hashes, the multi-process cost, honest unknowns); `docs/BOARD.md` LANDED row; `docs/STORAGE.md`
and `docs/DEPLOYMENT.md` as above.
**Carry the `COPIES:` line** — `COPIES: n→1 — <the seam>` or `COPIES: 1 — checked (grepped: <what>)`.

## Your report (short)

`LANDED` or `BLOCKED`, then: the resolved base sha; the code sha; gate counts and the new pins' cost;
each arm with its printed hashes and exactly which pin went red; the `COPIES:` line; every judgement
call the brief left open; the docs amended; and anything this brief got wrong.
