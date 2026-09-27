# Brief — slice 7 (B0.1): only ADMIN keys may mint

Cut from `docs/BRIEF.md`. Self-contained. Ledger row assigned by the dispatcher: **39**.

---

You are a WRITER on **ServerStore** (Node 24 + TypeScript, pnpm, vitest, ONE gate). Read
`/home/administrator/projects/ServerStore/AGENTS.md` FIRST, then `docs/DECISION-LEDGER.md` rows 2, 6,
8, 30, **35**, 36, 37, 38, `docs/SEAM-INDEX.md`, and `docs/API.md`'s `POST /keys` section.

## Where you work (READ THIS TWICE)

Worktree `/home/administrator/projects/ServerStore/worktrees/mint-admin`, branch `feat/mint-admin`,
base `origin/main` (the dispatcher will name the sha in the dispatch; it is the tip after slice 6),
already installed. EVERY read/edit/write/bash call MUST use an ABSOLUTE path under that worktree.
Never touch the main tree. You are the only writer in flight.

You are a subagent: your background jobs DIE when your turn ends. Run the gate IN-TURN, foreground.

## Why this slice exists

Slice 6 (B0) closed a **confirmed escalation** (row 35): a read-only key could mint `write`+`delete`
for its own store. It closed it by the rule *"a key may pass on only what it holds"* — the subset
rule. **The owner then chose a STRICTER rule, and this slice implements it: only an ADMIN key may
mint at all** (ledger row 38). The consequence is precise and must be handled honestly:

- With minting restricted to holders of `admin`, the subset check can never fire, because `admin`
  implies every permission (`Auth.grantablePermissions`). **It becomes unreachable code.**
- A read-only key may therefore no longer mint even a read-only key — which is exactly what the
  owner wants: **every key traces to an admin action** (his UI, or a game backend he gave an admin
  key for its store), instead of keys appearing that he never issued.

## The ONE seam

The same authorization decision in `POST /keys` (`src/server/app.ts`) that slice 6 touched: the
STORE boundary and the PERMISSION boundary are one branch, and this slice narrows **who may mint**.

## What to build

1. **Require `admin` on the minter.** Before anything else in the mint path, a key that does not hold
   `admin` → **403 `forbidden`**, message saying only an admin key may mint, and **nothing is
   minted**. A **store-scoped** admin key (a key holding `admin` and scoped to one store) MAY mint —
   that is the game-backend flow and must keep working — but only within its own store.
2. **Remove what the new rule makes unreachable, and record why.** The subset check
   (`lacks` / `grantablePermissions`) cannot fire once only admins mint. Either delete it, or keep it
   with an explicit comment naming the condition under which it becomes reachable again — **your
   call, but say which and why**, and do not leave an untested branch behind. If you keep it, you
   MUST pin its behaviour at the level it can still be reached (say how); if you remove it, the
   replacement rule is "a non-admin key cannot mint", which is pinned below. Whichever you choose,
   **write the prerequisite into the seam index**: *any future slice that lets a NON-admin key mint
   must reinstate the subset rule in the same commit.*
3. **Everything else stays:** a scoped key may only mint within its own store; an `admin` grant still
   requires a MASTER admin key AND `scope *`; a `spansStores` non-admin grant must name an existing
   store; no wire-format change; no route added, removed or renamed (so PIN A1–A3 stay green).
4. **`docs/API.md` changes in the SAME commit** — the `POST /keys` row and the Authentication
   section must say **who may mint** (an admin key, including a store-scoped one within its store),
   not merely what may be granted.

## Pins (a pin's NAME is part of the deliverable)

1. `PIN M1: a non-admin key cannot mint ANY key, not even one with a subset of its own permissions`
   — 403, and the key count is unchanged.
2. `PIN M2: a store-scoped ADMIN key mints within its store` — 201 for `read` and for `read`+`write`;
   the child can write (201) and is refused a DELETE it was not granted (403).
3. `PIN M3: a store-scoped admin key still cannot mint for another store` — 403.
4. `PIN M4: only a MASTER admin key may grant 'admin', and only for scope '*'` — unchanged, both
   directions.
5. `PIN M5: a master admin key still mints any non-admin permission for any existing store` — the
   bootstrap path (your own positive control), and the child can delete when granted `delete` (204).

Reuse the ONE fixture set (`tests/keys.test.ts`, extending `tests/auth.test.ts` if that is where the
mint pins live). Keep the existing pin names where their meaning is unchanged; **rename or replace a
pin only when its MEANING changed, and say so in TESTING.md** (slice 6's K1–K3 asserted the subset
rule through the route; that route no longer reaches it).

## Verification (yours)

1. `bash scripts/gate.sh` IN-TURN, FOREGROUND, raw log kept. `0` = VERIFIED, `2` = the suite did NOT
   run, `9` = lock busy → wait and retry. Report a FULL green run.
2. Your differential: **commit first**, then TWO arms in OPPOSITE directions —
   (a) delete the admin requirement → **M1 must go RED** (a read-only key mints again);
   (b) make it STRICTER than correct (require a MASTER admin instead of any admin) →
   **M2 must go RED** while M1/M5 stay green — that is what proves the pin distinguishes a
   store-scoped admin from a master admin, and that the slice did not simply break the flow.
   Print the file's sha256 before and after each arm; hold the lock across both; restore from `HEAD`
   in an `EXIT INT TERM` trap; identical arms = VOID.
3. `git -C <worktree> pull --rebase origin main`, then `git push origin HEAD:main`.
4. If you cannot finish, COMMIT the coherent partial state on your branch and report BLOCKED.

## Docs to amend in the SAME commit

`docs/DECISION-LEDGER.md` **row 39**; `docs/SEAM-INDEX.md` (the mint rule, and the reinstatement
prerequisite from §2); `docs/TESTING.md` (M1–M5, the arms with hashes, and a note on any pin whose
meaning changed from slice 6); `docs/BOARD.md` LANDED row; `docs/API.md` as above. Carry the
`COPIES:` line.

## Your report (short)

`LANDED` or `BLOCKED`, then: sha; gate counts + peak; each arm with its printed hash and what went
red; the `COPIES:` line; **your §2 decision with its reason**; judgement calls; docs amended; and
anything this brief got wrong.
