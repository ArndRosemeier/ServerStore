# Brief — slice 9 (B2): key listing and the revoke route

Cut from `docs/BRIEF.md`. Self-contained. Ledger row assigned by the dispatcher: **46**.

---

You are a WRITER on **ServerStore** (Node 24 + TypeScript, pnpm, vitest, ONE gate). Read
`/home/administrator/projects/ServerStore/AGENTS.md` FIRST, then `docs/DECISION-LEDGER.md` rows 6, 30,
**39**, **41**, **42**, **44**, **45**, `docs/SEAM-INDEX.md`, and `docs/API.md`.

## Where you work (READ THIS TWICE)

Worktree `/home/administrator/projects/ServerStore/worktrees/key-lifecycle`, branch
`feat/key-lifecycle`, base `origin/main` = **12f3061**, already installed. EVERY read/edit/write/bash
call MUST use an ABSOLUTE path under that worktree. Never touch the main tree. You are the only writer
in flight.

You are a subagent: your background jobs DIE when your turn ends. Run the gate IN-TURN, foreground.

## Why this slice exists

The step-C admin UI cannot be built without it (row 30), and tonight made it operational: the live
store held **three** master keys, and revoking the two unused ones was **operator-only** — the
dispatcher had to open the database (row 45) because no route exists. `revokeKey()` and
`findKeyById()` are in `src/core/keys.ts`; there is **no listing seam yet**.

**The ONE seam: the key LIFECYCLE (read + revoke).** Use the functions that exist; do not add a
second authorization path.

## What to build

1. **`GET /keys`** — admin only. Each entry: `id`, `label`, `stores` (`["*"]` for a master),
   `perms`, `createdAt`, `expiresAt`, `lastUsedAt`, `revokedAt`. **Never the hash.** The stored
   `prefix` exists for display — include it or not, but decide and say why in the doc. A **master**
   sees every key; a **store-scoped admin** sees only keys whose scope lies within its own stores.
   No pagination (the population is small) — say that explicitly rather than leaving it unstated.
2. **`POST /keys/:id/revoke`** — admin only, **idempotent**, using `revokeKey()`; report whether it
   changed (`{ id, revokedAt, changed }`), `404` for an unknown id. Rules that must hold: a
   store-scoped admin may revoke only keys **it could have minted** (scope within its own stores, and
   never a key holding `admin`); a master may revoke any key, including another master's.
   **Self-revocation is ALLOWED** (it is the caller's own credential) and the doc must warn that it
   takes effect immediately. No key material in the response.
3. **`docs/API.md` in the SAME commit** — both routes; **PIN A1–A3 must stay green** (two new
   routes: the doc must list them and the pin must see them both ways).
4. **Out of scope:** the UI (step C), rate limiting, per-store permissions.

## Pins (a pin's NAME is part of the deliverable)

1. `PIN L1: GET /keys is admin-only and returns NO key material` — 401 without a key, 403 for a
   non-admin, and the response body contains neither the hash nor the secret of any minted key.
2. `PIN L2: a scoped admin lists only the keys inside its own stores` — and a master lists all.
3. `PIN L3: a revoked key is refused on the NEXT request` — revoke it, then use it: 401, no restart.
4. `PIN L4: a scoped admin cannot revoke outside its own scope, and cannot revoke a master key` —
   403, and the target is still usable afterwards.
5. `PIN L5: revoke is idempotent` — the second call reports `changed: false` and the timestamp does
   not move.
6. `PIN L6: an unknown key id is 404, and self-revocation works` — the caller's own key can revoke
   itself, recorded deliberately rather than discovered.

Reuse the ONE fixture set (`tests/keys.test.ts`); never a second one.

## Verification (yours)

1. `bash scripts/gate.sh` IN-TURN, FOREGROUND, raw log kept. `0` = VERIFIED, `2` = the suite did NOT
   run, `9` = lock busy → wait and retry. Report a FULL green run.
2. Your differential: **commit first**, then TWO arms in opposite directions —
   (a) `GET /keys` includes the hash → **L1 must go RED**;
   (b) the revoke route ignores the scope rules → **L4 must go RED**.
   Print the file's sha256 before and after each arm; hold the lock across both; restore from `HEAD`
   in an `EXIT INT TERM` trap; identical arms = VOID. **Never print a real key.**
3. `git -C <worktree> pull --rebase origin main`, then `git push origin HEAD:main`.
4. If you cannot finish, COMMIT the coherent partial state on your branch and report BLOCKED.

## Docs to amend in the SAME commit

`docs/DECISION-LEDGER.md` **row 46**; `docs/SEAM-INDEX.md` (the lifecycle seam: where listing and
revocation live); `docs/TESTING.md` (L1–L6, both arms with hashes); `docs/BOARD.md` LANDED row;
`docs/API.md`. Carry the `COPIES:` line.

## Your report (short)

`LANDED` or `BLOCKED`, then: sha; gate counts + peak; each arm with its printed hash and what went
red; the `COPIES:` line; **your prefix decision and why**; judgement calls; docs amended; and
anything this brief got wrong.
