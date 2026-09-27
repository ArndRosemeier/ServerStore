# The board — what is happening right now

**This file is the state of record.** It is true *before* any report reaches the
owner. A successor session must be able to act within minutes from this file plus
`git log --oneline -10 origin/main` and `git worktree list`.

**One screen, overwritten in place.** A record that no longer describes the present
belongs in the decision ledger or nowhere.

## The contract

1. **Updated in the same commit as the landing it records.**
2. **True BEFORE the dispatcher reports to the owner.** If the session dies the
   second after that report, a successor must be able to act from this file, the
   ledger, and git alone.
3. **Every record names something checkable** — sha, branch, worktree, session id,
   path. "Probably fine" is not a record.
4. **Session start = reconcile first** (`bash scripts/board.sh`). Read it, check it
   against reality, fix what lied, report ONE line, and only then dispatch.
5. **Reconcile against the REMOTE branch, never a stale local one.** A landing once
   read as "unlanded" for hours while it was pushed and five commits ahead of a
   stale local branch.

## Record vocabulary

One line per record, `PREFIX | field=value | …`, so a query is a `grep` and the
answer is a line, not a paragraph.

| Prefix | Means |
| --- | --- |
| `reconciled: <sha> · <timestamp>` | the commit the rest of this file was checked against |
| `SESSION` | an actor that may dispatch (id, model, state) |
| `PROBE` | a read-only agent in flight and the question it answers |
| `IN-FLIGHT` | a writer: row, session, worktree, branch, base, **state**, and the full scope |
| `LANDED` | a verified landing: row, sha, **the dispatcher's own verification numbers**, what was retired, the docs amended |
| `retired_branch=<name>` | a CLAIM that `<name>` is retired — the **only** form the reconciler parses, read literally, one line per branch. Prose about a retirement (especially one still OWED) must not use this key: a prose-matching parser read "retired=NOT yet … branch feat/x" as a claim and reported a false BOARD STALE while the branch still existed |
| `QUEUE` | owner requests and known debt not yet dispatched, with the row number reserved |
| `QUEUE-CLOSED` | a queue line whose scope is consumed (kept one screen, then dropped) |
| `TRAP` | a mistake that actually happened, with the rule that prevents it |
| `GUARD` | a mechanism protecting the process (host, memory, compaction) and how to verify it |
| `RECOVERY` | where a successor finds lost context |

---

## Board

```
reconciled: 1063e29 · 2026-09-27T23:02Z — the row-39 landing's CODE tip (only an admin key may
  mint; the subset rule deleted as unreachable). The docs commit carrying THIS marker is its child,
  so the marker is the code tip and not itself — a commit cannot name its own sha. `bash
  scripts/board.sh` must report this marker as an ancestor of origin/main, which is true from the
  moment the dispatcher pushes the rebased branch. verify=THE WRITER'S OWN in-turn gate: exit 0
  GREEN · 11 files · 80 tests · 2.07s, with the rule falsifiable in BOTH directions on its own arms
  (A: the admin requirement deleted → M1 RED, M2/M5 GREEN; B: an admin minter required to be a
  MASTER → M2 RED, M1/M3/M4/M5 GREEN); the dispatcher's own independent gate and arm are still
  OWED. (History: this line read "e1bd3cf" — the row-36 tip — and before that "e1e363f" (row 27)
  and "bec97e1" (row 26, LOCAL time mislabelled as Z, the dispatcher's error, corrected rather
  than quietly).)

SESSION | id=session-dcd6176e-b4b9-4759-b64d-4c90d3495dfa | role=dispatcher (chief of staff)
  | state=ONE writer in flight (B2, row 46: key listing + the REVOKE route). LIVE at
  |   https://store.futuremagic.de running main@5ae13b4 (restarted 23:05:03) with the B1 schema;
  |   EXACTLY ONE live admin key (the owner's; the two stray ones are revoked — row 45); keyless
  |   probe PASS exit 0; loopback only. After B2: step C (the admin UI), then rate limiting.
  | goal=goal-1f2f2e27-ed8d-470d-8499-c1eeed63b3b6 (paused; untouched since creation)
  | host=12 cores · 23Gi RAM · / has 506GB free · process audit after this landing: lock
  |   free, 0 suite processes, 0 entrypoint processes, 0 browser processes.
  | remote=https://github.com/ArndRosemeier/ServerStore.git — PUBLIC, owner-created 2026-09-27.
  |   origin/main carries slices 1-3; the LANDED records below name their shas.

LANDED | row=46 | sha=7cc3afe (the VERIFIED CODE tip: `src/core/keys.ts`, `src/server/app.ts`,
  | `tests/keys.test.ts`, plus `docs/API.md` and `docs/SEAM-INDEX.md`; the docs commit carrying
  | THIS line, the ledger row 46 and docs/TESTING.md is its child — a commit cannot name its
  | own sha) | THE KEY LIFECYCLE: `GET /keys` + `POST /keys/:id/revoke`, writer session (a subagent
  | of dispatcher session dcd6176e-b4b9-4759-b64d-4c90d3495dfa), worktree
  | worktrees/key-lifecycle, branch feat/key-lifecycle, base origin/main 12f3061, REBASED onto
  | origin/main f4ee41c before push. The pre-push rebase replayed the pre-rebase code tip
  | `534189c` as `7cc3afe` (`git diff --stat 534189c 7cc3afe -- src tests docs/API.md
  | docs/SEAM-INDEX.md` is EMPTY), so the differential transcript's CONTROL line naming
  | `534189c` describes exactly the code that lands; the ledger conflict was resolved as a
  | mechanical UNION (this row 46 first, then the dispatcher's rows 47-48 verbatim —
  | `git diff f4ee41c..HEAD -- docs/DECISION-LEDGER.md docs/BOARD.md` is insertions only,
  | 0 deletions).
  | verify=THE WRITER'S OWN, in-turn: `bash scripts/gate.sh` → exit 0 (GREEN) · 11 test files ·
  | 92 tests · 2.00s · raw log `.gate-logs/gate.log`; no memory ceiling needed (GUARD g3 still
  | open and still honest). The DISPATCHER's independent gate and its own arms are OWED.
  | arms=checkpoints/key-lifecycle-differential.sh, the gate lock held across BOTH arms, sha256
  | printed before and after, restore from HEAD in an EXIT/INT/TERM trap, a control BEFORE and
  | AFTER, raw transcript checkpoints/key-lifecycle-differential.out (key-shaped strings
  | scrubbed — ledger row 21):
  |   A `GET /keys` INCLUDES THE HASH (a `hash` field added to every entry), src/server/app.ts
  |     d8a056dc…b86ef → fd7f35a8…73df, RED on `PIN L1: GET /keys is admin-only and returns NO
  |     key material` — `expected '{"keys":…}' not to contain '<sha256>'`; L2-L6 stayed GREEN.
  |   B the REVOKE SCOPE RULES are IGNORED (`if ((false as boolean)) {`), src/server/app.ts
  |     d8a056dc…b86ef → 0be47025…bbd5, RED on `PIN L4: a scoped admin cannot revoke outside its
  |     own scope, and cannot revoke a master key` — `expected 200 to be 403`; L1/L2/L3/L5/L6
  |     stayed GREEN. Arm B's FIRST draft (a literal `&& false`) broke the TYPECHECK (TS18047
  |     'target' is possibly 'null'), so it proved "the tree does not compile" rather than "L4
  |     sees the missing boundary"; the arm was made surgical and the harness now FAILS an arm
  |     whose cheap tier carries `error TS`. The discarded draft is recorded in docs/TESTING.md.
  |   both controls GREEN (11 files · 92 tests), app.ts back at d8a056dc…b86ef. The two arms
  |     carry DIFFERENT hashes from the SAME before-hash. No VOID probe.
  | what it is=the key lifecycle is self-service (ledger row 46). `GET /keys` is admin-only and
  |   returns, per key, `id`, `label`, `stores`, `prefix`, `perms`, `createdAt`, `expiresAt`,
  |   `lastUsedAt`, `revokedAt` — NO raw key, NO secret, NO `sha256`; revoked keys are INCLUDED
  |   (`revoked_at` set) so the inventory is the audit view; NO PAGINATION, stated rather than
  |   left unstated. A master sees every key; a store-scoped admin sees only keys whose scope
  |   lies inside its own set. `POST /keys/:id/revoke` is idempotent via `revokeKey()` and reports
  |   `{id, revokedAt, changed}` — `revokedAt` read back from the ROW, never the clock, so a second
  |   call reports `changed:false` and the timestamp cannot move; an unknown id is `404`. A master
  |   may revoke any key (including another master's); a store-scoped admin only keys it could have
  |   minted (scope inside its set, never one holding `admin`); SELF-REVOCATION is ALLOWED
  |   deliberately (the caller's own credential, the one case exempt from the scope rules) and
  |   takes effect on the NEXT request.
  | what it does NOT add=a second authorization path. `Auth.requireAdmin(action)` is the row-39
  |   predicate with the action in its message, and `Auth.holdsStores(stores)` is the ONE
  |   scope-containment predicate the mint boundary, the list filter and the revoke boundary all
  |   route through (the mint branch's inline check was REPLACED by a call, not copied).
  |   `listKeys()` in `src/core/keys.ts` is the read seam: two queries whatever the population,
  |   ordered `created_at, id`.
  | prefix=RETURNED, and why: it is `ssk_` + the first 8 chars of the already-public `id`, so the
  |   secret (which starts after the id) contributes no byte; returning it lets a console show the
  |   mint-time handle without re-deriving the rendering. `GET /whoami` still returns no prefix.
  | wire format=`{error:{code,message}}` unchanged; NO new error code, TWO new routes
  |   (`GET /keys`, `POST /keys/:id/revoke`), so docs/API.md was amended in the SAME commit as the
  |   code and pins A1-A3 stay green (11 files · 92 tests, tests/api-doc.test.ts 3/3).
  | docs=docs/DECISION-LEDGER.md row 46 · docs/SEAM-INDEX.md (the lifecycle seam: where listing and
  |   revocation live, the ONE scope predicate, the row-33 revoke finding CLOSED, the route-count
  |   prose de-numbered) · docs/TESTING.md (L1-L6, both arms with their hashes, the prefix decision,
  |   and four new honest unknowns) · docs/API.md (both routes, the scope rules, the prefix
  |   decision, no pagination, the self-revocation warning, the non-goals) · this board.
  | COPIES: 1→1 — the scope-containment predicate is DEFINED ONCE (`Auth.holdsStores`) and now
  |   carries three call sites (mint boundary, list filter, revoke boundary); the mint branch's
  |   inline `ALL_STORES`/array check was replaced by a call to it rather than copied. Grepped:
  |   "holdsStores", "spansStores", "requireAdmin", "listKeys", "findKeyById", "revokeKey",
  |   "describeStores".
  | GUARD g5 APPLIES: this landing touches `src/`, so the live service is still running the B1
  |   code — the DISPATCHER must restart the unit and re-run `scripts/probe-live.sh
  |   https://store.futuremagic.de` before the owner relies on the routes.
  | retired=none yet. The worktree worktrees/key-lifecycle and branch feat/key-lifecycle are the
  | dispatcher's to retire after ITS OWN verification; this writer does not retire itself.

LANDED | row=42 | sha=e4d12b4 (the VERIFIED CODE tip: `src/core/db.ts`, `src/core/keys.ts`,
  | `src/core/validate.ts`, `src/core/types.ts`, `src/core/errors.ts`, `src/server/app.ts`,
  | `src/admin/mint-key.ts`, `tests/keys.test.ts`, `tests/helpers/server.ts`, plus
  | `docs/API.md`; the docs commit carrying THIS line, the ledger row and docs/TESTING.md is
  | its child — a commit cannot name its own sha) | A KEY'S SCOPE IS A SET OF STORES, writer session
  | c596e5cf-035c-4261-80a8-a6e8e5017c68 (subagent of dispatcher session dcd6176e…),
  | worktree worktrees/key-stores, branch feat/key-stores, base origin/main 0cfba87 — the
  | branch was fast-forwarded onto the dispatcher's IN-FLIGHT commit before any edit, because
  | the brief's base 2b7eb41 had already moved (row 40's lesson applied) — then REBASED onto
  | origin/main e35c594 before push (a mechanical DOCS UNION: the ledger kept the dispatcher's
  | rows 43 AND 43b alongside this slice's row 42, and `git diff --name-only` from e4d12b4 to
  | the docs commit lists only this landing's own six files. The rebase REWROTE the code commit
  | c27b61c into e4d12b4; `git diff --stat c27b61c e4d12b4 -- src tests docs/API.md` is EMPTY, so
  | the gate and the arms below ran on exactly the code that lands).
  | verify=THE WRITER'S OWN, in-turn: `bash scripts/gate.sh` → exit 0 (GREEN) · 11 test files ·
  | 86 tests · 2.03s (and 2.07s on the pre-rebase tree, same counts) · raw log
  | `.gate-logs/gate.log`; no memory ceiling needed (GUARD g3 still open and still honest).
  | The DISPATCHER's independent gate and its own arms are OWED.
  | GUARD g5 APPLIES to this landing: B1 changes the SCHEMA, so the live service must be
  | RESTARTED and `scripts/probe-live.sh https://store.futuremagic.de` re-run BEFORE the owner
  | mints — the migration runs when a process OPENS the database, and the running process still
  | holds the pre-B1 code.
  | arms=checkpoints/key-stores-differential.sh, the gate lock held across BOTH arms, sha256
  | printed before and after, restore from HEAD in an EXIT/INT/TERM trap, a control BEFORE
  | and AFTER, raw transcript checkpoints/key-stores-differential.out (key-shaped strings
  | scrubbed — ledger row 21):
  |   A `authorize` IGNORES the store set (`… && false`), src/server/app.ts
  |     921e3f32…2101 → 12a37481…a243e5, RED on `PIN G1: a key scoped to [a,b] reads and
  |     writes a and b, and is refused c` — `expected 200 to be 403`; G2/G3 stayed GREEN.
  |     PIN 2 and PIN G6 ALSO fell (they stand on the same shared predicate) and that is
  |     recorded in docs/TESTING.md rather than hidden by a looser assertion.
  |   B the MIGRATION skips the legacy row (the `INSERT INTO key_stores …` is dropped),
  |     src/core/db.ts 1c715908…d76a → fa0976a8…1b53, RED on `PIN G6: a key row written in the
  |     OLD single-store shape still works after the migration` — `expected [] to deeply equal
  |     [ { store: 'alpha' } ]` (the scope row was never written), with G1/G2/G4/G5 GREEN
  |   both controls GREEN (11 files · 86 tests), both files back at their before hashes. The
  |     two arms carry DIFFERENT hashes in DIFFERENT files. No VOID probe.
  | what it is=a key's SCOPE is a SET of stores (ledger rows 30/41/42). `access_keys.scope_all`
  |   carries the `["*"]` master case — an FK cannot hold `*`, which is not a row in `stores` —
  |   and every OTHER scope is one `key_stores(key_id, store)` row with an FK per store, so a
  |   stored scope can never name a missing store. The pre-slice-8 `store` column is MIGRATED
  |   (ONE transaction: `*` → scope_all, one row per name) and then DROPPED, so there is no
  |   second source of truth. `resolveKey` loads the scope ONCE with the key (no N+1);
  |   `Auth.authorize` is ONE membership test (spans all OR the store is in the set) whose 403
  |   names the key's ACTUAL scope; `requireMasterAdmin` is unchanged. `POST /keys` takes
  |   `stores: string[]` (empty/mixed/duplicate → 400 `invalid_scope`; unknown store → 404;
  |   every refusal precedes `mintKey`, which writes the row and its scope in ONE transaction);
  |   `GET /whoami` returns id/label/stores/perms/expiresAt/lastUsedAt and NEVER a secret.
  | removed=the OLD single-store `access_keys.store` column, and the old rule "a non-admin
  |   grant must name a store" (with sets, `["*"]` is a legal scope for any permission when the
  |   caller is a master). `stores` is REQUIRED — the old "omit it and inherit the caller's
  |   scope" default is deliberately NOT carried over. Ledger row 42 records all seven
  |   judgement calls.
  | wire format=`{error:{code,message}}` unchanged; ONE new error code (`invalid_scope`, 400)
  |   and ONE new route (`GET /whoami`), so docs/API.md was amended in the SAME commit as the
  |   code and pins A1–A3 stay green (11 files · 86 tests, `tests/api-doc.test.ts` 3/3).
  | docs=docs/DECISION-LEDGER.md row 42 · docs/SEAM-INDEX.md (the scope seam: where the set is
  |   stored, the ONE parse, the ONE load, the ONE membership test, the migration row, the
  |   whoami finding CLOSED, B2's missing list/revoke restated) · docs/TESTING.md (G1–G6 and
  |   both arms with their hashes, plus two new honest unknowns) · docs/API.md (the route, the
  |   `stores` body, the scope semantics, `invalid_scope`, the non-goals) · this board.
  | COPIES: 2→1 — `ALL_STORES` was defined TWICE (`src/core/keys.ts` and
  |   `src/core/validate.ts`) and now lives ONCE in `src/core/types.ts`, the shared vocabulary;
  |   the scope itself is parsed once (`parseStores`), loaded once (`resolveKey`), tested once
  |   (`Auth.authorize`) and rendered once (`describeStores`) — grepped: "ALL_STORES",
  |   "parseStores", "parseStoreScope" (now gone), "key_stores", "spansStores",
  |   "describeStores".
  | retired=none yet. The worktree worktrees/key-stores and branch feat/key-stores are the
  | dispatcher's to retire after ITS OWN verification; this writer does not retire itself.

LANDED | row=39 | sha=1063e29 (the VERIFIED CODE tip: `src/server/app.ts` + `tests/keys.test.ts`;
  | the docs commit carrying THIS line and the ledger row is its child, and `docs/BOARD.md`'s
  | `reconciled:` marker is updated to that child as the last act of the landing) | WHO MAY MINT
  | ON `POST /keys`, writer session (a subagent of dispatcher session
  | dcd6176e-b4b9-4759-b64d-4c90d3495dfa), worktree worktrees/mint-admin, branch feat/mint-admin,
  | base origin/main aae3eb4, REBASED onto origin/main 45c3e8a before push (a mechanical DOCS UNION:
  | the ledger kept the dispatcher's rows 37 AND 38 alongside this slice's row 39, and the board
  | kept the row=37/38 LANDED records, the IN-FLIGHT row=39 block, the row=38 QUEUE line and the
  | two retired_branch lines — nothing of the other landing was touched).
  | verify=THE WRITER'S OWN, in-turn: `bash scripts/gate.sh` → exit 0 (GREEN) · 11 test files ·
  | 80 tests · 2.07s · raw log `.gate-logs/gate.log`; no memory ceiling needed (GUARD g3 still open
  | and still honest). The DISPATCHER's independent gate and its own arm are OWED.
  | arms=checkpoints/mint-admin-differential.sh, the gate lock held across BOTH arms, sha256 printed
  | before and after, restore from HEAD in an EXIT/INT/TERM trap, a control BEFORE and AFTER, raw
  | transcript checkpoints/mint-admin-differential.out (key-shaped strings scrubbed — ledger row 21):
  |   A the admin requirement DELETED (`auth.requireAdmin();` removed), src/server/app.ts
  |     00f477d8…3528 → 11e2e60c…f8ed, RED on `PIN M1: a non-admin key cannot mint ANY key` —
  |     `expected 201 to be 403`; M2 and M5 stayed GREEN
  |   B STRICTER than correct — an admin minter must ALSO be a MASTER, 00f477d8…3528 → 9e0c9588…1808,
  |     RED on `PIN M2: a store-scoped ADMIN key mints within its store` — `expected 403 to be 201`,
  |     and on M2 ALONE (M1/M3/M4/M5 GREEN; the harness fails the run if M1 or M5 reddens, and the
  |     arm keeps the non-admin refusal correct on purpose — its first broader draft is recorded in
  |     docs/TESTING.md)
  |   both controls GREEN (11 files · 80 tests), app.ts back at 00f477d8…3528. The two arms carry
  |     DIFFERENT hashes. No VOID probe.
  | what it is=the owner's stricter rule (the slice-7 brief; ledger row 39): only a key holding
  |   `admin` may mint at all. `Auth.requireAdmin()` is the FIRST thing `POST /keys` decides —
  |   before the body is read — so a non-admin key gets 403 `forbidden` ("only an admin key may mint
  |   keys") and nothing is minted (M1). A store-scoped admin key mints within its store (M2, the
  |   game-backend flow) but not for another (M3); an `admin` grant still needs a MASTER admin key
  |   AND `scope *` (M4); a master admin mints any non-admin permission for any existing store (M5,
  |   the bootstrap path).
  | what it REMOVES=the slice-6 subset check (`lacks` / `Auth.grantablePermissions`) is DELETED as
  |   unreachable — an `admin` minter implies every permission, so it could never fire, and an
  |   untested branch that reads as a security control is a trap. The replacement rule is M1.
  |   docs/SEAM-INDEX.md and the code carry the PREREQUISITE: any future slice that lets a NON-admin
  |   key mint MUST reinstate the subset rule in the SAME commit.
  | wire format=unchanged: `{error:{code,message}}`. NO route was added, removed or renamed, so pins
  |   A1–A3 stay green (11 files · 80 tests, `tests/api-doc.test.ts` 3/3).
  | docs=docs/API.md (the Authentication bullet and the `POST /keys` rows now say WHO may mint) ·
  |   ledger row 39 (appended; it FLAGS that the brief's "rows 37-38" do not exist in this tree) ·
  |   docs/SEAM-INDEX.md (the "Who may MINT" row + the pipeline note + the reinstatement
  |   prerequisite + the row-33 finding narrowed) · docs/TESTING.md (M1–M5, the meaning changes from
  |   K1–K5, and both arms with their hashes) · this board.
  | COPIES: 1 — checked, no duplication (grepped: "requireAdmin", "grantablePermissions", "lacks",
  |   "only an admin key may mint" — the who-may-mint decision exists ONCE, in `app.post("/keys")`
  |   via the ONE `Auth.requireAdmin()`; the unreachable subset predicate it replaced was deleted,
  |   not duplicated, and there is no second authorization middleware).
  | retired=none yet. The worktree worktrees/mint-admin and branch feat/mint-admin are the
  | dispatcher's to retire after ITS OWN verification; this writer does not retire itself.

LANDED | row=36 | sha=e1bd3cf (the VERIFIED CODE tip on the rebased tree: `src/server/app.ts` +
  | `tests/keys.test.ts`; the docs commit carrying THIS line and the ledger row is its child, and
  | `docs/BOARD.md`'s `reconciled:` marker is updated to that child as the last act of the landing)
  | THE PERMISSION BOUNDARY OF `POST /keys`, writer session (a subagent of dispatcher
  | session dcd6176e-b4b9-4759-b64d-4c90d3495dfa), worktree worktrees/keys-subset, branch
  | feat/keys-subset, base origin/main 267fe50, REBASED onto origin/main 256ae32 before push (the
  | ledger union kept the dispatcher's rows 34 AND 35 alongside this slice's row 36, and the
  | board union kept the row=34 LANDED record — nothing of the other landing was touched).
  | verify=THE WRITER'S OWN, in-turn: `bash scripts/gate.sh` → exit 0 (GREEN) · 11 test files ·
  | 80 tests · 2.04s · raw log `.gate-logs/gate.log` · load 0.87 before / 0.88 after; no memory
  | ceiling needed (GUARD g3 still open and still honest). The DISPATCHER's independent gate is OWED.
  | arms=checkpoints/keys-subset-differential.sh, the gate lock held across BOTH arms, sha256 printed
  | before and after, restore from HEAD in an EXIT/INT/TERM trap, a control BEFORE and AFTER, raw
  | transcript checkpoints/keys-subset-differential.out:
  |   A the subset check DELETED (`lacks` pinned to `[]`), src/server/app.ts f4db030f…cb18 →
  |     dc8ab008…5471, RED on `PIN K1: a READ-ONLY key cannot mint a permission it does not hold`
  |     (`expected 201 to be 403`) AND `PIN K2: a key lacking 'delete' cannot mint 'delete'`
  |   B the check STRICTER than correct — for a non-admin minter, EQUALITY instead of subset,
  |     f4db030f…cb18 → 5eebf6fa…95d8, RED on `PIN K3: a key passes on exactly what it holds, and
  |     no more` (`expected 403 to be 201` on the legal bare-`read` subset mint) and on K3 ALONE
  |     (the harness fails the run if any other K-pin reddens; the arm leaves the admin branch
  |     correct on purpose, and its first broader draft is recorded in docs/TESTING.md)
  |   both controls GREEN (11 files · 80 tests), app.ts back at f4db030f…cb18. The two arms carry
  |     DIFFERENT hashes. No VOID probe.
  | what it is=the SECOND half of the `POST /keys` authorization decision, in the SAME branch as the
  |   store boundary: the requested `perms` must be a subset of the minter's own, with `admin`
  |   implying all of them, so a master admin key still mints anything (the bootstrap path, K5). A
  |   refusal is 403 `forbidden`, the message names the permission(s) the minter lacks, and it happens
  |   BEFORE anything is minted — K1/K2 assert the key count is unchanged. ONE predicate, one place:
  |   `Auth.grantablePermissions` + the `lacks` check in `app.post("/keys")`, recorded in the seam index.
  | what it FIXES=the measured defect of ledger row 35: a `{store:"master",perms:["read"]}` key minted
  |   `{perms:["write","delete"]}` → 201 and the child then wrote/deleted. That route now answers 403.
  |   Every existing rule is unchanged and still pinned: cross-store → 403, an `admin` grant needs a
  |   master admin key AND scope `*`, a `spansStores` non-admin key must name an existing store.
  | wire format=unchanged: `{error:{code,message}}`. NO route was added, removed or renamed, so pins
  |   A1–A3 stay green (11 files · 80 tests, `tests/api-doc.test.ts` 3/3).
  | docs=docs/API.md (the Authentication bullet stated the escalation as behaviour — rewritten to the
  |   subset rule, plus the `POST /keys` request-field note) · ledger row 36 (appended) ·
  |   docs/SEAM-INDEX.md (a new "what a key may GRANT" row + the pipeline note + the row-33 finding
  |   marked CLOSED) · docs/TESTING.md (K1–K5 and both arms with their hashes) · this board.
  | COPIES: 1→1 — checked, no duplication (grepped: "grantablePermissions", "perms", "subset",
  |   "admin" implying, "forbidden" — the subset predicate exists ONCE, in `app.post("/keys")`, via the
  |   ONE `Auth.grantablePermissions` getter; it is not duplicated in `src/core/validate.ts` (parsing)
  |   nor in `src/core/keys.ts` (minting), and there is no second authorization middleware).
  | retired=none yet. The worktree worktrees/keys-subset and branch feat/keys-subset are the
  | dispatcher's to retire after ITS OWN verification; this writer does not retire itself.

LANDED | row=33 | sha=8a7a2f5 (the contract tip — `docs/API.md` + `tests/api-doc.test.ts`, rebased
  | from dc93fdc onto origin/main 069f1fd; the differential harness, the ledger/seam/testing
  | amendments and this record are the commits after it) | THE CLIENT CONTRACT, writer session
  | d037deb5-84e8-4aa6-b065-4a672c93ffe2 (subagent of dispatcher session dcd6176e…), worktree
  | worktrees/api-doc, branch feat/api-doc, base origin/main 2991ec6, rebased onto 069f1fd before
  | push (the ledger union kept the dispatcher's row 32 AND this slice's row 33 — a mechanical
  | union, nothing of the other landing touched). verify=THE WRITER'S OWN, in-turn: `bash scripts/gate.sh` → exit 0
  | (GREEN) · 10 test files · 75 tests · 2.11s · raw log `.gate-logs/gate.log` · load 0.05 before
  | the run; no memory ceiling needed (GUARD g3 still open and still honest). The DISPATCHER's
  | independent gate and its own arm are OWED.
  | arms=checkpoints/api-doc-differential.sh, the gate lock held across all of them, sha256
  | printed before and after, restore from HEAD in an EXIT/INT/TERM trap, a control BEFORE and
  | AFTER, raw transcript checkpoints/api-doc-differential.out:
  |   R a NINTH route `GET /ping` in src/server/app.ts, sha256 99367879…22e4 → f20fc393…eae6,
  |     RED on `PIN A1: every route the app registers is in the API doc, and every route in the
  |     doc is registered` — `expected [ 'GET /ping' ] to deeply equal []`
  |   D a fake `GET /ping` row added to docs/API.md's route table, f0d0aa87…edcb → 5342d862…109e,
  |     RED on the same PIN A1 in the doc→code direction
  |   E the doc renames `unauthorized` → `unautorized`, f0d0aa87…edcb → 52bf4ad2…404d, RED on
  |     `PIN A2: every code in ERROR_CODES appears in the doc's error table`
  |   M the doc's stated SERVERSTORE_MAX_BYTES default → `1024`, f0d0aa87…edcb → e1f79bc1…a36f,
  |     RED on `PIN A3: the doc's stated max-bytes default equals the code's` — expected 1024 to
  |     be 67108864
  |   both controls GREEN (10 files · 75 tests), both files back at their before hashes. No VOID probe.
  | what it is=docs/API.md, the FIRST doc a client developer reads and the answer to row 28's
  |   question (which was NO): what the service is; where it lives
  |   (https://store.futuremagic.de, loopback http://127.0.0.1:8477, and `bash
  |   scripts/probe-live.sh <base-url>` → 0/1/2); Authentication (`Authorization: Bearer ssk_…`
  |   and `x-api-key`, Authorization wins; shown once at mint, hashed at rest, never readable
  |   back; 401 = missing/unknown/revoked/expired vs 403 = verified but not permitted; perms
  |   read|write|delete|admin with admin implying the rest; scope is ONE store or `*`, row 30 NOT
  |   promised); all EIGHT routes in one table (method, path, who, request, response, statuses);
  |   the name charset [a-z0-9][a-z0-9._-]{0,63} and PUT-overwrites; the {error:{code,message}}
  |   envelope with EVERY code in ERROR_CODES and what to do about each; SERVERSTORE_MAX_BYTES
  |   (default 67108864 bytes / 64 MiB, 413 never truncated, a failing request writes nothing);
  |   a first-five-minutes curl walkthrough using $BASE/$ADMIN_KEY/$PLAYER_KEY placeholders; and
  |   the non-goals (no GC, no concurrency control/ETag, no CORS, no rate limit, no identity
  |   beyond keys, no bulk/range/streaming, no revoke/whoami route, one store per key).
  | what the doc FOUND (reported, src/ untouched)=`name_taken` (409) is in ERROR_CODES and NO
  |   route emits it (the doc calls it reserved); `POST /keys` bounds minting by STORE, not by
  |   the minter's permissions — a read-only key mints a write+delete key for its OWN store
  |   (measured 201), a cross-store mint is 403, admin is master-admin only; there is NO revoke
  |   route (revokeKey() is called only by tests); requireStore() runs before authorize(), so a
  |   wrong-scope key learns a store's EXISTENCE from a 404; the public name 302s to Cloudflare
  |   Access today (row 31), which the doc states next to the probe command.
  | retired=none. The worktree worktrees/api-doc and branch feat/api-doc are the dispatcher's to
  | retire after ITS OWN verification; this writer does not retire itself.
  | docs=docs/API.md (new) · ledger row 33 (appended) · docs/SEAM-INDEX.md (the client contract
  | as a seam, plus its findings in known debt) · docs/TESTING.md (pins A1-A3 and the four arms
  | with their hashes) · this board.
  | COPIES: 1 — checked, no duplication (grepped: "createApp", "ERROR_CODES",
  |   "DEFAULT_MAX_BYTES", "/stores/", "healthz", "ssk_", "payload_too_large" — the route set is
  |   stated ONCE, in src/server/app.ts, and docs/API.md is a view of it guarded by PIN A1
  |   rather than a second source of truth; the error vocabulary lives once in
  |   src/core/errors.ts and the doc's table is checked against it by PIN A2; the cap lives once
  |   in src/server/config.ts and PIN A3 imports it; the doc restates no code).

LANDED | row=27 | sha=e1e363f (the docs tip; the CODE tip 1439f61 is its parent) | THE DEPLOYMENT
  | SLICE, writer session 726acea8-2fbf-4187-9d0d-a2d9298c6f18 (subagent of dispatcher session
  | dcd6176e…), worktree worktrees/deploy, branch feat/deploy, base fd87cbd (rebased onto
  | origin/main 3a5ae41 before push). verify=THE WRITER'S OWN, in-turn: `bash scripts/gate.sh` →
  | exit 0 (GREEN) · 9 test files · 72 tests · 2.04s · raw log .gate-logs/gate.log · load 1.66
  | before the run; no memory ceiling needed (GUARD g3 still open and still honest). The
  | DISPATCHER's independent gate and its own arm are OWED.
  | arms=checkpoints/deploy-differential.sh, the gate lock held across all of them, hash printed
  | before and after, restore from HEAD in an EXIT/INT/TERM trap, a control BEFORE and AFTER:
  |   D2 src/server/config.ts DEFAULT_HOST 127.0.0.1→0.0.0.0, sha256 cce5fb08…ef02 → ff7d1551…743e,
  |      RED on `PIN D2: the entrypoint listens on 127.0.0.1 and NOT on 0.0.0.0` —
  |      `expected '0.0.0.0' to be '127.0.0.1'`, /proc/net/tcp `[{"ipv4":"0.0.0.0","raw":"00000000","state":"0A"}, …]`
  |   D6 deploy/serverstore.service, the comment naming DEFAULT_HOST deleted, sha256
  |      27e9c0f9…5d86 → efa686be…3d3f, RED on `PIN D6: the unit file does not make the bind host
  |      configurable` — `expected '…' to match /DEFAULT_HOST/`
  |   both controls GREEN (9 files · 72 tests), both files back at their before hashes. No VOID probe.
  |   TWO harness bugs found by running it and both recorded in its comment: `restore` knew only
  |   the first file it mutated, and an "already restored" flag made the second explicit restore
  |   a no-op — a cleanup an error path can skip is not cleanup.
  | what it is=the service's PROCESS contract, pinned where it was previously a review:
  |   tests/entrypoint.test.ts spawns the repo's OWN entrypoint (`node --experimental-strip-types
  |   src/server/main.ts`, exactly what `pnpm run serve` and the unit run) with SERVERSTORE_PORT /
  |   SERVERSTORE_DATA_ROOT and speaks HTTP to it over loopback — D1 healthz 200 from a BOUNDED 5s
  |   poll, D2 the LISTEN sockets from /proc/net/tcp AND /proc/net/tcp6 are exactly one at
  |   127.0.0.1, never 0.0.0.0/[::], D3 unauthenticated GET /stores is 401, D4 SIGTERM stops it on
  |   that signal and leaves no 0A socket; every child is SIGKILLed in afterEach. tests/deploy.test.ts
  |   reads the unit: D5 systemd-analyze verify, D6 no bind-host DIRECTIVE (comments stripped first —
  |   the header NAMES SERVERSTORE_HOST in the sentence forbidding it, and the raw-text version of
  |   this check red on its own warning). deploy/serverstore.service is the systemd USER unit:
  |   absolute paths, WorkingDirectory the `main` checkout (never a worktree),
  |   SERVERSTORE_DATA_ROOT=/home/administrator/serverstore-data OUTSIDE the repo (row 13),
  |   SERVERSTORE_PORT=8477, Restart=on-failure, RestartSec=3, WantedBy=default.target, and NO host.
  |   scripts/probe-live.sh <base-url> is the live check (healthz 200, unauthenticated 401, exit
  |   0/1/2, one line per check) and CANNOT receive/print/log a key. docs/DEPLOYMENT.md is the
  |   ordered runbook: install, verify loopback, the ONE ingress line, `cloudflared tunnel route
  |   dns`, the RESTART WARNING (TRAP t1 — dsh/opencode/openclaw all drop; ask first), the OWNER
  |   minting the master key, the probe command, and the rollback.
  | what was NOT done, deliberately=NOTHING was installed, enabled or started, and no ingress
  |   line was added: that is a HOST change and the tunnel restart needs the owner's go-ahead at
  |   that moment. The unit has never run as a service, so Restart=on-failure, the ingress and the
  |   live hostname round-trip remain UNTESTED by anything automated — probe-live.sh is the command
  |   that will check the last of them.
  | retired=none yet. The worktree worktrees/deploy and its ref are the dispatcher's to retire
  | after ITS OWN verification; this writer does not retire itself.
  | docs=ledger row 27 (appended) · docs/SEAM-INDEX.md (the process seam: the unit + the probe +
  | the spawned-entrypoint test, plus gotchas 9-10) · docs/TESTING.md (pins D1-D6, the two arms
  | with their hashes, and the "no test binds a port" unknown RETIRED) · this board.
  | COPIES: 1 — checked, no duplication (grepped: "experimental-strip-types", "healthz", "/stores",
  | "0.0.0.0", "systemd-analyze", "admin:key" — the server is started from src/server/main.ts only,
  | the process contract lives once in tests/entrypoint.test.ts, the unit contract once in
  | tests/deploy.test.ts, and scripts/probe-live.sh re-implements no part of the server: it is the
  | same two checks D1/D3 pin, against a live URL).
  | .gitignore=NOT amended. The brief offered `/deploy-logs/` or nothing; nothing was chosen because
  | this slice creates no such directory (the probe writes to stdout; the differential's logs are
  | `*.log`, already ignored). Adding a rule for a path that never exists blesses an imaginary file.

(B0 is CLOSED: verified by the dispatcher (row 37 — gate 11 files / 80 tests / 2.06s; arms P and
Q RED on PIN K1 and PIN K4), and its worktree worktrees/keys-subset, branch feat/keys-subset and
session 6e744d65… are RETIRED. Audit after: lock free, 0 suite processes, 0 browser processes.)

(B0.1 is CLOSED: verified by the dispatcher (row 40 — gate 11 files / 80 tests / 2.12s; arms R and
S RED on PIN M1 and PIN M4), and its worktree worktrees/mint-admin, branch feat/mint-admin and
session d4c6cb54… are RETIRED. Audit after: lock free, 0 node/vitest/chrome processes.
ONLY AN ADMIN KEY MAY MINT — the owner's rule (row 38/39), pinned in both directions, and the
unreachable subset branch is deleted with its reinstatement prerequisite in the code and the seam
index.)

(B1 is CLOSED: verified by the dispatcher (row 44 — gate 11 files / 86 tests / 2.02s; arms T and U
RED on PIN G3 and PIN G5), its worktree worktrees/key-stores, branch feat/key-stores and session
c596e5cf… are RETIRED, and the LIVE service was restarted to it at 23:05:03 with the schema
migration inspected on the real database (GUARD g5). A key may now be scoped to a SET of stores.)

IN-FLIGHT | row=46 | writer=session-a5bcf77c-b4db-4a80-a6ae-46cda92ebea0 | model=harness default
  | worktree=/home/administrator/projects/ServerStore/worktrees/key-lifecycle | branch=feat/key-lifecycle
  | base=12f3061 | dispatched_by=session-dcd6176e-b4b9-4759-b64d-4c90d3495dfa
  | state=dispatched 21:08Z, no commit yet | brief=docs/briefs/slice-9-key-lifecycle.md
  | note=STEP B2: `GET /keys` (admin-only; id, label, stores, perms, timestamps; NEVER the hash; a
  |   scoped admin sees only its own stores' keys) and `POST /keys/:id/revoke` (idempotent; a scoped
  |   admin may revoke only what it could have minted, never a master key; self-revocation allowed
  |   and documented). Pins L1-L6; arms in OPPOSITE directions (list leaks the hash -> L1 red; revoke
  |   ignores the scope rules -> L4 red). This is what row 45 had to do by hand.

(The row=39 landing (B0.1: only an admin key may mint) is recorded in the LANDED row=39
block above; its worktree worktrees/mint-admin and branch feat/mint-admin are the
dispatcher's to retire after ITS OWN verification, which is OWED. Audit after this
landing: lock free, 0 suite processes, 0 browser processes.)

(The slice-3 writer is RETIRED: slice 3 LANDED, was verified by the dispatcher, and its worktree
worktrees/tripwire, branch feat/tripwire (fully merged) and session ebb420aa… are gone. The
dispatcher then fixed forward the two pins that could not fail — ledger row 25, LANDED below.
"Nothing outlives the writer": audit after the landing showed lock free, 0 suite processes,
0 browser processes.)

(STALE, the dispatcher's to drop: the row=33 IN-FLIGHT block, superseded by the LANDED row=33
record above — slice 5 landed, was verified, and its worktree worktrees/api-doc / branch
feat/api-doc are the dispatcher's to retire. It is kept here, marked stale, rather than deleted by
a writer.)

(Slice 2 is retired: worktree worktrees/core removed, branch feat/core deleted as fully merged,
writer session b0fbcc08… deleted; the dispatcher's independent verification is a LANDED record.)

NOTE | tsconfig now covers src/** and tests/**; src/ exists. docs/SEAM-INDEX.md and
  docs/TESTING.md exist as of slice 2 — they were deliberately absent until there was a seam
  and a behaviour to record.
NOTE | Toolbox's machinery MOVED (now docs/README.md, WAY-OF-WORKING.md, BOARD, DECISION-LEDGER,
  SEAM-INDEX, TESTING, GATE, BRIEF + a 4-file scaffold). Slice 2 supplied our SEAM-INDEX and
  TESTING doc, so we now hold the full set the current rules name.

QUEUE | row=7 | exposure DECIDED (one subdomain + one master key). Ingress NOT added yet: it needs
  the tunnel restart (TRAP t1) and the owner's go-ahead at that moment.
QUEUE | row=12 | hostname CONFIRMED by the owner 2026-09-27: store.futuremagic.de. Nothing is exposed
  yet; adding the ingress needs the tunnel restart (TRAP t1) and his go-ahead at that moment.
QUEUE-CLOSED | row=16 | RESOLVED 2026-09-27: the owner created a PUBLIC repo instead and the first
  push landed (a20fc95 == origin/main). The private `Store` repo is orphaned; deleting it is
  housekeeping on the owner's side, nothing here points at it.
QUEUE | row=18 | Public visibility, DOWNGRADED by the dispatcher (ledger row 20). The docs do describe
  the live perimeter in plain language, but the only perimeter is a 256-bit key stored hashed and the
  hostname is discoverable via DNS/CT logs anyway, so obscurity does no work here. Public is the
  recommended default; the case for private is tidiness, not security.
QUEUE | row=20 | IF the repo is ever made private, the CREDENTIAL must change first: it is a classic
  PAT with `x-oauth-scopes: public_repo, workflow` and no `repo`, so a private repo would 403. The
  replacement must be written to BOTH ~/.git-credentials AND
  ~/projects/Campaigner/.git/github-credentials (byte-identical today; it wins inside Campaigner).
  BlasterMaster's helper just points at the global file and follows a rotation automatically.
QUEUE | row=21 | SLICE 3 (small, SERIALIZED after the core lands — it touches the gate while a writer runs,
  which is exactly the sequencing rule): a SECRET TRIPWIRE, because a public repo turns "we won't push
  the key" from an intention into something that must be enforced. Scan the TRACKED tree for token
  shapes that never appear in fixtures (`ghp_`, `github_pat_`, `-----BEGIN * PRIVATE KEY-----`, and
  the literal host token value), and assert no data-root path or `*.db` file is tracked; add
  `*.db`/`*.sqlite` to .gitignore. Rejected: scanning for `ssk_`-shaped strings — the writer's own
  fixtures are necessarily key-shaped, so it would either red on the tests or have to exclude the
  very files most likely to hide a real leak.
QUEUE-CLOSED | row=21 | LANDED 2026-09-27 as row 23 (see the LANDED record below): the tripwire is
  tests/helpers/secrets.ts + tests/secrets.test.ts, pins S1–S6, and it is deliberately NOT a step in
  scripts/gate.sh.
QUEUE-CLOSED | row=17 | RESOLVED 2026-09-27: fixed UPSTREAM in Toolbox at 830a224, with a
  BEHAVIOURAL pin (tests/scaffold-board.test.mjs) that Toolbox never had — its existing guards
  only read text, which is exactly why the defect survived there. Observed RED against the old
  script (exit 1) and GREEN with the fix: npm test → 34 tests, 34 pass, 0 fail, exit 0.
  Ledger row 24. Other downstream copies (Expert, FracVibe, Campaigner, …) are unexamined.
QUEUE-CLOSED | row=none | HTTP framework (Hono vs Fastify) — SETTLED by slice 2: Hono, chosen
  against a real route; rejected Fastify (more machinery than a handful of routes needs) and
  Express (no Web-standard Request/Response, so no in-process tests). Ledger row 19.
QUEUE-CLOSED | row=none | FIRST FEATURE SLICE — the multi-store core LANDED as row 19 and was
  independently verified and retired by the dispatcher (ledger row 22).
QUEUE-CLOSED | row=26 | RESOLVED 2026-09-27: a claim is now the explicit key `retired_branch=<name>`,
  landed here (bec97e1) and upstream in Toolbox (a709f78), each pinned in BOTH directions. The
  vocabulary table carries the rule and this board lists its own claims explicitly.
QUEUE-CLOSED | row=27 | DONE 2026-09-27: the deployment slice LANDED, was independently verified by
  the dispatcher (row 29), and is INSTALLED — runbook steps 0-5: the unit is enabled and active on
  127.0.0.1:8477 only, the LOCAL probe is PASS exit 0, one ingress line validates as rule #5 →
  http://127.0.0.1:8477, DNS answers, and the tunnel restarted with every existing hostname back.
  What remains is not installation: see the row=31 line below.
QUEUE-CLOSED | row=31 | RESOLVED 2026-09-27: the owner added the Access bypass for
  store.futuremagic.de and the dispatcher verified it — `probe-live.sh` PASS exit 0, no `location`
  and no `www-authenticate` in the raw headers, and the NEIGHBOURS UNCHANGED (dsh/opencode/openclaw
  still 302, apps 200), i.e. ONE hostname, not the zone. The key is now the only perimeter (row 43).
  MINTING IS SAFE NOW: the service was restarted to main@0cfba87 at 22:56:34 (GUARD g5).
  sits in front of store.futuremagic.de (a hostname minutes old already 302s to
  spring-thunder-dad0.cloudflareaccess.com), so NO key-bearing client can reach the API — Access
  gates curl exactly as it gates a browser. Fix: a MORE SPECIFIC Access application for
  store.futuremagic.de with a Bypass policy for Everyone, or narrow the wildcard so it no longer
  covers this name. THEN, in his own shell: `pnpm run admin:key` (the master key is his; the
  dispatcher must never hold it) and his key-bearing round-trip. The dispatcher then re-runs
  `scripts/probe-live.sh https://store.futuremagic.de` and records the result.
  | RATIFIED 2026-09-27: the owner RE-CHOSE keys-only with the wildcard KNOWN, rejecting
  |   Access-as-identity-provider (which would have given browsers a real login and let the store
  |   trust the tunnel's Access JWT, at the price of an Access seat per player) — ledger row 32.
QUEUE | row=41 | NEXT = STEP B1 (dispatched): a key is scoped to a SET of stores, as a `key_stores`
  table with an FK per store (ledger row 41 — the dispatcher's mechanism decision, veto-able), plus
  `GET /whoami`. `POST /keys` moves from `store: string` to `stores: string[]` (`["*"]` = master)
  while NO client exists, which is why the breaking change is free today. Then B2 = the REVOKE route
  and key listing (what the step-C UI needs), then C = the UI itself.
QUEUE-CLOSED | row=45 | RESOLVED 2026-09-27: the two unused master admin keys are revoked via
  `revokeKey()` (read back from the live database: two revoked, the owner's untouched), so the store
  holds exactly ONE live admin credential. No restart needed and that was checked in the code —
  resolution reads `revoked_at` per request. B2 makes this self-service.
QUEUE | row=48 | STEP C1 (the admin UI) is QUEUED BEHIND B2 and its brief is already on disk at
  docs/briefs/slice-10-admin-ui.md. Forks settled by the owner (row 48): SAME ORIGIN, served by the
  store service at store.futuremagic.de, as NO-BUILD static assets (three fixed routes: / , /app.js ,
  /app.css). Security defaults pinned: the key lives in memory only (no localStorage/sessionStorage/
  cookie/URL/history), the served bytes carry no secret, and every path the UI calls must be a route
  the API registers. Honest price: no-build JS is not typechecked and no automated check exercises it
  in a browser — a headless test is owed and is NOT v1.
QUEUE | row=44 | NEXT = B2: key LISTING and the REVOKE route — the two things step C's UI needs and
  the two the live store needs NOW, because the live database holds THREE master admin keys (two
  unused, created before the service existed) and revocation is currently operator-only. Then C
  (the admin UI) and rate limiting (row 43's note: the only queued item that protects a public
  endpoint rather than extending it).
QUEUE | row=40 | B0.1 LANDED (row 39, verified row 40): ONLY AN ADMIN KEY MAY MINT, and the subset
  check is deleted as unreachable, with its reinstatement prerequisite written into the code comment
  and docs/SEAM-INDEX.md. NEXT = step B (multi-store scope per key + `whoami` + the missing REVOKE
  ROUTE), then step C (the admin UI). One finding for C: a store-scoped admin key CANNOT be minted
  over HTTP — `pnpm run admin:key --store <s> --perms read,write,delete,admin` is the one-command
  bootstrap per game, and the UI needs no change unless we later widen the admin-grant rule so a
  master admin may grant `admin` scoped to an existing store (a deliberate new kind of admin, with
  its own pins: it must not mint `admin` for another store, and must not grant `*`).
QUEUE | row=38 | B0 as LANDED implements the SUBSET rule; the owner chose ADMIN-ONLY minting, so
  B0.1 (row 39) implements HIS rule and must decide the fate of the now-unreachable subset branch.
  The dispatcher's sequencing error is recorded in row 38: the fork was asked in the same breath as
  the dispatch, so the answer bought a second slice. Ask mechanism forks BEFORE dispatching.
QUEUE | row=35 | B0 DISPATCHED (the key-subset fix, row 36). Row-34 findings NOT in B0, not to be
  lost: (a) there is NO REVOKE ROUTE — `revokeKey()` is called only by tests, so row 6's rotation
  story is half-built and the row-30 UI's revoke button has nothing to call; (b) `name_taken` (409)
  is emitted by NOTHING — remove it or use it, but a code a client can never receive is a lie in the
  vocabulary; (c) `requireStore()` runs before `authorize()`, so a wrong-scope key learns whether a
  store EXISTS from the 404-vs-403 difference; (d) no `whoami`/last-used route. (a) and (d) belong to
  step B (multi-store scope + whoami + defaults); (b) and (c) are small calls to take with it.
QUEUE | row=28 | API DOC: `docs/API.md` — the CLIENT contract (base URL, the auth header, the eight
  routes that actually exist, the `{error:{code,message}}` envelope with its codes, and the caps),
  PINNED to the code by a test that derives the route list from the app. Next landing after the
  deployment, because the doc should name the deployed base URL. NO such doc exists today: every
  existing doc is internal-facing.
QUEUE | row=28 | MULTIPLAYER GAPS, in dependency order: (1) per-object version + `ETag`/`If-Match`
  (412) and a `since=` filter on the list route — without it two players writing one object
  silently lose state; (2) CORS, without which a browser game on another origin cannot call the
  API at all; (3) rate limiting, which a public multiplayer endpoint needs; (4) per-player keys
  minted by the game's own backend (possible TODAY via `POST /keys` — the row-8 `user` substrate
  only if the owner wants identity inside the store). BLOCKED ON THE OWNER: the sync model (async
  vs realtime) and the client shape (browser vs native), which together decide whether a push
  channel is needed at all.
QUEUE | row=30 | REGISTRATION MODEL (the owner's): one key per PERSON, each scoped to a SET of
  stores, with defaults (recommended read+write on the selected stores; `delete` and `admin` opt-in
  and never defaulted), plus a `GET /whoami` so an app can tell which key is calling. THE GAP:
  `access_keys.store` holds ONE name (or `*`), so multi-store scope is a schema + authorization
  change — that is step B below.
QUEUE | row=30 | PROPOSED ORDER: (A) `docs/API.md` pinned to the code; (B) multi-store scope +
  `whoami` + permission defaults; (C) the ADMIN UI — list stores, mint a key with store checkboxes
  and defaults, show it ONCE, list keys with last-used, revoke; (D) concurrency (per-object version
  + `ETag`/`If-Match` + `since=`); (E) CORS + rate limiting. A/B/C serve the owner's registration
  workflow; D/E gate the game on a public browser. The owner may reorder.

TRAP | t1 | Adding a hostname to /etc/cloudflared/config.yml REQUIRES RESTARTING the tunnel — a few
  | seconds in which dsh.futuremagic.de (the owner's own GUI), opencode.futuremagic.de and
  | openclaw.futuremagic.de all drop. Passwordless sudo works, so this line is the only guard.
TRAP | t2 | Two FOREIGN processes were mid-run at reconcile in BlasterMaster/worktrees/dup-tripwire
  | (`npm run gate`, `npm run build`). The gate lock is PER-REPO, so it does not exclude a peer
  | project's suite; check pgrep / board.sh before a big run.
TRAP | t4 | A DIFFERENTIAL HARNESS's restore is itself code that can be wrong, and it was TWICE in
  | the row-27 harness: `restore` knew only the FIRST file it mutated (the unit stayed mutated after
  | arm D6), and a `RESTORED=0/1` "already restored" guard then made the SECOND explicit `restore`
  | return early (the unit survived a second run). Both left the tree dirty with no error. Rule:
  | a restore restores EVERY mutated path, is NEVER guarded by a "already done" flag (`git checkout
  | HEAD --` is idempotent), and the harness must assert each hash is back before it claims success
  | — the hash check is what caught it, not the trap.

GUARD | g1 | Never bind to 0.0.0.0. Loopback + tunnel is how every service on this box is exposed
  | (precedent: apps-web.service).
GUARD | g2 | A long check never runs in the foreground in the dispatcher session; a WRITER runs its
  | own gate IN-TURN, because a subagent's background jobs die with its turn.
GUARD | g3 | Memory ceiling: NOT YET IMPLEMENTED — the suite is trivial, so there is nothing to
  | bound. Debt, not a claim. It lands with the first suite that is not.
GUARD | g5 | THE RUNNING SERVICE IS NOT THE REPO. `ExecStart` loads `src/server/main.ts` once, at
  |   boot, so a landing reaches the live service only after `systemctl --user restart serverstore`.
  |   It matters most for a SCHEMA change (the migration runs when a process OPENS the database — the
  |   service at boot, or `pnpm run admin:key` in the owner's shell): minting between the landing and
  |   the restart migrates the live database while the old code is still in memory. RULE: after any
  |   landing that touches `src/` or the schema, the DISPATCHER restarts the unit, re-runs
  |   `scripts/probe-live.sh https://store.futuremagic.de`, and only THEN tells the owner he may mint.
  |   Measured 2026-09-27: the service went live at 22:20:41 and was THREE LANDINGS BEHIND main until
  |   the restart at 22:56:34 — the rule in docs/DEPLOYMENT.md §8 exists because of that.

# Retirement CLAIMS. The ONLY form the reconciler parses is `retired_branch=<name>`, one per
# branch, read literally — see the vocabulary above. Prose retirement notes elsewhere in this
# board (the `retired=` fields in the LANDED records) are HISTORY and claim nothing.
retired_branch=feat/core
retired_branch=feat/tripwire
retired_branch=feat/api-doc
retired_branch=feat/keys-subset
retired_branch=feat/mint-admin
retired_branch=feat/key-stores

RECOVERY | repo=/home/administrator/projects/ServerStore | branch=main
  | remote=https://github.com/ArndRosemeier/ServerStore.git (PUBLIC; origin/main carries slices 1-3
  |   plus the row-27 deployment landing once the dispatcher pushes; each LANDED row below names
  |   its own sha)
  | gate=bash scripts/gate.sh  (0 green · 1 red · 2 cheap only · 9 refused/VOID)
  | logs=.gate-logs/gate.log | board=bash scripts/board.sh | rules=AGENTS.md
  | decisions=docs/DECISION-LEDGER.md rows 1-45 (19, 23, 27, 33, 36, 39 and 42 appended by writers,
  |   out of numeric order by design; 43 = store LIVE + bypass verified, 43b = the
  |   running-service-is-not-the-repo discovery (GUARD g5), 44 = B1 verified with the live migration
  |   inspected, 45 = the two stray master keys revoked)
  | deploy=docs/DEPLOYMENT.md (install · loopback verify · the ONE ingress line · TRAP t1 restart
  |   warning · the owner's master key · the probe · rollback); unit=deploy/serverstore.service;
  |   probe=scripts/probe-live.sh
  | live=https://store.futuremagic.de — PUBLIC and reachable (Access BYPASSED for this hostname
  |   only; the key is the only perimeter). Running main@0cfba87 since 2026-09-27 22:56:34 CEST;
  |   data root /home/administrator/serverstore-data; logs `journalctl --user -u serverstore -f`;
  |   ingress rule #5 in /etc/cloudflared/config.yml; restart + re-probe rule = GUARD g5 /
  |   docs/DEPLOYMENT.md §8
```

## Landed

```
LANDED | row=45 | sha=93de802 (the record commit) | verify=MY OWN, on the LIVE database: the two
  | unused master keys read back as revoked (`revoked_at` set) and the owner's key as untouched;
  | no restart needed, checked in the code (resolution reads `revoked_at` per request; `keys.ts`
  | holds no lookup cache); keyless live probe PASS exit 0.
  | retired=nothing | docs=ledger row 45 · this board.

LANDED | row=44 | sha=5ae13b4 (the B1 tip; pulled, migrated and restarted BEFORE my own gate — see
  | the note in ledger row 44 on why that order was the smaller risk)
  | verify=THE DISPATCHER'S OWN, on the INTEGRATED tree: gate exit 0 GREEN · 11 files · 86 tests ·
  | 2.02s. My arms, neither of them the writer's: T removed the MIXED-LIST rejection in
  | `parseStores` → RED on PIN G3 (201 vs 400); U neutered the master case (`spansStores` → false)
  | → RED on PIN G5 (403 vs 201). Both restored byte-identical.
  | LIVE=restarted to B1 at 23:05:03; schema migration inspected on the REAL database: `scope_all`
  | present, `store` DROPPED, `key_stores` created, clean boot journal. THREE master admin keys
  | exist (two unused, pre-service) and the owner's key works — his round-trip's `last_used_at`.
  | retired=worktree worktrees/key-stores · branch feat/key-stores · session c596e5cf…
  | docs=ledger row 44 · this board.

LANDED | row=40 | sha=9fc93b4 (the B0.1 record tip, pulled BEFORE gating)
  | verify=THE DISPATCHER'S OWN, on the INTEGRATED tree: gate exit 0 GREEN · 11 files · 80 tests ·
  | 2.12s. My arms, neither of them the writer's: R the shared PREDICATE neutered
  | (`requireAdmin()` -> no-op) → RED on PIN M1 (201 vs 403); S the ADMIN-GRANT SCOPE rule removed
  | → RED on PIN M4. Both restored byte-identical. The §2 decision is ratified: the subset check and
  | `grantablePermissions` are deleted as unreachable, prerequisite written in the code and the seam
  | index. Finding for step C (checked, not assumed): a store-scoped admin key cannot be minted over
  | HTTP, but `pnpm run admin:key --store <s> --perms read,write,delete,admin` can — one command per
  | game; the UI needs no change unless the admin-grant rule is deliberately widened.
  | retired=worktree worktrees/mint-admin · branch feat/mint-admin · session d4c6cb54…
  | docs=ledger rows 39-40 · this board.

LANDED | row=37 | sha=aae3eb4 (the B0 record tip, pulled BEFORE gating this time)
  | verify=THE DISPATCHER'S OWN, on the INTEGRATED tree: gate exit 0 GREEN · 11 files · 80 tests ·
  | 2.06s. My arms, neither of them the writer's: P the shared PREDICATE neutered
  | (`grantablePermissions` -> PERMISSIONS for everyone) → RED on PIN K1 (201 vs 403), the slice-2
  | lesson applied on purpose; Q the STORE boundary relaxed → RED on PIN K4. Both files restored
  | byte-identical. The writer's report records NO same-class hole elsewhere, and that
  | `grantablePermissions` needs a per-store extension when multi-store scope lands.
  | retired=worktree worktrees/keys-subset · branch feat/keys-subset · session 6e744d65…
  | note=B0 closed the escalation by SUBSET semantics; the owner then chose ADMIN-ONLY, so B0.1
  | (row 39) implements his rule and decides the unreachable subset branch. Ledger rows 37-38.
  | docs=ledger rows 37-38 · this board.

LANDED | row=34 | sha=267fe50 (the record tip pulled before verifying; the contract tip is 8a7a2f5)
  | verify=THE DISPATCHER'S OWN, on the INTEGRATED tree: gate exit 0 GREEN · 10 files · 75 tests ·
  | 2.03s. My arms, neither of them the writer's: N the app registers `/health` instead of
  | `/healthz` → RED on PIN A1 (code→doc direction); O the doc loses its `payload_too_large` row →
  | RED on PIN A2. MY OWN ERROR, recorded: the first gate ran BEFORE `git pull` and reported 9 files
  | / 72 tests — a STALE TREE, so VOID as verification of this landing; refetched and re-ran.
  | retired=worktree worktrees/api-doc · branch feat/api-doc · session d037deb5…
  | findings=row 34 (name_taken emitted by nothing; no revoke route; requireStore before authorize;
  | no whoami route) and row 35 (the escalation) | docs=ledger rows 34-35 · this board.

LANDED | row=29 | sha=aabf8a1 (the record commit; the code+docs tip verified is e1e363f)
  | verify=THE DISPATCHER'S OWN: gate exit 0 GREEN · 9 files · 72 tests · 2.01s, on the integrated
  | tree that also carries the row-28 record. Arms, NEITHER of them the writer's: X
  | `src/server/main.ts` WIRES the host to 0.0.0.0 while the constant stays correct → RED on PIN D2
  | (so the pin sees the WIRING, not just the constant); Y the unit's WorkingDirectory → a WORKTREE
  | → RED on the deploy unit-shape pin, so that contract IS covered and my suspicion of a gap was
  | WRONG. Both files restored byte-identical (hashes asserted).
  | retired=worktree worktrees/deploy · branch feat/deploy (fully merged, was 47deda1) · session
  | 726acea8… | still owed=the unit install · the ONE ingress line + the tunnel restart (the
  | owner's go-ahead at that moment — TRAP t1) · the master key (the owner's to mint; never the
  | dispatcher's). | docs=ledger row 29 · this board.

LANDED | row=26 | sha=bec97e1 | verify=MY OWN: gate exit 0 GREEN · 7 files · 65 tests · 2.01s
  | (`tests/gate.test.ts` went 5 → 7), and the new pins are falsifiable in BOTH directions on a
  | fixture repo with a resolvable origin/main and a LIVE branch feat/owed: prose about a
  | retirement OWED → BOARD RECONCILED (exit 0); `retired_branch=feat/owed` with the branch
  | alive → BOARD STALE (exit 1, "claimed retired but still exists").
  | upstream=Toolbox `a709f78`, rebased onto a tip that had MOVED under this work (another
  | session landed socket-peers + the host-hygiene rule): its integrated `npm test` → 43 tests,
  | 43 pass, 0 fail, exit 0; and the same suite against the previous board.sh → 41 pass, 2 fail
  | on exactly the two new pins.
  | retired=nothing — no writer; a dispatcher landing. | docs=ledger row 26 · this board
  | (vocabulary row + the explicit claims block).

LANDED | row=25 | sha=8bc9b02 | verify=MY OWN: gate on the FIXED tree exit 0 GREEN · 7 files ·
  | 63 tests · 1.99s; and the SAME arms that exposed the gap now CLOSE it — arm J (the
  | host-credential comparison broken) went from GREEN to RED with 4 pin lines, arm K (the PEM
  | regex broken) from GREEN to RED with 3, arm I still RED on PIN S4.
  | what landed=the positive controls PIN S2 and PIN S3 never had, plus a "cannot-check"
  | direction pin. Found by arms run against the as-landed slice (ledger row 25): breaking the
  | credential comparison left the whole suite GREEN, and S3 guards the only real secret here.
  | retired=nothing — no writer; a dispatcher fix to verification machinery.
  | docs=ledger row 25 · this board.

LANDED | row=23 | sha=550e020 (the CODE tip on the rebased tree; the evidence commit carrying this
  | line rides with the same push)
  | THE SECRET TRIPWIRE, writer session ebb420aa-fa06-400d-a250-84a28af0f55c (subagent of dispatcher
  | session-dcd6176e-b4b9-4759-b64d-4c90d3495dfa), worktree worktrees/tripwire, branch feat/tripwire,
  | base 023e098 (rebased onto origin/main before push).
  | verify=THE WRITER'S OWN, in-turn: `bash scripts/gate.sh` → exit 0 (GREEN) · 7 test files · 60 tests ·
  | ~2.0s · raw log .gate-logs/gate.log · peak 1m load 0.92 (0.65 before); no memory ceiling needed
  | (GUARD g3 still open and still honest).
  | arm=an obviously fake `ghp_`+36×`A` appended to the tracked AGENTS.md → sha256
  | 2af90514d3fc…409e → d0034621e1d6…7f0e, the ONE gate exit 1 RED on
  | `PIN S1: the tracked tree carries no GitHub token shape` (`AGENTS.md: GitHub token shape at byte
  | offset 7671`), restored from HEAD in an EXIT/INT/TERM trap (hash back to 2af90514d3fc…409e),
  | control gate on the restored tree GREEN · 7 files · 60 tests. No VOID probe.
  | Harness: checkpoints/tripwire-differential.sh, raw output checkpoints/tripwire-differential.out.
  | what it is=ONE pure, dependency-free scanner tests/helpers/secrets.ts `scanTrackedTree()`, called by
  | ONE test file tests/secrets.test.ts, pins S1–S6; deliberately NOT a step in scripts/gate.sh (the
  | gate is the ONE way the suite runs). Tracked = what a push would PUBLISH (git ls-files -z). Scans
  | GitHub token shapes, PEM private-key armor, the literal ~/.git-credentials value (compared in
  | memory, never printed/echoed/logged), tracked .db/.sqlite/.sqlite3; *.db/*.sqlite/*.sqlite3 added
  | to .gitignore. An absent credential file makes PIN S3 FAIL with "cannot check" — never a silent
  | pass (AGENTS.md rule 1). No bare `ssk_` rule: our own fixtures are necessarily key-shaped.
  | docs=ledger row 23 (appended) · docs/SEAM-INDEX.md (one row) · docs/TESTING.md (pins S1–S6 + the
  | arm) · this board | COPIES: 1 — checked, no duplication (grepped: "ghp_", "github_pat_",
  | "PRIVATE KEY", "git ls-files", ".gitignore" — the scan lives once in tests/helpers/secrets.ts and
  | has exactly one caller, tests/secrets.test.ts; scripts/gate.sh was deliberately NOT given a
  | second check path).
  | retired=none yet. The worktree worktrees/tripwire and its ref are the dispatcher's to retire
  | after ITS OWN verification; this writer does not retire itself. (Discovery: `scripts/board.sh`'s
  | `retired=` parser treats "NOT yet … <ref>" as a retirement CLAIM and reports a false STALE when
  | the word "branch" precedes the ref; recorded here, not silently reworded.)

LANDED | row=24 | external=830a224 — TOOLBOX, a DIFFERENT repo (~/projects/Toolbox, its main branch)
  | NOTE the key is `external`, NOT the LANDED sha key: the reconciler requires every LANDED sha
  | to be an ancestor of OUR origin/main, and a foreign commit correctly trips it. It did exactly
  | that when this record was first written with a sha key — a TRUE POSITIVE against the
  | dispatcher's own record, and the cleanest evidence yet that the row-15 fix works: it named the
  | guilty sha instead of blaming the whole board, and it did not pass silently.
  | verify=MY OWN, in Toolbox: the new pin was RED against the pre-fix script (exit 1, on the
  | assertion that the reconciler must not say BOARD STALE) and GREEN with the fix —
  | npm test → 34 tests, 34 pass, 0 fail, exit 0; `git rev-parse HEAD origin/main` → both 830a224;
  | Toolbox's own portability guard (tests/shared-layer.test.mjs) is among those 34.
  | change=scaffold/scripts/board.sh now resolves with `git rev-parse --verify --quiet
  | <rev>^{commit}` plus a 40-hex shape check, so an unresolvable remote yields CANNOT LOOK instead
  | of blaming the record; NEW tests/scaffold-board.test.mjs pins it behaviourally.
  | retired=nothing — the dispatcher did this one itself, in Toolbox's tree on its main branch: no
  | writer and no worktree, because Toolbox has no worktree recipe and its board/ledger are
  | TEMPLATES that a briefed writer could have poisoned with project-specific records.
  | docs=ledger row 24 · this board (Toolbox's own commit carries the reasoning).

LANDED | row=19 | sha=9ddf8f8 (the verified CODE tip; this docs commit is its own sha) | THE MULTI-STORE CORE, writer session
  | session-b0fbcc08-9760-4545-bad0-1e5acd46d524, worktree worktrees/core, branch feat/core, base
  | b60c716 (rebased onto 659e503 before push).
  | verify=THE WRITER'S OWN, in-turn: `bash scripts/gate.sh` → exit 0 (GREEN) · 6 test files ·
  | 52 tests · ~2.0s · raw log .gate-logs/gate.log · peak load < 1, ~2s wall, no memory ceiling
  | needed (GUARD g3 still open and still honest).
  | arms=4 differential arms, lock held across all of them, hash printed before and after, restore
  | in an EXIT/INT/TERM trap: A registry.ts 6e6c490d…→fa46f254… RED on PIN 6; B keys.ts
  | 931f1c87…→dab67ee6… RED on PIN 5; C keys.ts 931f1c87…→ce1e32cb… RED on PIN 3; D app.ts
  | 99367879…→55bf1568… RED on the strip-only-Node runtime pin. Control after restore: GREEN.
  | No VOID probe. Full transcript: checkpoints/differential.out.
  | evidence beyond the suite=the surface was probed against a REAL bound server: /healthz 200,
  | `pnpm run admin:key` minted a key the live API accepted as admin, PUT/GET over loopback,
  | `ss -ltn` showed 127.0.0.1:8477 ONLY, port free after kill. That probe found a defect the
  | 49-test suite could not: a TS parameter property in `Auth` crashed `pnpm run serve` under
  | node --experimental-strip-types while vitest transpiled it happily. Fixed, and pinned by
  | tests/runtime.test.ts.
  | retired=NOT yet — worktree worktrees/core and branch feat/core are the dispatcher's to retire
  | after ITS OWN verification. This writer does not retire itself.
  | docs=ledger row 19 (appended) · docs/SEAM-INDEX.md (created) · docs/TESTING.md (created) ·
  | this board | COPIES: 1 — checked, no duplication (grepped: key format and parsing — one site
  | in src/core/keys.ts; name/scope/permission validation — one site in src/core/validate.ts;
  | error code→status — one site in src/core/errors.ts; blob paths — one site in
  | src/storage/fs.ts; the data root is joined to a path in exactly one module).
  | note=the failed test-helper parse `raw.split("_")[1]` is recorded in the seam index gotchas:
  | base64url ids can start with `_`, so the correct helper is keyIdFromRaw().

LANDED | row=19 | sha=c0731fe (the gated tree tip; the dispatcher's doc fixes ride in the reconcile
  | commit that carries this line) | verify=THE DISPATCHER'S OWN, independent of the writer:
  | full gate exit 0 GREEN · 6 test files · 52 tests · 1.90s · raw .gate-logs/gate.log.
  | My own arms, NONE of them the writer's four:
  |   E  cross-store scope check removed          -> RED on PIN 2 (expected 200 to be 403)
  |   F  the app.use("*") traversal layer removed -> GREEN }
  |   G  rawPathname returns the collapsed path   -> GREEN } three REDUNDANT layers refuse a
  |   H  traversalRefusal itself -> null          -> RED on PIN 8 (expected 404 to be 400) }
  | Three layers, so a one-line mutation of ONE of them proves NOTHING: F and G are redundancy,
  | not missing pins, and only H settles it. Measured mechanism: the layer that fires is
  | `wrapped.request` on the RAW STRING (400 "path may not contain a '.' or '..' segment"); the
  | other three pin attempts answer 401 first and are refused later by parseName — which is why
  | the pin's shared `invalid_name` code cannot attribute them. PIN 8 IS falsifiable (arm H), so
  | the raw-target claim is sound. Rule recorded in ledger row 22: mutate the SHARED PREDICATE.
  | docs=spot-checked; three prose defects found and fixed (the 49-vs-52 test count DELETED rather
  | than updated, the "3 arms" heading corrected, the harness header corrected).
  | retired=worktree worktrees/core · branch feat/core (fully merged, safe delete) · writer session
  | b0fbcc08-9760-4545-bad0-1e5acd46d524 (deleted).

LANDED | row=14 | sha=2e44eaf | verify=MY OWN: cheap tier exit 2 (which is NOT a pass) + full gate
  | GREEN exit 0 · 1 test file · 4 tests · 205ms · raw log .gate-logs/gate.log
  | retired=nothing (no writer was used)
  | docs=ledger rows 1,14,15 · this board | note=the code tree that was gated is byte-identical
  | to the committed tree; the only later delta is documentation, which no test asserts on.

LANDED | row=15 | sha=2e44eaf | verify=MY OWN: `git rev-parse no-such-remote/main`
  | prints the ref back and exits 128 (captured in the session); scripts/board.sh now prints
  | CANNOT LOOK and exits 1 for BOTH the default case (no origin exists) and the forced-missing
  | case, where it previously blamed the record | arms=the cannot-look PIN was RED before the fix
  | and GREEN after | retired=nothing | docs=ledger row 15
  | note=DIVERGENCE: our board.sh is no longer byte-identical to the Toolbox scaffold.
```

## Guards

- **`GUARD` — the suite lock.** `scripts/gate.sh` takes an atomic `mkdir` lock; a
  second run is refused (exit 9) and is VOID. Pinned by
  `tests/gate.test.ts`.
- **`GUARD` — the memory ceiling.** See `g3` — not implemented yet, and said so.

## Recovery pointers

- Repo / remote / branch: `/home/administrator/projects/ServerStore` · (none yet) · `main`
- The gate command and its exit codes (`0` green · `1` failed · `2` cheap only ·
  `9` refused, VOID): `bash scripts/gate.sh`
- Where the raw logs live: `.gate-logs/gate.log` (gitignored)
- Open writer branches/worktrees: `git worktree list` · `git branch -a`

## Traps (each with the rule that prevents it)

- `TRAP t1` — the tunnel restart drops the owner's own GUI for a few seconds. Rule:
  never add a hostname silently; ask at the moment.
- `TRAP t2` — the lock is per-repo. Rule: check `pgrep`/`board.sh` before an
  expensive run, because a peer project's suite is not excluded by our lock.
