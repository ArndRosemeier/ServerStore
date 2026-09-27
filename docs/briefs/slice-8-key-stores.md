# Brief — slice 8 (B1): a key is scoped to a SET of stores

Cut from `docs/BRIEF.md`. Self-contained. Ledger row assigned by the dispatcher: **42**.

---

You are a WRITER on **ServerStore** (Node 24 + TypeScript, pnpm, vitest, ONE gate). Read
`/home/administrator/projects/ServerStore/AGENTS.md` FIRST, then `docs/DECISION-LEDGER.md` rows 2, 6,
8, **30**, **39**, **40**, **41**, `docs/SEAM-INDEX.md` ("Who may MINT" included), and `docs/API.md`.

## Where you work (READ THIS TWICE)

Worktree `/home/administrator/projects/ServerStore/worktrees/key-stores`, branch `feat/key-stores`,
base `origin/main` = **2b7eb41**, already installed. EVERY read/edit/write/bash call MUST use an
ABSOLUTE path under that worktree. Never touch the main tree. You are the only writer in flight.

You are a subagent: your background jobs DIE when your turn ends. Run the gate IN-TURN, foreground.

## The intent

The owner's registration model (row 30, verbatim): *"I would just give a key to somebody and then be
able to define what that key actually can do … It would be sufficient i think to just define which
of the stores the key can access."* Today a key holds **exactly one** store name, or `*`
(`access_keys.store`, and `Auth.authorize` compares against a single string), so that sentence cannot
be expressed. Row 41 records the mechanism decision this slice implements.

**The ONE seam: the key's SCOPE** — where it is stored, how it is resolved with the key, and how
`authorize` decides. Extend that one model; do not add a second authorization path.

## What to build (the shape is decided; the details are yours, and every judgement call gets recorded)

1. **Schema (row 41's decision).** A `key_stores(key_id, store)` table with a FOREIGN KEY per store,
   created idempotently like the rest of the schema. **The master case must stay expressible**:
   `*` is not a row in `stores`, so an FK cannot hold it — pick the shape and STATE it (recommended:
   a `scope_all` flag on `access_keys` plus `key_stores` rows only for real stores, which keeps the
   FK meaningful; the old `store` column then becomes dead — drop it if SQLite does it cleanly, and
   if you keep it, say in the schema comment that it is dead and why). **Migrate existing rows**:
   `store='*'` → `scope_all`, otherwise one `key_stores` row. No code may read the old single-store
   column as the source of truth afterwards.
2. **Resolution and authorization.** `resolveKey` loads the scope ONCE with the key (no N+1 inside
   `authorize`). `authorize(store, perm)` passes when the key spans all stores OR the store is in its
   set; otherwise **403** with a message naming the key's actual scope. `requireMasterAdmin` keeps
   its meaning (spans all + `admin`).
3. **`POST /keys` takes `stores: string[]`** (a single-element array is legal; `["*"]` is the master
   case). Reject **empty** and **mixed** (`["*","notes"]`) lists with a named error, and refuse a
   store that does not exist. Every existing rule generalizes: only a key holding `admin` may mint
   (row 39); a minting key may only mint within its OWN set (a scoped admin's set must contain every
   requested store); an `admin` grant still needs a master admin and `["*"]`.
4. **`GET /whoami`** — the caller's `id`, `label`, `stores` (`["*"]` for a master), `perms`,
   `expiresAt`, `lastUsedAt`; **no secret, ever**. 401 without a valid key.
5. **`docs/API.md` in the SAME commit** — the `POST /keys` body, the new route, and the scope
   semantics. **PIN A1–A3 must stay green** (you are adding one route, so the doc must list it and
   the pin must see it in both directions).
6. **Out of scope:** listing keys and the REVOKE route (that is B2, next), per-store permissions
   (row 41 counts it unproven), the UI (step C).

## Pins (a pin's NAME is part of the deliverable)

1. `PIN G1: a key scoped to [a,b] reads and writes a and b, and is refused c` — 403, and c's bytes
   are untouched.
2. `PIN G2: a scoped ADMIN key mints only inside its own set` — may mint for a store in its set
   (201), refused for one outside it (403), nothing minted on the refusal.
3. `PIN G3: POST /keys rejects an empty list, a mixed ['*', a] list, and a store that does not
   exist` — each with a named code, and nothing minted.
4. `PIN G4: GET /whoami returns the caller's id, label, stores and perms, and no secret` — and 401
   without a key.
5. `PIN G5: a master key (['*']) still spans every store, and only a master may grant 'admin'` —
   both directions.
6. `PIN G6: a key row written in the OLD single-store shape still works after the migration` — seed
   the old shape, open the database, and assert the key still authorizes exactly as before.

Reuse the ONE fixture set (`tests/keys.test.ts`, `tests/auth.test.ts`); never a second one.

## Verification (yours)

1. `bash scripts/gate.sh` IN-TURN, FOREGROUND, raw log kept. `0` = VERIFIED, `2` = the suite did NOT
   run, `9` = lock busy → wait and retry. Report a FULL green run.
2. Your differential: **commit first**, then TWO arms in opposite directions —
   (a) `authorize` ignores the store set (spans everything) → **G1 must go RED**;
   (b) the migration skips the legacy row (a pre-existing key loses its scope) → **G6 must go RED**,
   which is what proves the migration is real rather than asserted. Print the file's sha256 before
   and after each arm; hold the lock across both; restore from `HEAD` in an `EXIT INT TERM` trap;
   identical arms = VOID.
3. `git -C <worktree> pull --rebase origin main`, then `git push origin HEAD:main`.
4. If you cannot finish, COMMIT the coherent partial state on your branch and report BLOCKED.

## Docs to amend in the SAME commit

`docs/DECISION-LEDGER.md` **row 42**; `docs/SEAM-INDEX.md` (the scope seam: where a key's stores live,
how they are loaded, and where the membership test happens — plus any migration note); `docs/TESTING.md`
(G1–G6 and both arms with hashes); `docs/BOARD.md` LANDED row; `docs/API.md`. Carry the `COPIES:` line.

## Your report (short)

`LANDED` or `BLOCKED`, then: sha; gate counts + peak; each arm with its printed hash and what went
red; the `COPIES:` line; **the schema shape you chose and why** (the `*` case especially); judgement
calls; docs amended; and anything this brief got wrong.
