# Brief — slice 6 (B0): a key may not mint permissions it does not hold

Cut from `docs/BRIEF.md`. Self-contained. Ledger row assigned by the dispatcher: **36**.

---

You are a WRITER on **ServerStore** (Node 24 + TypeScript, pnpm, vitest, ONE gate). Read
`/home/administrator/projects/ServerStore/AGENTS.md` FIRST, then `docs/DECISION-LEDGER.md` rows 2,
6, 8, 30, 33, 34, **35**, `docs/SEAM-INDEX.md`, and `docs/API.md`'s `POST /keys` section.

## Where you work (READ THIS TWICE)

Worktree `/home/administrator/projects/ServerStore/worktrees/keys-subset`, branch `feat/keys-subset`,
base `origin/main` = **267fe50**, already installed. EVERY read/edit/write/bash call MUST use an
ABSOLUTE path under that worktree (or pass a working directory) — relative paths resolve against the
MAIN repo. Never touch the main tree. You are the only writer in flight.

You are a subagent: your background jobs DIE when your turn ends. Run the gate IN-TURN, foreground.

## The intent, and the defect

The project's core intent (rows 2 and 6) is **"grant LIMITED permissions — the key IS the principal
AND the limit."** A measured defect breaks it, reproduced by the dispatcher on a temp data root
(row 35): a key minted `{store:"master", perms:["read"]}` calls
`POST /keys {store:"master", perms:["write","delete"]}` → **201** with `perms:["write","delete"]`,
and the minted key then **writes (201)** and **deletes (204)**. Cross-store (403) and `admin` (403)
attempts DO hold. Cause, read in the code: `POST /keys` constrains a store-scoped key only to its own
STORE; **nothing checks that the requested permissions are a subset of the minter's own.**

**The ONE seam: the authorization decision inside `POST /keys`** (`src/server/app.ts`) — the branch
that already enforces the STORE boundary must also enforce the PERMISSION boundary. Not a second
authorization path, not a new middleware.

## What to build

1. **The subset rule.** Before anything is minted, the requested `perms` must be a **subset of the
   minter's own**, treating `admin` as implying every permission (so a master admin key can still
   grant anything — that is the owner's bootstrap path and must keep working). Otherwise →
   **403 `forbidden`**, the message naming the permission(s) the minter lacks, and **nothing is
   minted** (no row, no side effect — assert the key count is unchanged).
   Every existing rule stays exactly as it is: `admin` grants still need a master admin key AND
   `scope *`; a scoped key may still only mint within its own store; a `spansStores` non-admin key
   must still name a store.
   **ONE predicate, one place** — do not duplicate the subset logic between the route and a helper
   (AGENTS.md rule 4). Say in the seam index where it lives.
2. **Pins** (a pin's NAME is part of the deliverable):
   - `PIN K1: a READ-ONLY key cannot mint a permission it does not hold` — 403, and no key was added.
   - `PIN K2: a key lacking 'delete' cannot mint 'delete'` — 403.
   - `PIN K3: a key passes on exactly what it holds, and no more` — positive: a read+write key mints
     read+write → 201, and the new key is then refused a DELETE (403).
   - `PIN K4: the boundaries that already held still hold` — another store → 403; `admin` → 403
     without a master admin key and `scope *`.
   - `PIN K5: a master admin key still mints any non-admin permission for any existing store` —
     the positive control for the bootstrap path.
   Reuse the existing harness (`tests/auth.test.ts`, or a new `tests/keys.test.ts`); **never a second
   fixture set.**
3. **`docs/API.md` changes in the SAME commit.** It currently documents the escalation as behaviour.
   State the subset rule where the doc describes `POST /keys` and what a key can do, so the doc and
   the code still agree — **PIN A1–A3 must stay green** (they will if no route or code is added,
   removed or renamed; if you believe one must change, say so before doing it).
4. **No wire-format change**: the error envelope stays `{error:{code,message}}`.

## Verification (yours)

1. `bash scripts/gate.sh` IN-TURN, FOREGROUND, raw log kept. `0` = VERIFIED, `2` = the suite did NOT
   run, `9` = lock busy → wait and retry. Report a FULL green run.
2. Your differential: **commit first**, then TWO arms, because one direction is not enough here —
   (a) delete the subset check → **K1/K2 must go RED**; (b) make it STRICTER than correct (e.g.
   require the requested perms to EQUAL the minter's) → **K3 must go RED**, which is what proves the
   pin is not vacuous. Print each file's sha256 before and after; hold the lock across both arms;
   restore from `HEAD` in an `EXIT INT TERM` trap; identical arms = VOID.
3. `git -C <worktree> pull --rebase origin main`, then `git push origin HEAD:main`.
4. If you cannot finish, COMMIT the coherent partial state on your branch and report BLOCKED.

**Out of scope, but REPORT it if you find it:** the same CLASS of hole on another route (a caller
able to exceed its own limits, e.g. via `POST /stores` or the object routes). Do not fix it here —
record it in your report so the dispatcher can queue it.

## Docs to amend in the SAME commit

`docs/DECISION-LEDGER.md` **row 36**; `docs/SEAM-INDEX.md` (the key-minting rule and where the subset
decision lives); `docs/TESTING.md` (K1–K5 plus both arms with their hashes); `docs/BOARD.md` LANDED
row; `docs/API.md` as above. Carry the `COPIES:` line.

## Your report (short)

`LANDED` or `BLOCKED`, then: sha; gate counts + peak; each arm with its printed hash and what went
red; the `COPIES:` line; judgement calls; docs amended; and anything this brief got wrong — including
anywhere the same class of hole appears.
