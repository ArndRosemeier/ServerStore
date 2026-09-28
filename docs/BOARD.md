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
reconciled: 0410a87 · 2026-09-28T13:45Z — the slice-19 (test-only) VERIFIED CODE tip; the docs child
  naming it is `0f361b4`. The docs commit carrying THIS marker is its child, so the marker is the code
  tip and not itself — a commit cannot name its own sha. `bash scripts/board.sh` must report this marker
  as an ancestor of origin/main. verify=THE DISPATCHER'S OWN, on the INTEGRATED tree: gate exit 0 GREEN
  · 18 files · 179 tests · 4.25s with the browser file at 3785ms (cost FLAT — the pin rides existing
  flows); plus TWO own arms, neither of them the writer's (he armed G the guard acting on the FIRST
  click → V1 and V3 through the EFFECT half): X the confirmation affordance VANISHES the moment it is
  created → V1 with V3/V5 as the same-seam family, proving the ANTI-VACUITY half ("nothing happened AND
  nothing was offered" must not pass); Y ONLY the entry delete bypasses the guard while the key delete
  keeps it → **V3 ALONE**, which is the coverage claim: the shared helper really is applied to BOTH
  single-item controls, so a pin covering only keys would have passed. Controls GREEN before and after;
  `web/app.js` restored byte-identical. `GUARD g5` does NOT apply (tests/checkpoints/docs only — verified
  by `git diff --name-only`), and `probe-live.sh` → PASS exit 0. (History: this line read "5bf080a"
  (slice 18), "620a71b" (slice 17), "f066f65" (slice 16), "c13219a" (slice 15), "66a3295" (slice 14),
  "695ba2e" (slice 13), "bd55b7e" (CORS), "1063e29" (row 39), "e1bd3cf" (row 36), "e1e363f" (row 27)
  and "bec97e1" (row 26, LOCAL time mislabelled as Z, the dispatcher's error, corrected rather than
  quietly).)

SESSION | id=session-dcd6176e-b4b9-4759-b64d-4c90d3495dfa | role=dispatcher (chief of staff)
  | state=NO writer in flight, and **NOTHING IS QUEUED** — the owner has no open request for the first
  |   time since the store went live. Slices 12–19 are LANDED, VERIFIED and RETIRED. Everything he asked
  |   for is live: the console's four destructive actions (delete a key including a revoked one, look
  |   inside a store with a server-side prefix filter and delete an entry, empty a store, delete a store
  |   — the last two needing the store name TYPED), on the migrated SQLite core (one database, WAL, keys
  |   and item bytes together). The console is served from disk per request, so a reload shows it.
  |   LIVE at https://store.futuremagic.de/; probe PASS.
  |   THE OWNER'S ONE OUTSTANDING ACTION: make a real key-bearing call (the dispatcher holds no key) —
  |   that also retires the pre-migration copy at
  |   `/home/administrator/serverstore-data.backup-pre-migration`.
  | goal=goal-1f2f2e27-ed8d-470d-8499-c1eeed63b3b6 (paused; untouched since creation)
  | host=12 cores · 23Gi RAM · / has 506GB free · process audit after this landing: lock
  |   free, 0 suite processes, 0 entrypoint processes, 0 browser processes.
  | remote=https://github.com/ArndRosemeier/ServerStore.git — PUBLIC, owner-created 2026-09-27.
  |   origin/main carries slices 1-3; the LANDED records below name their shas.

(The row=84 `IN-FLIGHT` block is FOLDED by the LANDED row=84 record in `## Landed` — the
writer's own record, added in the docs child of landing `0410a87`. Its scope statement is
unchanged and now has a landing: the intermediate-state assertion for BOTH single-item
controls that share `armGuard` (key Delete, entry Delete), ONE shared helper
`assertArmedNotActed`, the request-count backstop, and the ONE arm (G) that reddens PIN V1
and PIN V3 — with NO product change.)

(The row=82 `IN-FLIGHT` block is FOLDED by the LANDED row=82 record in `## Landed` — the
writer's own record, added in the docs child of landing `5bf080a`. Its scope statement is
unchanged and now has a landing: the console's four destructive actions, pins V1–V7 on the
existing browser seam, the U3 shape-normalisation judgement call, and NO `src/`, schema,
storage or API change.)

IN-FLIGHT | row=79 | session=(dispatching now) | worktree=worktrees/sqlite-core |
  | branch=feat/sqlite-core | base=origin/main — resolved by the writer and recorded in its landing
  | state=THE ONE WRITER. Scope: THE SQLITE CORE (owner's instruction; design = ledger row 78, the
  |   authority; brief `docs/briefs/slice-17-sqlite-core.md`). Item bytes move INTO the database (a
  |   content column on `objects`, added by an idempotent migration), the per-item blob files and the
  |   shared-blob check go away, and the boot migration imports the existing 175 entries by
  |   RE-VERIFYING each hash before the blob tree is deleted (loud on any mismatch — never a silent
  |   drop). Concurrency becomes explicit and PINNED: `journal_mode = WAL`, a named `busy_timeout`,
  |   `synchronous = FULL`, `BEGIN IMMEDIATE` for every multi-statement mutation, with pins for two
  |   PROCESSES writing at once (no error, no corruption, `integrity_check` ok), a reader never
  |   blocked while a writer works, and an abrupt SIGKILL mid-transaction leaving no partial row.
  |   ENCAPSULATION is a requirement: all item SQL and every path/file detail stay under `src/storage/`,
  |   and `docs/STORAGE.md`/`docs/DEPLOYMENT.md` are rewritten because the blob layout they describe is
  |   being deleted. The 6 key rows (and the master key) survive by construction — the migration
  |   touches only `objects`. NOT in scope: the console (row 80), any change to the API contract, and
  |   any change to the key/auth model.

(The row=79 `IN-FLIGHT` block is FOLDED by the LANDED row=79 record in `## Landed` — the writer's
own record, added in the docs child of landing 620a71b. Its scope statement is unchanged and now has
a landing: item bytes in `objects.content`, WAL/`busy_timeout`/`synchronous = FULL`/`BEGIN IMMEDIATE`,
the verified boot import, the removal of the blob layout and the shared-blob check, pins Y1–Y8, the
rewritten STORAGE/DEPLOYMENT docs, and NO change to the API contract, the key model or the console.)

(The row=71 `IN-FLIGHT` block is FOLDED by the LANDED row=71 record in `## Landed` — a
mechanical union; docs/BOARD.md is the only file the fold touched, and no other landing's
record was altered. Its scope statement is unchanged and now has a landing: the three
destructive routes plus byte reclamation, pins X1–X9, no console work and no change to
`revoke`'s behaviour.)

IN-FLIGHT | row=68 | session=(dispatching now) | worktree=worktrees/browser-test |
  | branch=feat/browser-test | base=origin/main — resolved by the writer and recorded in its landing
  | state=THE ONE WRITER. Scope: TEST-ONLY — the headless-browser test the console and CORS are owed
  |   (design = ledger row 67, which is the authority; brief `docs/briefs/slice-15-browser-test.md`).
  |   ONE seam `tests/helpers/browser.ts` owns the launch (`/usr/bin/google-chrome --headless=new`,
  |   temp `--user-data-dir` under the worktree, loopback debugging port), the DevTools session over
  |   Node's built-in `WebSocket` (no dependency), TRUSTED `Input.*` events for the console flow, and
  |   the KILL of the whole process GROUP from `afterAll` AND a failure path. Pins B1–B8: the console's
  |   JS actually runs, a key authenticates through the UI, the EDIT flow really PATCHes (asserted
  |   through the API, not the DOM), a real browser on ANOTHER origin completes an authorized fetch,
  |   reads the exposed `x-serverstore-sha256`, a DISALLOWED origin is blocked BY THE BROWSER, nothing
  |   outlives the test, and a MISSING browser FAILS the run instead of skipping. It runs IN THE GATE.
  |   NOT in scope: any product-code change, any new dependency, any screenshot/visual claim.

(The row=65 `IN-FLIGHT` block is FOLDED by the LANDED row=65 record in `## Landed` — a mechanical
union; docs/BOARD.md is the only file the fold touched, and no other landing's record was altered.
Its closing sentence said "no npm dependency", which is true of the landing; the JUSTIFICATION for
that choice in ledger row 64 first read "the project is dependency-free by policy", which is FALSE
and was corrected in a fix-forward commit by the dispatcher before this landing was written.)

(The row=61 `IN-FLIGHT` block, dropped by the dispatcher at row 62 as superseded and stale: slice 13
landed, was independently verified with three own arms, and its worktree worktrees/object-prefix,
branch feat/object-prefix and session fc919615… are RETIRED. The dropped block repeated the BRIEF's
P7 wording, which was WRONG — `substr`/`LIKE` do NOT produce `SCAN objects`, so "no SCAN" could not
fail for the arm the brief demanded turn red; the landed pin asserts the index's `name>? AND name<?`
range, and the dispatcher reproduced the plans on 2000 rows to confirm it.)

LANDED | row=62 | sha=695ba2e (the VERIFIED CODE tip; the slice-13 landing itself is row 61 below.
  | Pulled to the remote tip and re-probed BEFORE my own gate and arms, per GUARD g5)
  | verify=THE DISPATCHER'S OWN, on the INTEGRATED tree: gate exit 0 GREEN · 13 files · 127 tests ·
  | 2.35s (raw log `.gate-logs/dispatcher-gate-s13.log`), matching the writer's own count.
  | arms=`.gate-logs/dispatcher-arms-s13.sh`, transcript `.gate-logs/dispatcher-arms-s13.out`, the
  | gate lock held across the control and ALL THREE arms, sha256 printed before and after each
  | mutation, restore from HEAD in an EXIT/INT/TERM trap with the hash asserted back, a control BEFORE
  | and AFTER, and a NEW rule in this harness: an arm whose cheap tier carries `error TS` is VOID
  | (the row-46 lesson). Arms, none of them the writer's (the writer armed A the exclusive lower bound
  | → P1, B `substr` → P7, C the doc rotted → P8):
  |   D the prefix VALIDATION neutralised (`parseObjectPrefix` returns the raw string),
  |     src/core/validate.ts `dcfe6fa9…0687` → `73716791…84f4` → **RED on PIN P3 AND PIN P4** — an
  |     empty `?prefix=` returned the WHOLE store and an unmatchable prefix was silently empty, which
  |     is the fallback AGENTS.md rule 1 forbids. Both are validation pins, so this is honest
  |     coverage of ONE mechanism by two assertions, not noise; P1/P5 stayed GREEN.
  |   E the prefix parsed BEFORE the authorization decision, src/server/app.ts `0d389edf…1f2f` →
  |     `6e50f86b…fcbd` → **RED on PIN P6 ALONE**: an illegal prefix from a key that cannot read the
  |     store became 400 where it must stay 403 — the writer's judgement call 1 is genuinely pinned.
  |   F an empty listing turned into a `404`, app.ts `0d389edf…1f2f` → `5dbf9418…f66c` → **RED on PIN
  |     P2 ALONE**, which is the error-vs-empty direction the other five arms never touched.
  |   both controls GREEN (13 files · 127 tests), every mutated file back at its before-hash, no VOID
  |   probe. Arms D and E/F mutate different files; the two app.ts arms carry DIFFERENT after-hashes
  |   from the SAME before-hash.
  | THE WRITER'S P7 CORRECTION IS CONFIRMED BY MY OWN MEASUREMENT, and it corrects MY brief: I
  | reproduced the plans on an in-memory database with 2000 rows and ANALYZE —
  | `… name >= ? AND name < ?` → `SEARCH objects USING INDEX sqlite_autoindex_objects_1 (store=? AND
  | name>? AND name<?)`, while `substr(name,1,length(?)) = ?` and `name LIKE ?` both → `SEARCH objects
  | USING INDEX … (store=?)`. So the brief's P7 ("contains NO `SCAN objects`") could NOT fail for the
  | arm the same brief demanded turn RED. The landed pin asserts the displacing signal (the index
  | search carries the `name>? AND name<?` bounds and the statement has no LIKE/substr), and the
  | writer's arm B proves it. **This is the DISPATCHER'S error, recorded rather than quietly
  | corrected.** The stale `IN-FLIGHT | row=61` block, which repeated the wrong wording, is DROPPED
  | (mine to drop; it was superseded by the row-61 landing record).
  | THE MANDATORY `COPIES:` LINE IS MISSING FROM THE DOCS and this row carries it instead: the writer
  | put it in its REPORT but in no amended file (`grep -rn COPIES docs/` finds none for slice 13,
  | where every earlier landing has one in its board record — AGENTS.md rule 5's grep-ability is the
  | point). Ratified from its report and VERIFIED by me: **`COPIES: 3→1`** — the objects column list
  | `store, name, sha256, size, created_at` was written out three times and is now ONE `OBJECT_COLUMNS`
  | constant (`src/storage/kinds.ts:102`) behind all three SELECTs (all-list :110, prefix-list :113,
  | point read :150, checked by grep); **`COPIES: 1`** for the charset rule (`NAME_PATTERN` is the only
  | regex in `src/core/validate.ts:19`, and `parseObjectPrefix` routes through `parseName`) and for the
  | range bound (`objectPrefixRange()` is the ONE place the prefix+U+FFFF bound is built, and PIN P7
  | binds the production parameters rather than re-deriving them).
  | LIVE (GUARD g5)=restarted onto the prefix tip at 09:22:17 CEST, `scripts/probe-live.sh
  | https://store.futuremagic.de` → PASS exit 0, and the new shape checked on the REAL host WITHOUT a
  | key: `GET /stores/colossus/objects` answers 401 with and without `?prefix=game.`, and an EMPTY
  | (`?prefix=`) or ILLEGAL (`?prefix=GAME`, `?prefix=game%2F42`) prefix is **401, not 400** — the
  | authorization-before-parse ordering, confirmed end to end on the live service rather than only in
  | process. The key-bearing filtered listing (a 200 `{objects:[…]}` under a prefix) is the OWNER's
  | / his game agent's acceptance step: the dispatcher holds no key.
  | retired=worktree worktrees/object-prefix · branch feat/object-prefix (was 2e0dd5d, verified fully
  | merged with `git branch --merged main`) · writer session fc919615… — salvage-checked BEFORE
  | deletion (tracked-clean worktree, tip == origin/main, only untracked scratch was its own
  | `.diff-harness` under its own worktree). Host after: `git worktree list` shows only `main`,
  | `git branch -a` has no `feat/object-prefix`, lock free, 0 browser processes.
  | docs=ledger row 62 · this board.

LANDED | row=61 | sha=695ba2e (the VERIFIED CODE tip: `src/storage/kinds.ts`, `src/core/validate.ts`,
  | `src/server/app.ts`, `tests/objects.test.ts`, `tests/api-doc.test.ts`, `docs/API.md` and
  | `checkpoints/prefix-differential.sh`; the docs commit carrying THIS line, the ledger row 61,
  | `docs/SEAM-INDEX.md` and `docs/TESTING.md` is its child — a commit cannot name its own sha)
  | THE PREFIX FILTER: `GET /stores/:store/objects?prefix=`, an OPTIONAL narrowing that is a RANGE on
  | the objects primary key (never `LIKE`, never `substr`) so the store is never scanned. Writer
  | session (a subagent of dispatcher session dcd6176e-b4b9-4759-b64d-4c90d3495dfa), worktree
  | `worktrees/object-prefix`, branch `feat/object-prefix`, base
  | origin/main **0afb273** (resolved with `git rev-parse --short origin/main` at dispatch time).
  |   scope=ONE seam (`StoreKindHandler.list(db, store, prefix?)` in `src/storage/kinds.ts`), ONE
  |   parser (`parseObjectPrefix()` routes through the existing `parseName` with `what` = "object name
  |   prefix"; the legal-name language is prefix-closed, so the ONE rule refuses exactly the
  |   unmatchable strings with the EXISTING `invalid_name` 400), ONE route (authorization decided FIRST
  |   and for the store). Absent prefix = the unchanged full listing; valid-but-empty = `200
  |   {"objects":[]}`, never 404; empty/whitespace = LOUD 400, never the whole store. No new route,
  |   error code, schema, or authorization rule (PIN A1–A3 green). NOT in scope, named in docs/API.md:
  |   `since=`, `limit=`, pagination, cursors, `ETag`/`If-Match`, server-assigned ids, lookup by
  |   `sha256`, and any `prefix` on `GET /stores` or `GET /keys`.
  | verify=THE WRITER'S OWN, in-turn: `bash scripts/gate.sh` → exit 0 (GREEN) · 13 test files · 127
  | tests · 2.32s · raw log `.gate-logs/gate.log`; no memory ceiling needed (GUARD g3 still open and
  | still honest). The DISPATCHER's independent gate and its own arms are OWED.
  | arms=checkpoints/prefix-differential.sh, the gate lock held across ALL THREE arms, sha256 printed
  | before and after, restore from HEAD in an EXIT/INT/TERM trap, a control BEFORE and AFTER, raw
  | transcript checkpoints/prefix-differential.out (key-shaped strings scrubbed — ledger row 21):
  |   A the range's lower bound made EXCLUSIVE (`name >= ?` → `name > ?`), src/storage/kinds.ts
  |     7b17b9a6…07fe9 → 1c7746a3…ef6b, RED on `PIN P1: ?prefix= returns exactly the matching entries`
  |     — `expected [ Array(3) ] to deeply equal [ 'room-4', 'room-42.a', …(2) ]`; P2–P7 stayed GREEN.
  |   B the filter re-implemented as `substr(name, 1, length(?)) = ?` with its own bind parameters,
  |     src/storage/kinds.ts 7b17b9a6…07fe9 → 40d7bda1…96ad, RED on `PIN P7: the prefix query is a
  |     RANGE on the primary key` — `["SEARCH objects USING INDEX sqlite_autoindex_objects_1
  |     (store=?)"]` — while **P1–P6 stayed GREEN: every returned row is still correct**, which is
  |     exactly why P7 exists.
  |   C the API doc's "`prefix` is the ONE filter" truth replaced by the stale "a store with many
  |     objects returns them all", docs/API.md 8742a568…da7e → 241348a5…3ced, RED on `PIN P8: the API
  |     doc's stated \`prefix\` behaviour matches the code`; PIN A1–A3 stayed GREEN.
  |   Both controls GREEN (13 files · 127 tests), both mutated files restored to their before hashes.
  |   The harness found its OWN bug on its FIRST run: arm B's anchor replaced only the `${…}` inside a
  |   template literal, leaving the literal string `prefix`, which matched nothing and ALSO reddened
  |   P1 — the harness refused the arm as unattributable and it is recorded in docs/TESTING.md.
  | brief_correction=THE BRIEF'S P7 WORDING WAS WRONG, recorded here because the STALE IN-FLIGHT block
  |   and the brief both repeat it: P7 cannot be "EXPLAIN QUERY PLAN contains NO `SCAN objects`",
  |   because a `substr`/`LIKE` implementation produces `SEARCH … (store=?)`, not a SCAN, so that
  |   assertion cannot fail for the arm the brief requires it to fail for. P7 asserts the displacing
  |   signal instead: the index search must carry `name>? AND name<?`. This is a correction of the
  |   brief's PIN, not of its design — the range query the brief asked for is what landed.
  | docs_amended=docs/DECISION-LEDGER.md (row 61), docs/SEAM-INDEX.md (the listing row + gotcha 16),
  |   docs/TESTING.md (pins P1–P8 + the 3-arm differential + honest unknowns), docs/API.md (route row,
  |   listing bullet, Names rule, Non-goals, curl walkthrough).
  | copies=COPIES: 3→1 — the objects column list (`store, name, sha256, size, created_at`) in
  |   `src/storage/kinds.ts` is now one constant (`OBJECT_COLUMNS`) behind the all-list, prefix-list and
  |   point-read SELECTs; the charset regex stays COPIES: 1 (`NAME_PATTERN` in `src/core/validate.ts`,
  |   with `parseObjectPrefix()` routing through `parseName`), and the range bound stays COPIES: 1
  |   (`objectPrefixRange()`, which PIN P7 binds instead of re-deriving).
  | retire_owed=worktree worktrees/object-prefix and branch feat/object-prefix are the DISPATCHER's
  |   to retire after it verifies this landing. NOT claimed retired here: the branch still exists
  |   (the writer is on it), so the `retired_branch=` key must not be used (board.sh would correctly
  |   report BOARD STALE, board.sh:110-125).

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

(B2 is CLOSED: verified by the dispatcher (row 50 — gate 11 files / 92 tests / 2.04s; arm X took out
FOUR pins across three features by mutating the ONE containment predicate, arm Y confirmed L4 covers
the peer-admin rule), its worktree worktrees/key-lifecycle, branch feat/key-lifecycle and session
a5bcf77c… are RETIRED, and the LIVE service was restarted to it and re-probed under GUARD g5. The key
lifecycle — list and revoke — is now available over HTTP.)

LANDED | row=49 | sha=0570fc2 (the VERIFIED CODE tip ON THE REBASED TREE, which is what is on
  | origin/main: `src/server/assets.ts`, `src/server/app.ts`, `web/index.html`, `web/app.js`,
  | `web/app.css`, `tests/admin-ui.test.ts`, `tests/helpers/server.ts`, `tests/api-doc.test.ts`,
  | `checkpoints/admin-ui-differential.sh`, plus `docs/API.md` and `docs/SEAM-INDEX.md`; the docs
  | commit carrying THIS line, the ledger row 49, `docs/TESTING.md` and the differential transcript
  | is its child — a commit cannot name its own sha) | THE ADMIN UI (C1): the owner's console,
  | served by THIS service at the same origin as three fixed no-build routes. Writer session
  | 529a0ac5-a705-41f0-a268-c22ba265da5c (a subagent of dispatcher session dcd6176e…), worktree
  | worktrees/admin-ui, branch feat/admin-ui, base origin/main 45346fb — FAST-FORWARDED to the
  | dispatcher's IN-FLIGHT commit c909da3 before any edit (the row-40 lesson: the brief's base had
  | already moved) — then REBASED onto origin/main 3263a1e before push. The pre-rebase code tip was
  | `20e2f75`, and that is the sha the differential transcript's CONTROL line names; the rebase
  | replayed it as `0570fc2` with an EMPTY content delta (`git diff --stat 20e2f75 0570fc2 -- src
  | tests web docs/API.md docs/SEAM-INDEX.md` is empty), so the gate and the arms ran on exactly the
  | code that lands. The first docs commit named the pre-rebase sha; THAT was corrected forward in a
  | follow-up docs commit rather than rewritten, because main is not force-pushed.
  | verify=THE WRITER'S OWN, in-turn: `bash scripts/gate.sh` → exit 0 (GREEN) · 12 test files ·
  | 96 tests · 2.11s · raw log `.gate-logs/gate.log`; no memory ceiling needed (GUARD g3 still open
  | and still honest). The DISPATCHER's independent gate and its own arms are OWED.
  | arms=checkpoints/admin-ui-differential.sh, the gate lock held across BOTH arms, web/app.js's
  | sha256 printed before and after, restore from HEAD in an EXIT/INT/TERM trap, a control BEFORE
  | and AFTER, raw transcript checkpoints/admin-ui-differential.out (key-shaped strings scrubbed —
  | ledger row 21):
  |   A the key is WRITTEN TO A BROWSER STORE (`localStorage.setItem` beside the module's ONE
  |     assignment to `key`), web/app.js 6e1b862b…d128 → 1619558c…d247, RED on `PIN U2: the served
  |     app.js references no key-persistence API` — `expected [ 'localStorage' ] to deeply equal []`;
  |     U1/U3/U4 stayed GREEN.
  |   B the console CALLS A PATH NO ROUTE REGISTERS (`fetch("/no-such-route")` appended),
  |     6e1b862b…d128 → 3c977fbd…88f8, RED on `PIN U3: every path the UI calls is a route the API
  |     registers` — `expected [ '/no-such-route' ] to deeply equal []`; U1/U2/U4 stayed GREEN.
  |   both controls GREEN (12 files · 96 tests), web/app.js back at 6e1b862b…d128. The two arms
  |     carry DIFFERENT hashes from the SAME before-hash. No VOID probe.
  | what it is=`src/server/assets.ts` `UI_ASSETS` is the WHOLE static surface: THREE literal GET
  |   routes (`/`, `/app.js`, `/app.css`), each naming its file under `web/` LITERALLY — no directory
  |   walking, no static-file middleware, no client-supplied string in a path, so no traversal
  |   surface is added. The files resolve from `assets.ts` via `import.meta.url`, never from cwd; a
  |   missing asset is a LOUD 500 (`internal`), never a blank page; every response carries
  |   `cache-control: no-store`. The routes register BESIDE `/healthz` and BEFORE
  |   `app.use("*", guard)` — the console must load WITHOUT a key (the operator types it INTO the
  |   page) and `GET /whoami` is what proves it. `GET /` is a literal route, not a catch-all:
  |   `/stores` is still 401 and an unknown path is still the API's JSON 404 (both pinned by U1).
  |   Behaviour: password-field key entry proven with `GET /whoami` (nothing else is fetched until
  |   it succeeds), stores list/create, keys list, mint with `read`+`write` ON and `delete`/`admin`
  |   OFF by default, `admin` unavailable unless the scope is the every-store `["*"]` (the API
  |   refuses it otherwise and the note says so), the returned key shown ONCE with a copy button and
  |   a blunt warning, revoke, and API errors rendered from the `{error:{code,message}}` envelope.
  |   Phone-usable CSS. docs/API.md gained the three routes plus an "admin UI" section, so pins
  |   A1–A3 stay green (12 files · 96 tests, tests/api-doc.test.ts 3/3).
  | what it does NOT add=a bundler, a build step, a second entrypoint, a static-file subsystem, or a
  |   secret in the tracked tree. The key lives in ONE module variable in `web/app.js` and is
  |   cleared by "Forget key"; U2 scans the SERVED bytes for every persistence API, U3 pins every
  |   path it calls to `createApp().routes`, and U4 pins the HTML to same-origin with no inline
  |   script.
  | wire format=unchanged: `{error:{code,message}}`; THREE new routes (`GET /`, `GET /app.js`,
  |   `GET /app.css`) and no new error code.
  | docs=docs/DECISION-LEDGER.md row 49 · docs/SEAM-INDEX.md (the UI seam + gotcha 11: the asset
  |   routes must stay above the key guard) · docs/TESTING.md (U1–U4, both arms with their hashes,
  |   and the honest unknown: nothing executes the page in a browser) · docs/API.md (the three
  |   routes + the admin-UI section) · this board.
  | COPIES: 2→1 — the route-set derivation was defined TWICE (tests/api-doc.test.ts's local
  |   `registeredRoutes()` and the new PIN U3's copy) and now lives ONCE in
  |   `tests/helpers/server.ts` `registeredRoutes()`, read by PIN A1 and PIN U3; and
  |   `src/server/assets.ts` `UI_ASSETS` is the ONE place the three asset routes are named (the app
  |   registers them FROM that table, so the route list cannot be retyped). Grepped:
  |   "registeredRoutes", "UI_ASSETS", "readUiAsset", "createTestServer", "localStorage",
  |   "sessionStorage", "history.pushState".
  | HONEST UNKNOWN (the brief's price, ledger row 48): nothing executes the console in a browser.
  |   U1–U4 are static scans of the SERVED bytes plus served status/content-type checks, and plain
  |   JS is not typechecked by the cheap tier. A HEADLESS-BROWSER test is OWED and is explicitly
  |   not v1 (the host rule: a browser is a process TREE, its kill belongs in a trap).
  | GUARD g5 APPLIES: this landing touches `src/`, so the LIVE service still serves the pre-C1
  |   code. The DISPATCHER must pull, restart the unit (its WorkingDirectory is the main checkout,
  |   which only now contains `web/`), and re-run `scripts/probe-live.sh
  |   https://store.futuremagic.de` — and then `GET /` on the live hostname answers the console —
  |   before the owner relies on it.
  | retired=none yet. The worktree worktrees/admin-ui and branch feat/admin-ui are the dispatcher's
  | to retire after ITS OWN verification; this writer does not retire itself.

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
  127.0.0.1:8477 only, the LOCAL probe is PASS exit 0, one ingress line validates as rule #6 →
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
QUEUE | row=52 | C2 SCOPE SETTLED (owner): editing STAMPS the change (`updated_at` + the editing key's
  id, two add-if-absent columns returned by `GET /keys`; a never-edited key says "never changed"),
  and renaming is part of editing. Pins E1-E7, of which E6 is the one that must not be assumed:
  editing does NOT change the key's value — the same raw key still authenticates. Deferred: editing
  `expiresAt`, edit history, undo. C2 lands after C1 is verified (same files).
QUEUE | row=51 | QUEUED BEHIND C1: C2 = NAMED, EDITABLE keys. `PATCH /keys/:id` taking any subset of
  `{label, stores, perms}`, with validation identical to mint and the same boundary (only an admin
  may edit; a scoped admin only within its own set and never `admin`; a REVOKED key is not editable
  back to life). Editing is IN PLACE — the key's value never changes — which the owner's own words
  decided ("no need to show them again"). Viewing permissions needs no new API: `GET /keys` already
  returns label, stores and perms, and C1's UI displays them. Deferred: editing `expiresAt`, and any
  history of edits.
QUEUE | row=48 | STEP C1 (the admin UI) is QUEUED BEHIND B2 and its brief is already on disk at
  docs/briefs/slice-10-admin-ui.md. Forks settled by the owner (row 48): SAME ORIGIN, served by the
  store service at store.futuremagic.de, as NO-BUILD static assets (three fixed routes: / , /app.js ,
  /app.css). Security defaults pinned: the key lives in memory only (no localStorage/sessionStorage/
  cookie/URL/history), the served bytes carry no secret, and every path the UI calls must be a route
  the API registers. Honest price: no-build JS is not typechecked and no automated check exercises it
  in a browser — a headless test is owed and is NOT v1.
QUEUE-CLOSED | row=56 | LANDED as row 57 (writer's own gate GREEN · 13 files · 119 tests; arms A/B
  RED on PIN O1/PIN O4 — see the LANDED record below). The dispatch note is the design it was built
  to. NOW VERIFIED AND RETIRED (ledger row 58 / LANDED row=58): own gate GREEN · 13 files · 119
  tests · 2.24s, own arms R (O1 alone) and T (O3 with D7 as honest collateral), LIVE preflight 204
  with `allow-credentials` appearing 0 times, worktree/branch/session gone — THE TURN-BASED GAME IS
  UNBLOCKED. CORS DISPATCHED (it blocks a turn-based game being built against this store from
  another origin). Design: an allowlist via `SERVERSTORE_CORS_ORIGINS` (unset = `*`, safe because
  there are no cookies or ambient credentials), `authorization` named EXPLICITLY in Allow-Headers
  (the wildcard does not cover it), Allow-Methods GET/POST/PUT/PATCH/DELETE/OPTIONS, Max-Age,
  `x-serverstore-sha256` exposed, NEVER Allow-Credentials, and the PREFLIGHT ANSWERED BEFORE THE KEY
  GUARD — the trap that would otherwise answer OPTIONS with 401. FORK 2 (trust model): a key scoped
  to a store can read/write ANY object in it, so the store does not enforce per-player isolation;
  the no-new-feature design for turn-based play is per-player OBJECTS whose room state each client
  derives, and real enforcement would need one store per player (already enforced) or per-store
  permissions (row 41's deferred extension).
QUEUE-CLOSED | row=59 | **FORK CLOSED — the owner chose (A) on his game agent's recommendation and it
  is DISPATCHED as row 61 (ledger row 60).** reading ONE entry
  already works (`GET /stores/{store}/objects/{name}`); entries are identified by their NAME (`PRIMARY
  KEY(store, name)`, `[a-z0-9][a-z0-9._-]{0,63}`), NOT by a server-assigned id; the real gap is that
  `GET /stores/{store}/objects` takes NO query parameter and returns the WHOLE store, so a client
  cannot ask for a SUBSET.** Owner, verbatim: *"For gaming it would be nice if a store could be
  queried for a specific ID so that the game would not need to search through all entries. … Does
  each entry have an ID already?"* (A) `prefix=` on the existing list route — RECOMMENDED: no schema
  change, names stay client-chosen, and a game names moves under one prefix (`room-42.0007.tom`) so
  one request returns the room. (B) server-assigned ids via a new `POST …/objects` — a second
  identity kind: needs an `id` column + unique index, costs idempotent PUT-by-name unless both
  exist, and buys a game nothing a prefix does not. (C) lookup by `sha256` — rejected: the hash
  addresses CONTENT, so it is useless as "the same entry after an update". His agent's naming plan
  (`game.<id>`, `player.<id>.<tag>`, `snap.<id>.<turn>.<seq>.<tag>`) is GAME-side and was VERIFIED
  free: a read-only query of the LIVE database returned exactly 3 objects, all in store `colossus`,
  longest name 33 of 64 chars (ledger row 60). DISPATCHED as row 61 — brief
  `docs/briefs/slice-13-object-prefix.md`: a range filter on the primary key validated by the EXISTING
  name rule with `what` = "object name prefix" (the legal-name language is prefix-closed), `200 []` for
  a match-nothing prefix, `400 invalid_name` for one that can never match, no schema change.
  Deferred unchanged: `since=`/`limit`/`ETag` (row 28), server-assigned ids (option B), lookup by
  `sha256` (option C), blob GC.
QUEUE-CLOSED | row=63 | **RETRACTED AND CLOSED WITH NO CODE CHANGE — my own dispatch-turn audit
  diagnosis was WRONG.** I recorded here that `scripts/board.sh`'s host line reported "suites: 1" on a
  quiet box "because `SUITE_PATTERN` matches the LIVE SERVICE". Measured properly, that is FALSE:
  `SUITE_PATTERN` is `vites[t]|jest|pytest` (`scripts/board.sh:25`), which does NOT match the
  service's argv (`/proc/<MainPID>/cmdline` = `node --experimental-strip-types …/src/server/main.ts`,
  tested FALSE by a probe whose own argv carries no pattern), and a self-match-free enumeration over
  ALL of `/proc` reports **0** matching processes while the service is UP and healthy (MainPID 92039,
  active 09:22:17 CEST, NRestarts=0; probe PASS). The one hit was the CALLER: `pgrep -af` matches a
  shell whose own command line contains the literal text `vitest`/`jest`/`pytest`, and that audit ran
  in the same `bash -c` as my own `pgrep … "vitest|…"` — reproduced deterministically
  (`bash -c 'echo vitest; <audit>'` → exactly 1 hit, the caller itself). So there is nothing to fix in
  `scripts/board.sh` when a caller is clean; the lesson is a TRAP (t6), and the honest correction is
  that a guard is only as good as the shell that reads it. Evidence and the probe:
  `.gate-logs/suite-audit.py`.
QUEUE-CLOSED | row=64 | **RATE LIMITING: DESIGNED (ledger row 64) and DISPATCHED as row 65** — one
  bounded, in-memory, per-IDENTITY bucket in FRONT of the key guard (an unkeyed flood is what a public
  endpoint faces, and the key comparison is the work worth protecting), identity from `CF-Connecting-IP`
  then the first `X-Forwarded-For` hop then one `local` bucket (the socket address is always the
  tunnel), a hard-capped bucket table WITH eviction because a map keyed by a client-supplied header is
  itself a DoS vector, `/healthz` + the three UI assets + CORS preflights NEVER limited, a new
  `rate_limited` 429 code with `Retry-After` (which means `retry-after` must join
  `Access-Control-Expose-Headers`, changing two CORS pins that assert that header by equality),
  `SERVERSTORE_RATE_LIMIT` default **600 per 60 s** with `0` = disabled, and an injected clock so the
  boundary is pinned deterministically — NO synthetic load against the live service. The per-key
  bucket is DEFERRED and named.
QUEUE-CLOSED | row=67 | **DESIGNED (ledger row 67) and DISPATCHED as row 68** — the OWED HEADLESS-BROWSER test, which closes the same gap
  for both the console (rows 49/54) and CORS (rows 57/58): nothing automated drives a real browser.
  TWO things are settled rather than guessed: (1) **the owner chose to DRIVE THE INSTALLED
  `/usr/bin/google-chrome` DIRECTLY over the DevTools protocol with Node's built-in `WebSocket` and NO
  new dependency**, rejecting `playwright-core` (a new dev dependency in a repo that serves this API)
  and Playwright's own Chromium (~170 MB, duplicating a browser already on the box); (2) it STARTS
  IT IS READY TO START: row 65 has LANDED and was verified and retired (row 66), so the shared
  `tests/helpers/server.ts` is free — a shared file meant SERIALIZE, and that was proven by reading
  the writer's worktree rather than predicted. It must be
  BOUNDED and in-turn: the browser is a process TREE, its kill belongs in a `trap`, scratch lives under
  the worktree (never `/tmp`), and the run ends with a count that cannot self-match
  (`ps -eo comm= | grep -c '^chrome$'` → 0).
  Also deferred by owner decision, not forgotten: per-store permissions (`key_stores` + perms) — only
  if a game needs ONE mutable shared room object; editing `expiresAt`; edit history.
QUEUE | row=72 | **OPEN FORK, THE OWNER'S CHOICE (ledger row 72): items inside SQLite, one file per entry, or
  both per store.** He is uneasy about one file per entry and asked why the items are not in the database
  too. Measured answer: for HIS workload (small JSON objects) SQLite-for-items is simpler — one file to
  back up, no inode budget, and NO orphan blobs at all (the mess row 71 is cleaning up) — while the real
  costs are a write lock that would cover the bytes, no incremental blob API in `node:sqlite` (whole-value
  binds only), a single file that must be backed up with `backup`/`VACUUM INTO` rather than `cp`, and one
  corruption losing names AND content. SQLite's own limits are far off (1 GB per value; 16.0 TiB max DB
  measured). The architecture already allows BOTH: `StoreKindHandler` + `store_kinds` exist for "each
  store has its own format", `POST /stores` already takes a `kind`, and only `bytes` is registered — so a
  second kind (`inline`) is an addition, not a rewrite. Named cost: two kinds to pin, and the kind seam
  must first absorb DELETE (today the route runs `DELETE FROM objects` directly). NOT dispatched: this is
  a product fork with a real cost either way, so it goes to the owner.
  EXTENDED (ledger row 74): the owner answered *"How about postgres?"*. MEASURED — Postgres is not
  installed as a package, but Docker is up and a `postgres:16-alpine` container (`guac-db`, Guacamole)
  has run for 10 days, so a store database costs a SECOND container rather than an install. Real gains:
  MVCC (a big write blocks no reader), TOAST/`bytea` with streaming, `pg_dump`/PITR backups, queryable
  items, multi-instance headroom. Real costs: the store is a HOST process so the container must publish
  on LOOPBACK (`-p 127.0.0.1:5433:5432`, never 0.0.0.0); the DB password cannot live in the tracked
  unit file (an `EnvironmentFile` outside the repo, itself to be backed up); a `pg` dependency, a
  PG-dialect schema and a much heavier test harness (159 tests run in 2.3 s against in-process
  `node:sqlite` today); a backup job and runbook; and a SECOND failure domain. REJECTED: pointing the
  store at the existing `guac-db` (couples it to Guacamole's container, version and blast radius).
  RECOMMENDED: the kind seam already IS a backend seam — add the SQLite `inline` kind now (zero new
  services, removes the files), and add a Postgres kind when a concrete need appears.
  FURTHER (ledger row 75): the owner asked for a LOCAL NON-SERVER Postgres, and it EXISTS —
  `@electric-sql/pglite` 0.5.8 is real Postgres as WASM running INSIDE the Node process, persisting
  to a directory, requiring NO host install, with `@electric-sql/pglite-tools` providing `pgDump` for
  backups. It would be a third store kind (`pg`), tests stay in-process, and there is no port,
  password, container or second failure domain. HONEST LIMITS, from its own docs: "PGlite only has a
  single exclusive connection", so it is single-process (no multi-instance concurrency), it is
  slower than native Postgres (WASM), pre-1.0, and limited to compiled-in extensions. The NATIVE
  equivalent (private cluster: `initdb` + `pg_ctl`, `listen_addresses=''`, unix socket only) is real
  Postgres with no TCP port but needs a host install plus lifecycle management we would own — more
  machinery than PGlite for the same property.
  AND NoSQL (ledger row 76): the owner is not married to Postgres and asked for a web check. MEASURED
  on this box — `lmdb` 3.5.6 installed and RAN on Node 24 without compiling (prebuilds; pnpm blocked
  its build script and it worked anyway), a prefix range scan is native (`getRange`), the whole
  database is TWO files (`data.mdb` + `lock.mdb`), and it grew itself to 20 MB despite a reported
  131 KB default map size. Also weighed from npm metadata: `classic-level` (LevelDB, many files),
  `@seald-io/nedb` and `lowdb` (pure JS, one JSON file, whole-DB in memory), `pouchdb` (the ONLY
  option with CouchDB-style SYNC — a client-side product decision, not a storage swap), `pglite`
  (Postgres in-process). Nothing decided; all candidates land behind the same kind seam.
  CONCURRENCY (ledger row 77): the owner's real objection is SQLite's locking, from experience years
  ago — and MEASUREMENT CONFIRMS HIM: the live database is in `journal_mode = delete` (set explicitly
  at `src/core/db.ts:175`) with NO `busy_timeout`, i.e. exactly the mode he remembers. Measured here:
  with 200 small transactions in flight, a reader was BLOCKED/errored on **130 of 578 reads (~22%)**
  in delete mode and **0 of 582** in WAL, while the writer ran **711 ms vs 316 ms**. Two writers
  always SERIALIZE (SQLite allows one writer), and with NO busy timeout a second writer gets
  `database is locked` instead of waiting — reachable today by running `pnpm run admin:key` under
  load. FIX, recommended REGARDLESS of the backend: WAL + an explicit `busy_timeout` +
  `BEGIN IMMEDIATE`, pinned by turning that probe into an assertion. LIMIT THAT REMAINS: no
  concurrent WRITERS and no network access — and LMDB does not solve that either (it is also
  single-writer); only Postgres does, and PGlite (single-connection) does not. TRADE: WAL adds
  `-wal`/`-shm` sidecars, so a plain copy of `serverstore.db` can miss the newest commits — the
  backup rule in `docs/STORAGE.md` becomes mandatory.
QUEUE-CLOSED | row=81 | **THE CONSOLE SLICE (ledger row 81) IS DISPATCHED as row 82** — the owner's four
  destructive actions as UI: delete a key, look inside a store (names, server-side `prefix=` filter)
  and delete an entry, empty a store and delete a store (both with the store name TYPED, sent as the
  server's `confirm=` token). UI-ONLY: the routes landed at row 71 and are live, the key stays in
  memory, every path called must be a registered route (U2/U3), and the browser test landed at row 68
  is what proves the flows in real Chrome.
QUEUE-CLOSED | row=78 | **STORAGE MODEL SETTLED BY THE OWNER (ledger row 78): SQLite is the core — items live in the
  | database, the per-item files go, concurrency is asserted not to corrupt (a wait is fine) and the
  | storage layer stays encapsulated. DISPATCHED as row 79.** The forks this closes (rows 72/74/75/76/77):
  | Postgres-as-container, a native private cluster, PGlite, LMDB, PouchDB and the pure-JS JSON stores
  | are all REJECTED FOR NOW, with their measurements kept in those rows so revisiting is cheap. The
  | one durable piece of that research is the WAL/`busy_timeout`/`BEGIN IMMEDIATE` finding (row 77)
  | plus the boundary it names: SQLite serializes WRITERS, so "concurrent writers or a second app
  | instance" is the requirement that would reopen this, and LMDB would not satisfy it either.
QUEUE | row=87 (only if the other project needs it) | **TWO LIMITS REPORTED BY THE OWNER'S OTHER PROJECT**
  |   (ledger row 86): names are capped at 64 characters and request bodies at 64 MiB — BOTH CONFIRMED in
  |   code, and both live (the unit sets no `SERVERSTORE_MAX_BYTES`, so 64 MiB is what the host enforces).
  |   The NAME LENGTH is policy (the constant is referenced only in `validate.ts`; entry names never were
  |   filesystem paths, and they are TEXT in SQLite now) and raising it is one constant + regex + docs +
  |   pins, a WIDENING that breaks nothing — while the CHARSET (lowercase, no `/`, no leading `.`, no `..`)
  |   is the load-bearing part. The ITEM CAP is load-bearing: a write and a read each peak near 2× the item
  |   in memory and every write lands the item in the WAL, so the cap bounds `concurrency × size` against
  |   the box's RAM; the VALUE is an operator setting with no parser upper bound. NOTHING CHANGES until the
  |   other project says what it needs (a name length, an item size); the alternative to a bigger cap is
  |   chunking into parts and listing them with `prefix=`.
QUEUE | row=81 | AFTER the storage rebuild = slice 18 (H2): THE CONSOLE FOR THE FOUR THINGS THE OWNER ASKED
  FOR — delete a key, look inside a store (names only) and delete an entry, empty a store, delete a
  store. UI-ONLY: `GET /stores/{store}/objects` already lists entries (and takes `prefix=`), and
  `DELETE /stores/{store}/objects/{name}` already deletes one, so this slice adds the new routes from
  row 71 to the console plus the CONFIRMATIONS the owner asked for (a typed name for whole-store
  destruction, and a plain confirm for one item/key). It is SERIALIZED behind row 71 because both touch
  the console, and the browser test landed at row 69 is what verifies it: B-pins already drive
  Connect/Edit, so the new flows extend the same file rather than a new harness.
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
TRAP | t5 | A dispatcher board patch anchored on a WRITER'S IN-FLIGHT block aborted TWICE, because
  |   the writer folds that block when it lands ("(No writer in flight …)") and the anchor stops
  |   existing. Both times the script failed SAFE — it asserts before writing, so nothing was
  |   half-applied — and the missing records were noticed and added in the next commit. RULE: anchor
  |   a dispatcher board edit on a field the DISPATCHER owns (the SESSION `state=` field, the
  |   `decisions=` field, or the insert point in `## Landed`); never on a writer's IN-FLIGHT block.
TRAP | t6 | **A `pgrep`-based guard is inflated by the SHELL THAT READS IT**, and I misdiagnosed it as
  |   a defect in the guard. `scripts/board.sh`'s host line is
  |   `pgrep -af "vites[t]|jest|pytest"`, so it counts any process whose command line contains the
  |   literal text `vitest`, `jest` or `pytest` — including the `bash -c` that ran board.sh when that
  |   same command line also ran my own `pgrep … "vitest|…"`. I saw "suites: 1", then found the service
  |   with a WIDER pattern of my own (`vitest|node --experimental-strip-types`, which also
  |   self-matched my shell) and recorded "the service is being counted" as a fact — a mechanism
  |   asserted from plausibility, which cost a queue entry and would have cost a pointless patch to a
  |   guard that works. RULE: measure a process count with a probe whose OWN argv carries no pattern
  |   (this project's is `.gate-logs/suite-audit.py`, which reads `/proc/*/cmdline` and takes the
  |   service's PID from systemd), reproduce a suspected self-match by MAKING one on purpose, and
  |   never diagnose a guard from a pattern that is also literal text in the reading shell — the same
  |   family as the host rule about pattern-kills.
TRAP | t7 | **A differential arm mutates the MAIN tree — which is the LIVE UNIT'S `WorkingDirectory`.**
  |   Every dispatcher harness here (`dispatcher-arms-s1{2,3,4,5}.sh`) injects a defect into
  |   `src/`/`web/` IN PLACE, runs the suite, and restores from `HEAD` with the hash asserted back. The
  |   unit's `ExecStart` loads the MAIN checkout's `src/server/main.ts`, so for the seconds an arm is
  |   live, the file the service WOULD boot is the mutated one. `Restart=on-failure` means nothing
  |   restarts on its own, the windows are ~2-3 s, and the restore is hash-verified — so this is
  |   ACCEPTED rather than unnoticed. A successor who wants it gone can run the arms in a worktree and
  |   point the harness there (the lock is per-repo, so the arms would then not exclude a peer run —
  |   take the lock in the worktree too). Recorded because the risk is real and was never written down.
TRAP | t8 | **A GLOBAL process count on a SHARED box measures the NEIGHBOURS.** The host rule's
  |   browser audit is `ps -eo comm= | grep -c '^chrome$'`, and I quoted "0 after every run" in rows
  |   68/69 as though it were OURS. It is not attributable: during the row-71 arms that same command
  |   reported **9-11**, and every one of those processes belonged to a concurrent `vitest` run in
  |   `~/projects/Imager` (different flags, different project, no `ServerStore` path in its argv).
  |   Our own runs held **zero** — checked two ways: `ps -eo args | grep -c 'ServerStore/.*browser-scratch'`
  |   and a self-match-free `/proc` audit for `serverstore` that excludes its own pid tree. RULE: scope
  |   a process-metric to something only YOUR run can produce (its own profile/temp path or a pid you
  |   hold), and treat a bare name count as evidence about the BOX, never about your run. The earlier
  |   zeros were true measurements taken when no neighbour happened to be running; that is luck as well
  |   as measurement, and the difference matters when the metric is what backs a "nothing outlives the
  |   writer" claim.

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
retired_branch=feat/key-lifecycle
retired_branch=feat/admin-ui
retired_branch=feat/key-edit
retired_branch=feat/cors
retired_branch=feat/object-prefix
retired_branch=feat/rate-limit
retired_branch=feat/browser-test
retired_branch=feat/sqlite-core
retired_branch=feat/console-destructive
retired_branch=feat/confirm-pin
retired_branch=feat/destructive

RECOVERY | repo=/home/administrator/projects/ServerStore | branch=main
  | remote=https://github.com/ArndRosemeier/ServerStore.git (PUBLIC; origin/main carries slices 1-3
  |   plus the row-27 deployment landing once the dispatcher pushes; each LANDED row below names
  |   its own sha)
  | gate=bash scripts/gate.sh  (0 green · 1 red · 2 cheap only · 9 refused/VOID)
  | logs=.gate-logs/gate.log | board=bash scripts/board.sh | rules=AGENTS.md
  | decisions=docs/DECISION-LEDGER.md rows 1-86 (19, 23, 27, 33, 36, 39, 42, 46, 49 and 53 appended
  |   by writers, out of numeric order by design; 43 = store LIVE + bypass verified, 43b = the
  |   running-service-is-not-the-repo discovery (GUARD g5), 45 = stray master keys revoked, 47/48 =
  |   the admin UI requirement and forks, 50 = B2 verified, 51/52 = named + editable keys,
  |   54 = C1 verified with the console LIVE, 55 = C2 verified with the audit stamp LIVE,
  |   56 = CORS is the blocker for the turn-based game, 57 = CORS LANDED — the step precedes the
  |   key guard, so a preflight is answered 2xx without a key, 58 = CORS VERIFIED against the LIVE
  |   perimeter with own arms, retired, and the game unblocked, 59 = the object-lookup intake: a
  |   point read EXISTS, entries are NAMED not id'd, the gap is a FILTERED listing — fork to the
  |   owner, 60 = the owner chose (A) `prefix=` and his game's kind-first renaming was VERIFIED free
  |   against the live database; the prefix rule fixed there too (a prefix must be a valid name —
  |   the name language is prefix-closed), 61 = the prefix filter LANDED (P1-P8, three writer arms),
  |   62 = it is VERIFIED with three DISPATCHER arms (validation, authorization order, empty-vs-404),
  |   the live ordering confirmed, the worktree/branch/session retired, and the brief's own P7 error
  |   corrected — the prefix tip is what the live service now runs, 63 = closed with NO code change (my
  |   "board.sh counts the service" claim RETRACTED: the phantom was my own shell self-matching
  |   `pgrep -af`, now TRAP t6), 64 = RATE LIMITING designed (before the guard, header identity,
  |   bounded table, exemptions, exposed `Retry-After`, 600/60 s default) and dispatched as row 65,
  |   65 = the limiter LANDED (`src/server/ratelimit.ts`, wired after CORS and before the key guard,
  |   `rate_limited`/429 + `Retry-After`, `SERVERSTORE_RATE_LIMIT` default 600/60 s with `0` = off,
  |   pins R1-R8, two writer arms A=window-never-rolls->R3 and B=cap-removed->R6 with R2 green),
  |   66 = it is VERIFIED with three DISPATCHER arms (identity->R4 ALONE, exemptions->R5 ALONE, the
  |   silent-disable fallback->R7 ALONE), a BOUNDED local spawn proving the whole mechanism on a real
  |   process without touching the public endpoint, the live preflight's `retry-after` exposure, and
  |   the worktree/branch/session retired — the limiter is LIVE), 67 = the HEADLESS-BROWSER test
  |   designed (installed Chrome over the DevTools protocol, no dependency, inside the gate, a missing
  |   browser FAILS rather than silently skips, process-tree kill in a trap) and dispatched as row 68)
  | deploy=docs/DEPLOYMENT.md (install · loopback verify · the ONE ingress line · TRAP t1 restart
  |   warning · the owner's master key · the probe · rollback); unit=deploy/serverstore.service;
  |   probe=scripts/probe-live.sh
  | live=https://store.futuremagic.de — PUBLIC and reachable (Access BYPASSED for this hostname
  |   only; the key is the only perimeter). Running main@0cfba87 since 2026-09-27 22:56:34 CEST;
  |   data root /home/administrator/serverstore-data; logs `journalctl --user -u serverstore -f`;
  |   ingress rule #6 in /etc/cloudflared/config.yml (`apps.futuremagic.de` sits above it; the
  |   number read "rule #5" until ledger row 64 corrected it); restart + re-probe = GUARD g5 /
  |   docs/DEPLOYMENT.md §8
```

## Landed

```
LANDED | row=85 | sha=0410a87 (the VERIFIED CODE tip; the slice-19 landing itself is row 84 below.
  | TEST-ONLY: `tests/checkpoints/docs` only, no product byte moved, so GUARD g5 does not apply)
  | verify=THE DISPATCHER'S OWN, on the INTEGRATED tree: gate exit 0 GREEN · 18 files · 179 tests ·
  | 4.25s, browser file 3785ms — the pin rides EXISTING flows, so the gate cost is FLAT (raw log
  | `.gate-logs/dispatcher-gate-s19.log`).
  | arms=`.gate-logs/dispatcher-arms-s19.sh`, transcript `.gate-logs/dispatcher-arms-s19.out`, the gate
  | lock held across a control and BOTH arms, sha256 printed before and after, restore from HEAD in an
  | `EXIT INT TERM` trap with the hash asserted back, a control BEFORE and AFTER, `error TS` = VOID.
  | The writer's arm G (the one this slice exists for) already proves the EFFECT half: a guard that acts
  | on the FIRST click reds V1 and V3. Mine prove the other two ways the new pin could still be blind:
  |   X the confirmation affordance VANISHES the moment it is created (`web/app.js` `56bd8f70…ed2c` →
  |     `28f82ddc…70e2`) → **RED on PIN V1 with V3 and V5 as the same-seam family** — the ANTI-VACUITY
  |     half works: a console where nothing happened AND nothing was offered cannot pass as "armed".
  |   Y ONLY the entry delete bypasses the guard while the key delete keeps it (`56bd8f70…ed2c` →
  |     `5ec6ca7b…d7d5`) → **RED on PIN V3 ALONE** — the COVERAGE claim: the ONE shared helper really is
  |     applied to BOTH single-item controls, so a pin that covered only keys would have passed this arm.
  |   both controls GREEN (18 files · 179 tests), `web/app.js` back at its before-hash.
  | THE HOLE IS CLOSED: row 83 found that a single-item action running on the first click could not fail
  | anything; V1 and V3 now assert, through ONE helper (`assertArmedNotActed`), that after the FIRST
  | click NOTHING changed (read back through the API) AND the confirmation is ON SCREEN, and only the
  | CONFIRM click acts — and the arm proves the assertion fails on exactly the defect that motivated it.
  | retired=worktree worktrees/confirm-pin · branch feat/confirm-pin (was 0f361b4, verified fully merged)
  | · writer session ff795c01… — salvage-checked BEFORE deletion (tracked-clean worktree, tip ==
  | origin/main). Host after: only `main` in `git worktree list`, lock free, probe PASS exit 0.
  | docs=ledger row 85 · this board.

LANDED | row=84 | sha=0410a87 (the WRITER'S TEST-ONLY tip: `tests/browser.test.ts` and
  | `checkpoints/confirm-pin-differential.sh`; the docs commit carrying THIS line, ledger row 84,
  | `docs/TESTING.md` and the transcript `checkpoints/confirm-pin-differential.out` is its child)
  | verify=THE WRITER'S OWN, in-turn, on the committed tree: base origin/main = 87b6d38 (resolved);
  | `bash scripts/gate.sh` → exit 0 GREEN · 18 files · 179 tests · 4.13s, with
  | `tests/browser.test.ts (15 tests)` at 3664ms against the measured baseline 3686ms (raw logs: the
  | worktree's `.gate-logs/writer-gate-s19-before.log` and the gate's own `.gate-logs/gate.log`). The
  | suite's cost is FLAT: no new page, no new service, no new mint — the fixture's existing throwaway
  | key and seeded entries are reused.
  | scope=TEST-ONLY, and it exists because the DISPATCHER'S OWN arm W at row 83 ran a one-item destroy
  | WITHOUT its confirmation and went GREEN everywhere. V1/V3 now assert the INTERMEDIATE state through
  | ONE shared helper `assertArmedNotActed`: after the FIRST click the key is still in `GET /keys` and
  | its credential still authenticates (the entry still listed by `GET …/objects` and still readable)
  | AND the Confirm affordance is ON SCREEN; only the CONFIRM click may act, and every existing
  | end-state assertion is intact. A race-free backstop counts the flow's DELETE requests
  | (`requestUrls`/`requestCount`; V2's resource-timing read folded into the same seam). NO product
  | byte changed (`git diff --name-only 87b6d38..HEAD` → `tests/`, `checkpoints/`, docs only).
  | arms=`checkpoints/confirm-pin-differential.sh`, transcript `checkpoints/confirm-pin-differential.out`,
  | per-arm logs `.diff-harness-confirm-pin/` (*.log, gitignored), the gate lock held across the control
  | and the ONE arm, `web/app.js`'s sha256 printed before and after, restore from HEAD in an
  | `EXIT INT TERM` trap with the hash asserted back, `error TS` = VOID, OUR chrome count 0 after every
  | run (scoped to our own profile; the brief's literal command self-matches its own grep — TRAP t8,
  | measured and printed):
  |   G `armGuard` runs `options.onConfirm()` on the FIRST click (the guard bypassed, so one unguarded
  |     click destroys; `56bd8f70…ed2c` → `f36bd822…b7b1`) → **RED on PIN V1 and PIN V3** — V1 "the
  |     FIRST click on Delete already removed the key from GET /keys", V3 "the FIRST click on Delete
  |     already removed the entry from the store's listing", BOTH thrown from `assertArmedNotActed` —
  |     with V2, V4, V5, V6, V7, B1–B3, B6 and U1–U4 GREEN (the typed-name whole-store flows and the
  |     static scans do not touch the one-item guard). V5 is DECLARED COLLATERAL (it deletes its
  |     blocking key through the SAME guard): green in this run, measured and printed rather than
  |     asserted, because that timing is not the rule under test.
  |   NEGATIVE CONTROL: BOTH runs of the unmodified committed tree GREEN (18 files · 179 tests, browser
  |     file 3654ms then 3724ms), so the new assertion is not merely always-red; `web/app.js` restored
  |     byte-identical (`56bd8f70…ed2c`).
  | docs=ledger row 84 · `docs/TESTING.md` (the V1/V3 rows, the intermediate-state note and the new
  | differential section) · this board.
  | COPIES: 3→1 — the intermediate-state rule is ONE helper (`assertArmedNotActed`) used by BOTH
  | single-item controls; the page's resource timing is read in ONE place (`requestUrls`, now shared by
  | V2 and `requestCount`) and cleared in ONE place (`clearRequests`).
  | unproven=the `requestCount` backstop (2 vs 1) was not exercised — both pins failed on the API
  | read-back half because the arm's DELETE landed before it; a scripted click is not a layout claim;
  | one browser engine; the live host was never touched. THE DISPATCHER'S OWN VERIFICATION IS OWED.

LANDED | row=83 | sha=5bf080a (the VERIFIED CODE tip; the slice-18 landing itself is row 82 below)
  | verify=THE DISPATCHER'S OWN, on the INTEGRATED tree: gate exit 0 GREEN · 18 files · 179 tests ·
  | 4.10s, with `tests/browser.test.ts (15 tests)` at 3656ms — the console flows add ~2.0s to every
  | gate run, stated rather than discovered later (raw log `.gate-logs/dispatcher-gate-s18.log`).
  | arms=`.gate-logs/dispatcher-arms-s18.sh`, transcript `.gate-logs/dispatcher-arms-s18.out`, the gate
  | lock held across a control and ALL THREE arms, sha256 printed before and after, restore from HEAD in
  | an `EXIT INT TERM` trap with the hash asserted back, a control BEFORE and AFTER, `error TS` = VOID,
  | a VOID arm RECORDED while the run continues, OUR chrome count 0 after every run (scoped to our own
  | profile — TRAP t8). Arms, none of them the writer's (he armed A the whole-store token PRE-FILLED
  | from the store name → V4 alone, B the entry filter CLIENT-SIDE → V2 with V7 as its declared twin):
  |   U a FAILED destructive action reported as a SUCCESS (`web/app.js` `56bd8f70…ed2c` → `b5c8a6ec…f34a`)
  |     → **RED on PIN V5 with V6 and V7 as the failure-reporting family**: the store survives but the
  |     owner is told nothing — the worst of both worlds, and every pin that asserts an error is shown
  |     falls with the same mechanism.
  |   V the affected pane NOT refreshed after a destructive action (`56bd8f70…ed2c` → `6de37209…d744`) →
  |     **RED on PIN V1 with V3 and V5** — my FIRST aim was V6 and that was WRONG: the stale-row rule
  |     lives in the pins that assert the pane after acting, not in V6. My error, corrected by re-running
  |     the arm against the pin it actually reds rather than by bending the pin.
  |   W the single-item destructive action run WITHOUT its confirmation (`56bd8f70…ed2c` →
  |     `88ed8452…b683`) → **GREEN EVERYWHERE. This is a FINDING, not a pass: the two-step confirmation
  |     for deleting ONE key or ONE entry cannot fail any pin**, because V1/V3 assert the END STATE (the
  |     key is gone; the credential 401s) and never that the FIRST click destroys nothing. The console's
  |     guard is real and works; it is simply unfalsifiable, which is the trap row 39 deleted an
  |     unreachable subset check for. Recorded here and closed by the next slice (row 84).
  |   both controls GREEN (18 files · 179 tests), every file back at its before-hash.
  | LIVE, and a sharpened TRAP: the console's assets are read from DISK PER REQUEST, so a landed `web/`
  | change is live with NO restart — verified, not assumed: the served `/app.js` sha256 is HEAD's
  | (`56bd8f70…`) and contains the new seams (`armTypedConfirm`, `refreshEntries`, `withQuery`,
  | `confirm_mismatch`), and `scripts/probe-live.sh https://store.futuremagic.de` → **PASS exit 0**.
  | **This also REFINES TRAP t7:** the arms mutate the MAIN tree, and for `web/` that mutation is
  | visible to any browser loading the console during the arm window (seconds) — `src/` only matters on
  | a restart, `web/` matters immediately. Same mitigation (short windows, hash-verified restores), and
  | a stronger reason to run arms in a worktree.
  | retired=worktree worktrees/console-destructive · branch feat/console-destructive (was 81e901a,
  | verified fully merged) · writer session 5495d145… — salvage-checked BEFORE deletion (tracked-clean
  | worktree, tip == origin/main). Host after: only `main` in `git worktree list`, lock free.
  | docs=ledger row 83 · this board.

LANDED | row=82 | sha=5bf080a (the WRITER'S VERIFIED CODE tip — `web/index.html`, `web/app.js`,
  | `web/app.css`, `tests/browser.test.ts`, `tests/helpers/browser.ts` and
  | `tests/admin-ui.test.ts`; the docs commit carrying THIS line, ledger row 82,
  | `docs/SEAM-INDEX.md`, `docs/TESTING.md` and the `docs/API.md` correction is its child — a
  | commit cannot name its own sha. The pre-push rebase may replay it; an empty content delta on
  | the code is what makes the replayed sha the same landing.)
  | base=origin/main `e6bc547`, resolved by the writer and carrying the row-81 design and this
  | slice's brief.
  | verify=THE WRITER'S OWN, in-turn, on the committed tree: `bash scripts/gate.sh` → exit 0
  | GREEN · 18 files · 179 tests · 4.29s (raw log `.gate-logs/writer-gate-s18.log`; the gate's own
  | copy is `/home/administrator/projects/ServerStore/.gate-logs/gate.log`), with
  | `tests/browser.test.ts (15 tests) 3849ms` — the eight slice-15 pins plus the seven new V pins,
  | so the console flows add ~2.0 s to every gate run. THE DISPATCHER'S INDEPENDENT VERIFICATION IS
  | OWED — this record claims the writer's gate and the writer's arms only.
  | arms=`checkpoints/console-destructive-differential.sh`, transcript
  | `checkpoints/console-destructive-differential.out`, the gate lock held across the CONTROL and
  | BOTH arms, `web/app.js`'s sha256 printed before and after, restore from `HEAD` in an
  | `EXIT INT TERM` trap with the hash asserted back, `error TS` = VOID, a control BEFORE and AFTER:
  |   A the whole-store token is PRE-FILLED from the store name (`56bd8f70…ed2c` → `ae32e9ac…046a`)
  |     → RED on PIN V4: the client's `confirm_mismatch` never appears, so a WRONG typed name would
  |     have destroyed the store. V1/V2/V3/V5/V6/V7 and U1–U4 stayed GREEN.
  |   B the entry list is filtered CLIENT-SIDE (fetch the whole store, narrow in the browser;
  |     `56bd8f70…ed2c` → `8c1e0128…c795`) → RED on PIN V2: the requests seen are exactly
  |     `["…/stores","…/stores/game/objects","…/stores/game/objects"]`, NONE carrying `prefix=`,
  |     while the RENDERED list stayed exactly correct — which is the whole reason V2 observes the
  |     request and not the DOM.
  |   DECLARED TWIN (named, and ASSERTED red by the harness): PIN V7 on arm B — its 400 half drives
  |   an ILLEGAL prefix, so it rides the same `prefix=` query, and no mutation of `refreshEntries`
  |   can redden V2 alone.
  |   both controls GREEN (18 files · 179 tests); `web/app.js` restored byte-identical to its
  |   before-hash; no VOID probe.
  | COPIES=`COPIES: 3→1` — the confirmation rule is ONE seam per weight (`armGuard()` for one item,
  | `armTypedConfirm()` for a whole store), the outcome rule is the ONE `finishDestructive()`, and
  | the query string is built by the ONE `withQuery()`. `COPIES: 1` — verified by grep: the
  | on-demand entry fetch (`refreshEntries()`) and each `ROUTES` path exist once.
  | A HARNESS DEFECT FOUND AND FIXED, and it is why the file is fast: after `Target.createTarget`
  | opens another page the console's target is BACKGROUNDED, and Chrome DEFERS trusted input to a
  | hidden page — measured as 5001 ms on every `Input.dispatchMouseEvent`, which made the file take
  | 143 s. `BrowserPage.bringToFront()` is now called by `clickElement()`; the file runs in ~3.6 s.
  | JUDGEMENT CALLS (all in ledger row 82): the U3 shape check normalises a route's parameter NAME
  | on both sides (`routeShape()`), Revoke now uses the same inline two-step instead of
  | `window.confirm()`, the typed-name button stays enabled and refuses a mismatch with
  | `confirm_mismatch`, the `409` is displayed and nothing is parsed out of it, `forgetKey()` clears
  | the open store, and V7's 429 is a real second service (`SERVERSTORE_RATE_LIMIT=1`).
  | HOST: chrome processes scoped to this worktree's profile (`ServerStor[e]/.*browser-scratch`)
  | counted after EVERY run → 0. The brief's LITERAL count command is SELF-MATCHING (it reported 1
  | on an idle box because its pattern is in the running `grep`'s argv); the harness prints both.
  | NOT touched: the live service, `/home/administrator/serverstore-data`, and every `src/` file — no
  | restart, no request, no key (GUARD g5 is the dispatcher's, and this landing changes no product
  | code).

LANDED | row=71 | sha=f066f65 (the WRITER'S VERIFIED CODE tip — `src/core/errors.ts`,
  | `src/core/keys.ts`, `src/server/app.ts`, `src/storage/fs.ts`, `src/storage/kinds.ts`,
  | `src/stores/registry.ts`, `tests/destructive.test.ts`, `tests/objects.test.ts`,
  | `checkpoints/destructive-differential.sh` and `docs/API.md`; the docs commit carrying THIS
  | line, ledger row 71, `docs/SEAM-INDEX.md`, `docs/TESTING.md` and the `docs/STORAGE.md`
  | correction is its child — a commit cannot name its own sha. The pre-push rebase replayed the
  | pre-rebase tip `55f1bbf` onto the dispatcher's `d906bbd` (which carries `d9b2016`'s
  | `docs/STORAGE.md`) as this sha, with an EMPTY content delta on the code:
  | `git diff --stat 55f1bbf f066f65 -- src tests docs/API.md checkpoints` is empty)
  | verify=THE WRITER'S OWN, in-turn, on the committed tree: `bash scripts/gate.sh` → exit 0
  | GREEN · 16 files · 159 tests · 2.45s (raw log `.gate-logs/gate.log`, a copy kept at
  | `worktrees/destructive/.gate-logs/gate.log`). THE DISPATCHER'S INDEPENDENT VERIFICATION IS
  | OWED — this record claims the writer's gate and the writer's arms only.
  | arms=`checkpoints/destructive-differential.sh`, transcript
  | `checkpoints/destructive-differential.out`, the gate lock held across the CONTROL and BOTH
  | arms, sha256 printed before and after, restore from `HEAD` in an `EXIT INT TERM` trap with
  | each hash asserted back, `error TS` = VOID, a control BEFORE and AFTER:
  |   A the store-delete key-scope refusal neutralised (`src/server/app.ts` `62247607…c2bf` →
  |     `2f7afd9c…c162`) → RED on PIN X5 — `expected 500 to be 409`, `FOREIGN KEY constraint
  |     failed`: the schema's error surfaced as a 500 because the route's NAMED refusal was
  |     gone. X4 (empty), X6 (confirm) and X8 (error surface) stayed GREEN, so the refusal and
  |     the token are different mechanisms.
  |   B the shared-content check removed from the single-object delete (`src/storage/kinds.ts`
  |     `b49f2013…bbca` → `f4152115…c307`, always delete the blob) → RED on PIN X7 — the
  |     survivor's read answered `{"error":{"code":"internal","message":"ENOENT…"}}` instead of
  |     its bytes — while the ORDINARY delete stayed GREEN (`tests/objects.test.ts` 23/23) with
  |     X5, X6 and X8 GREEN. That two-sided result is the whole reason X7 exists.
  |   both controls GREEN (16 files · 159 tests); both mutated files back at their before-hashes;
  |   no VOID probe; no arm reddened a pin it did not name, so there is no declared twin.
  | COPIES=`COPIES: 2→1` — the expiry comparison is now the ONE `isExpired()` (`resolveKey` had
  | its own `Date.parse` + NaN branch), the confirm rule is the ONE `requireConfirm()` for both
  | bulk routes, and "is this still an admin" is the ONE `isLiveAdminKey()` used by the route and
  | `countLiveAdminKeys()`. Also `COPIES: 1` — the blocking-key query (`keysHoldingStore`) and
  | the blob-vs-row decision (`StoreKindHandler.remove`) each exist once (grepped `src/`).
  | THE BRIEF'S OWN GAP, reported rather than worked around: the brief's doc list (ledger row 71,
  | SEAM-INDEX, TESTING, BOARD, API) predates the dispatcher's `d9b2016`, which added
  | `docs/STORAGE.md` AND pointed `AGENTS.md` at it. STORAGE.md already stated this slice's
  | post-state in the future tense ("what the destructive-lifecycle slice adds"), so that one
  | sentence is corrected in this landing's docs child — a doc this landing makes true must not
  | be left saying it is still owed.
  | NOT restarted and NOT touched: no change to `revoke`'s behaviour, no schema change, no
  | console/UI change (row 72), and the live unit was never contacted (GUARD g5 is the
  | dispatcher's; this landing changes `src/`).
  | retired=NOT yet: worktree `worktrees/destructive`, branch `feat/destructive`, writer session
  | this one — retiring it is the dispatcher's, after its own verification.
  | docs=ledger row 71 · this board · `docs/API.md` · `docs/SEAM-INDEX.md` · `docs/TESTING.md` ·
  | `docs/STORAGE.md`.

LANDED | row=69 | sha=c13219a (the VERIFIED CODE tip — the headless-browser test; TEST-ONLY, so the
  | slice-15 landing itself is row 68 below and the live unit is byte-for-byte unaffected)
  | verify=THE DISPATCHER'S OWN, on the INTEGRATED tree: gate exit 0 GREEN · 15 files · 150 tests ·
  | 2.26s, with `tests/browser.test.ts (8 tests)` at **1632ms** — that is the browser test's price on
  | every gate run, stated rather than discovered later (raw log `.gate-logs/dispatcher-gate-s15.log`).
  | arms=`.gate-logs/dispatcher-arms-s15.sh`, transcript `.gate-logs/dispatcher-arms-s15.out`, the gate
  | lock held across a control and ALL THREE arms, sha256 printed before and after each mutation,
  | restore from HEAD in an `EXIT INT TERM` trap with the hash asserted back, a control BEFORE and
  | AFTER, `error TS` = VOID, and the CHROME COUNT after every single run. Arms, none of them the
  | writer's (the writer armed A the console's Edit affordance removed → B3 on the seam's own 5 s
  | deadline, B the exposed header set dropped → B5 with PIN O2 as the named in-process twin):
  |   J the console PERSISTS the key (`localStorage` beside the ONE assignment, `web/app.js`
  |     `ea2462f5…db0f` → `3c885a5e…fabe`) → **RED on PIN B2 AND PIN U2**. Those two are the honest
  |     twins of ONE promise — C1's "the key lives in memory only" — measured statically (U2) and now in
  |     the browser it is about (B2), which is exactly the redundancy the browser test was owed.
  |   L the CORS step answers a preflight **500** instead of 204 (`src/server/app.ts` `e62df5e8…12a7` →
  |     `e02b4447…1c87`) → **RED on PIN B4**, with B5, B6, D7, O1, O3 and R5 as EXPECTED COLLATERAL:
  |     every assertion about a browser-visible preflight must fall when preflights break, and the
  |     in-process twins (O1/O3), the spawned-entrypoint pin (D7) and the exemption pin (R5, whose
  |     disallowed-origin half expects the guard's 401) all stand on that one mechanism. The NAMED pin
  |     fell, so the arm is attributable; an arm that breaks a shared mechanism SHOULD light up its
  |     family, and each falling pin above is accounted for rather than waved at.
  |   N the allowlist ECHOES ANY ORIGIN (`: deps.corsOrigins.includes(origin)` → `: true`,
  |     `e62df5e8…12a7` → `afa36df0…68a0`) → **RED on PIN B6** with D7, O3 and R5 as the same kind of
  |     honest collateral: the browser stops BLOCKING a disallowed origin, which is the half of CORS
  |     that only a browser can show, and the in-process allowlist pins fall with it.
  |   both controls GREEN (15 files · 150 tests); every mutated file back at its before-hash; **chrome
  |   processes after EVERY run: 0 — including the three failing arms**, the strongest evidence in this
  |   landing that the process-tree kill is on the FAILURE path and not only the happy one; and a
  |   self-match-free audit afterwards (`.gate-logs/path-audit.py`, which excludes its own pid tree)
  |   found 0 processes referencing the retired worktree.
  | THE HARNESS'S OWN FIRST RUN WAS VOID AND IS RECORDED: arm L's first anchor (`if (false && …)`) broke
  | the TYPECHECK (`TS2322`, a lost narrowing) so it was correctly refused as VOID, arm N's anchor had
  | two spaces too many so the mutation did not apply, and that path called `fail()` and ABORTED the run.
  | Both fixed: L now injects a real regression the browser SEES (a 500 preflight), N's indent matches,
  | and an arm that does not apply is RECORDED with the run continuing instead of killing the transcript.
  | My own errors, in the machinery that exists to catch exactly this.
  | THE BRIEF'S OWN FLAW, reported by the writer and RATIFIED here: my rule "an arm that reddens a pin it
  | did not name is VOID" is UNSATISFIABLE for the arm the same brief demanded — `tests/cors.test.ts`
  | PIN O2 asserts the SAME `Access-Control-Expose-Headers` contract in process, so NO mutation of
  | `app.ts` can redden B5 alone. The honest form, now used: an arm must redden its NAMED pin, and every
  | OTHER pin that falls must be attributable to the same mechanism and named. That is the third
  | dispatcher-specified pin rule that was wrong in three slices (row 62's P7, then this), and the pattern
  | is now clear enough to state: **a pin that shares a contract with an older pin needs its overlap
  | DECLARED in the brief, not discovered by an arm.**
  | COPIES claim VERIFIED BY ME: **`COPIES: 2→1`** — `tests/helpers/entrypoint.ts` is the ONE
  | process-level test seam (free port + entrypoint spawn + boot poll + reap), shared by the D pins and
  | the B pins, and `tests/helpers/browser.ts` is the ONE place a browser is launched, driven and its
  | process TREE killed (`CHROME_PATH` defined once; `detached: true` + `process.kill(-pid, …)` in one
  | place) — grepped `src/server/main.ts`, `google-chrome`, `puppeteer`, `playwright`, `process.kill(-`
  | across `tests/`, `src/`, `scripts/`. Also verified: NO `skip`/`todo`/`skipIf` anywhere in the browser
  | file or its helper (PIN B8 asserts the missing-browser failure instead, and only pin NAMES mention
  | skipping); `.browser-scratch/` is gitignored (`/.browser-scratch/`) and held only **4.0 KB after six
  | runs**, i.e. the profile is cleaned per run rather than accumulating; and the spawned test service is
  | given `SERVERSTORE_RATE_LIMIT=0` (the trap the brief named) so no browser pin can fail for a limiter
  | reason.
  | GUARD g5 DOES NOT APPLY: `git diff --name-only 18f8fe5..c13219a` touches `tests/`, `checkpoints/`,
  | `.gitignore` and docs only — no `src/`, `web/`, `deploy/`, `package.json`, `pnpm-lock.yaml` or
  | `scripts/` file — so the live unit was NOT restarted and still holds MainPID 131596, active
  | throughout (verified before and after the arms).
  | retired=worktree worktrees/browser-test · branch feat/browser-test (was 9ffc871, verified fully
  | merged with `git branch --merged main`) · writer session 7d6c556a… — salvage-checked BEFORE deletion
  | (tracked-clean worktree, tip == origin/main). Host after: only `main` in `git worktree list`, no
  | `feat/browser-test` in `git branch -a`, lock free, 0 chrome processes, 0 processes referencing the
  | worktree.
  | docs=ledger row 69 · this board.

LANDED | row=68 | sha=c13219a (the TEST-ONLY CODE tip: `tests/helpers/browser.ts`,
  | `tests/browser.test.ts`, `tests/helpers/entrypoint.ts`, the `tests/entrypoint.test.ts`
  | refactor onto it, and the `.gitignore` scratch line. The docs record commit carrying the
  | LANDED row you are reading is that commit's CHILD, so this sha is the code tip and not
  | itself.)
  | base=18f8fe5 — the tip of `origin/main` that carried the brief, RESOLVED by the writer
  | (`git rev-parse --short origin/main`) rather than trusted from memory; the pre-push
  | `git pull --rebase origin main` was a no-op, so the code tip was never rewritten.
  | scope=TEST-ONLY, no product code changed. ONE browser seam: `/usr/bin/google-chrome
  | --headless=new`, a temp `--user-data-dir` UNDER THE WORKTREE, `--remote-debugging-port=0`
  | with the port read back from `DevToolsActivePort`, CDP over Node's BUILT-IN global
  | `WebSocket` (no npm dependency), TRUSTED `Input.*` for every click and keystroke, and a
  | PROCESS-GROUP kill from the helper's own `afterAll`, a failure path and a
  | `process.once("exit")` net. Pins B1–B8: the console's JS RUNS with no page error; a typed
  | master key AUTHENTICATES through the UI and is in no URL/storage/cookie/field; the EDIT
  | flow really PATCHes (asserted through the API, not the DOM); a real browser on ANOTHER
  | ORIGIN completes an authorized fetch; it can READ the exposed `x-serverstore-sha256`; a
  | DISALLOWED origin is blocked BY THE BROWSER; nothing outlives the test; and a missing
  | browser FAILS loudly. The spawned service gets `SERVERSTORE_RATE_LIMIT=0` (the limiter is
  | in the request path) and `SERVERSTORE_CORS_ORIGINS=<the allowed mini-origin>`; two stdlib
  | HTTP servers on their own loopback ports are the allowed and the disallowed origin.
  | verify=THE WRITER'S OWN, run IN-TURN and FOREGROUND: `bash scripts/gate.sh` -> **exit 0
  | GREEN · 15 files · 150 tests · 2.18s**, with `tests/browser.test.ts (8 tests) 1665ms` —
  | so the new browser file costs the gate about 1.7s (raw log `.gate-logs/writer-gate-s15.log`).
  | arms=`checkpoints/browser-differential.sh`, transcript `checkpoints/browser-differential.out`,
  | the gate lock held across a control and BOTH arms, each mutated file's sha256 printed
  | before and after, restore from HEAD in an `EXIT INT TERM` trap with the hash asserted
  | back, a control BEFORE and AFTER, `error TS` = VOID, and the chrome count asserted `0`
  | after EVERY run:
  |   ARM A the console's EDIT AFFORDANCE removed (`web/app.js` `ea2462f5…db0f` →
  |     `bbd6f863…0efc`) -> **RED on PIN B3 ALONE**, and on the SEAM's own deadline:
  |     `BrowserError: timed out after 5000ms waiting for the per-row editor to replace the
  |     row; last: the expression is falsy (false)`. B1/B2, B4–B8 and U1–U4 stayed GREEN — the
  |     console still RUNS and still AUTHENTICATES, so the arm isolates the EDIT FLOW.
  |   ARM B the REAL response stops exposing the header set (the `access-control-expose-headers`
  |     line that runs after `next()`; the preflight's own copy is untouched)
  |     (`src/server/app.ts` `e62df5e8…12a7` → `649ef876…5542`) -> **RED on PIN B5**
  |     (`expected null to be '60ba8907…'`), with B1–B4, B6–B8, U1–U4, O1 and R5 GREEN.
  |     **EXPECTED COLLATERAL, NAMED: PIN O2 (both halves) also goes RED**, because O2 is the
  |     IN-PROCESS twin of exactly the contract B5 proves in a browser — no mutation of
  |     `src/server/app.ts` can redden B5 alone. The harness ASSERTS O2 is red, so it is
  |     observed rather than hoped for; the same overlap class was recorded in row 54 for U1/U4.
  |   both controls GREEN (15 files · 150 tests), both files restored byte-identical, 0 chrome
  |   processes after every run, no VOID arm.
  | BRIEF FLAW, reported rather than worked around: the brief's global rule "an arm that
  | reddens a pin it did not name, or that breaks the typecheck, is VOID" is UNSATISFIABLE for
  | the brief's own arm (b) — dropping `x-serverstore-sha256` (or `authorization`) reddens the
  | in-process pin that asserts the SAME contract, by design (row 64f). The arm was run as
  | written, its collateral named in the harness and here.
  | judgement calls (all reported, none silent): (a) the API-process seam (free port, the
  | entrypoint spawn, the boot poll, the reap) was EXTRACTED to `tests/helpers/entrypoint.ts`
  | so the D pins and the B pins share ONE copy — a second spawn site would have been the
  | duplication AGENTS.md rule 4 forbids; (b) B1 PROVES the module ran by clicking "Use key"
  | with an EMPTY field and asserting the console's own `no_key` validation, because the
  | connect form is in the HTML and its presence proves nothing about the script; (c)
  | `favicon.ico` is excluded from B1's error scan — Chrome asks for it, the guard answers
  | 401, and a missing favicon is not a broken console; every other network error and every
  | page exception is fatal; (d) `BrowserPage.clickElement` is the escape hatch for a target
  | CSS cannot name (a key `<li>` whose label is a text node): the LOOKUP is scripted, the
  | CLICK is still `Input.dispatchMouseEvent`; (e) each pin carries a 30s vitest timeout so the
  | SEAM's 5s deadline is what fails, with its last observation, instead of vitest's default;
  | (f) B6 additionally asserts the API's own preflight for the disallowed origin is the
  | guard's `401` with no allow-origin header — the corroboration that the real request was
  | never sent — and that the ALLOWED origin's preflight is `204`, so it is an allowlist and
  | not a service that refuses every browser; (g) `.browser-scratch/` is gitignored as the
  | preventive half of "scratch lives under the worktree, never `/tmp`".
  | COPIES: 2->1 — `tests/helpers/entrypoint.ts` is now the ONE process-level test seam
  | (freePort + the `src/server/main.ts` spawn + the boot poll + the reap), read by BOTH
  | `tests/entrypoint.test.ts` and `tests/browser.test.ts`. `tests/helpers/browser.ts` is the
  | ONE place a browser is launched, driven and its process TREE killed (grepped: `google-chrome`,
  | `puppeteer`, `playwright`, `detached`, `process.kill(-` across `tests/`, `src/` and `scripts/`).
  | docs=the SAME landing: `docs/DECISION-LEDGER.md` row 68, `docs/SEAM-INDEX.md` (the browser
  | seam row, the process-seam row, gotcha 18 and the re-scoped known-debt bullet),
  | `docs/TESTING.md` (B1–B8, both arms with hashes, the cost of the file in the gate, the
  | honest unknowns), `docs/BOARD.md` (this record).
  | unproven (the writer's honest unknowns, in `docs/TESTING.md`): ONE browser engine only;
  | a scripted UI flow is NOT a claim about visual layout; only load/authenticate/edit of the
  | console are executed; a `SIGKILL` of the vitest worker itself would still leave the group
  | (no in-process cleanup can prevent that — hence the shell-side chrome count); the 429's
  | `Retry-After` is still not read by a page; and the live host was never loaded, by rule.
  | retire=NOT the writer's: worktree `worktrees/browser-test`, branch `feat/browser-test` and
  | the writer session are the DISPATCHER's to retire after its own verification.

LANDED | row=66 | sha=66a3295 (the VERIFIED CODE tip on the FINAL REBASED tree; the slice-14 landing
  | itself is row 65 below. Pulled to the remote tip and re-probed BEFORE my own gate and arms, per
  | GUARD g5)
  | verify=THE DISPATCHER'S OWN, on the INTEGRATED tree: gate exit 0 GREEN · 14 files · 142 tests ·
  | 2.26s (raw log `.gate-logs/dispatcher-gate-s14.log`), matching the writer's count.
  | arms=`.gate-logs/dispatcher-arms-s14.sh`, transcript `.gate-logs/dispatcher-arms-s14.out`, the gate
  | lock held across a control and ALL THREE arms, sha256 printed before and after each mutation,
  | restore from HEAD in an EXIT/INT/TERM trap with the hash asserted back, a control BEFORE and AFTER,
  | and `error TS` = VOID. Arms, none of them the writer's (the writer armed A the window never rolls →
  | R3 alone, B the cap removed → both R6 tests with R2 green):
  |   G the IDENTITY collapses to one shared bucket (`src/server/ratelimit.ts` `810abb51…c2753` →
  |     `8d17a471…5184`) → **RED on PIN R4 ALONE**: the "one bucket for everyone" failure, which would
  |     throttle the whole world together while every single-identity pin still passes.
  |   H the EXEMPTION list stops exempting (`src/server/app.ts` `e62df5e8…12a7` → `7797afd5…f222`) →
  |     **RED on PIN R5 ALONE**: `/healthz`, the console and preflights would be limited, i.e. the
  |     probe, the operator's UI and every browser would break under exactly the load the limiter
  |     exists for.
  |   I a malformed/EMPTY `SERVERSTORE_RATE_LIMIT` silently becomes 0 — disabled — at the call site
  |     (`src/server/config.ts` `460741d3…b2be` → `05833528…e5b0`) → **RED on PIN R7 ALONE**: `Number("")`
  |     is 0, so this is the fallback that turns a typo into "unlimited".
  |   both controls GREEN (14 files · 142 tests), every file back at its before-hash, no VOID arm in the
  |   final run. **THE HARNESS'S OWN FIRST RUN WAS VOID AND IS RECORDED:** arm G's first mutation gave
  |   `connectingIp` the narrowed type `"local" | undefined`, so the existing `!== ""` guard became
  |   `TS2367` (a comparison with no overlap); the harness REFUSED it as VOID rather than crediting it
  |   to R4 — and it also ABORTED the run, costing arms H and I. The mutation now annotates the type,
  |   and the harness RECORDS a VOID/unattributable arm and CONTINUES, exiting non-zero at the end: one
  |   bad arm must not cost the others' evidence. (My own error, caught by exactly the mechanism that
  |   exists for it.)
  | live-mechanism check=`.gate-logs/ratelimit-live-check.sh` + `.gate-logs/ratelimit-preflight-check.sh`
  | and their `.out` transcripts, run against a **LOCAL SPAWN of the repo's own entrypoint** on free
  | loopback ports with a scratch data root — the PUBLIC endpoint was never hammered (the host rule
  | forbids synthetic load) and the live unit keeps the 600 default. With `SERVERSTORE_RATE_LIMIT=2`:
  | two requests 401 then **429** carrying `retry-after: 60` and `access-control-expose-headers:
  | x-serverstore-sha256, retry-after`, body `{"error":{"code":"rate_limited",…}}`; a SECOND
  | `CF-Connecting-IP` is independent (401); the FIRST `X-Forwarded-For` hop is the identity (three
  | calls with different second hops → 401, 401, 429); `/healthz`, `/`, `/app.js`, `/app.css` all exempt
  | and the allowed-origin preflight 204 while that identity is over its limit; `SERVERSTORE_RATE_LIMIT=0`
  | → five requests, no 429; an EMPTY value fails the boot loudly. **A second spawn under an explicit
  | allowlist settled the case my own script had stated wrongly:** with the policy `*` (unset) a
  | preflight from `https://evil.example.com` is CORRECTLY 204 — my parenthetical said 401 and was
  | wrong, because a wildcard policy has no disallowed origin; with
  | `SERVERSTORE_CORS_ORIGINS=https://game.example.com` the disallowed origin's preflight is **401**
  | (the guard's own refusal, never a 429) while the listed origin is 204 and the same identity is still
  | 429 on the API. Both children were killed; the audit after shows no orphan (only the live unit's
  | pid) and 0 chrome processes.
  | GUARD g5=the live unit was restarted onto the limiter tip at **09:51:16 CEST** (MainPID 131596) with
  | NO `SERVERSTORE_RATE_LIMIT` in its environment (so the 600 default applies), `scripts/probe-live.sh
  | https://store.futuremagic.de` → **PASS exit 0**, and the bounded live checks agree: unauthenticated
  | API 401, `/healthz` 200, console `/` 200, allowed-origin preflight **204** with
  | `access-control-expose-headers: x-serverstore-sha256, retry-after` — the limiter and its CORS
  | integration are live. **The live 429 was NOT triggered and must not be**: at 600 per minute that
  | would be synthetic load, so the threshold is proved deterministically in process and on the local
  | spawn instead, and this is stated rather than glossed.
  | retired=worktree worktrees/rate-limit · branch feat/rate-limit (was fb7945a, verified fully merged
  | with `git branch --merged main`) · writer session c5def7df… — salvage-checked BEFORE deletion
  | (tracked-clean worktree, tip == origin/main, only untracked scratch its own `.diff-harness` under
  | its own worktree). Host after: `git worktree list` shows only `main`, no `feat/rate-limit` in
  | `git branch -a`, lock free, 0 chrome processes.
  | docs=ledger row 66 · this board.

LANDED | row=65 | sha=66a3295 (the writer's CODE tip on the FINAL REBASED tree: `src/server/ratelimit.ts`,
  | `src/server/app.ts`, `src/server/config.ts`, `src/server/main.ts`, `src/core/errors.ts`,
  | `tests/ratelimit.test.ts`, `tests/helpers/server.ts`, `tests/cors.test.ts` and `docs/API.md` — the
  | doc rides in the CODE commit because pin R8 reads it; the docs commit carrying THIS line, ledger
  | row 65, `docs/SEAM-INDEX.md`, `docs/TESTING.md`, `docs/DEPLOYMENT.md` and
  | `checkpoints/ratelimit-differential.{sh,out}` is its child — a commit cannot name its own sha. The
  | code was committed as `a40ca91`, rebased onto the dispatcher's row-64 correction (`ca3fdf4`) as
  | `6f55c32`, and rebased again onto the row-66 board commit (`1fd87c9`) as `66a3295`; every replay
  | has an EMPTY content delta on the code (`git diff --stat a40ca91 66a3295 -- src tests docs/API.md`
  | is empty), so the differential transcript's CONTROL line naming `a40ca91` describes exactly the
  | code that lands)
  | RATE LIMITING: THE PUBLIC ENDPOINT IS NOW BOUNDED, AND THE BOUND IS IN FRONT OF THE KEY GUARD.
  | Writer session `session-c5def7df-e6b5-4966-b412-de19422b4775` (a subagent of dispatcher session
  | dcd6176e-b4b9-4759-b64d-4c90d3495dfa), worktree `worktrees/rate-limit`, branch `feat/rate-limit`,
  | base origin/main **04e9dc0** (resolved with `git rev-parse --short origin/main`), REBASED onto
  | origin/main `ca3fdf4` before the docs commit. The dispatcher's `IN-FLIGHT | row=65` block is
  | FOLDED by this record (a mechanical union; docs/BOARD.md is the only file the fold touched).
  |   what it is=ONE module, `src/server/ratelimit.ts`: a per-IDENTITY FIXED window over the app's
  |   INJECTED `now`, `limit === 0` = disabled, and a HARD-CAPPED bucket table (`DEFAULT_MAX_BUCKETS`
  |   4096) that sweeps expired buckets and evicts the LEAST RECENTLY USED one — `check` re-inserts a
  |   bucket it serves, so a flooder stays HOT and is evicted last (a plain insertion-order eviction
  |   would forget the flooder between its own requests and silently stop limiting it). The bucket key
  |   is truncated to `MAX_IDENTITY_LENGTH` (64), so the header LENGTH cannot inflate the table
  |   either. Identity: `CF-Connecting-IP`, else the FIRST `X-Forwarded-For` hop, else one shared
  |   `local`; NEVER the socket address (loopback + tunnel = the socket is the tunnel). Wired in
  |   `src/server/app.ts` AFTER the CORS step and BEFORE `app.use("*", guard)`: before the guard so an
  |   UNKEYED flood is bounded and a 429 never reads a body or reaches a handler; after CORS so the 429
  |   carries the exposed `Retry-After`. Exempt: `/healthz`, the three UI assets (paths DERIVED from
  |   `UI_ASSETS`) and CORS preflights. New code `rate_limited` (429) in `ERROR_CODES`; `retry-after`
  |   joined `Access-Control-Expose-Headers`, which CHANGED the two CORS equality pins to the FULL set
  |   (`x-serverstore-sha256, retry-after`) — never relaxed to `toContain`.
  |   config=`SERVERSTORE_RATE_LIMIT` (default 600 per 60 s, `0` disables, window NOT configurable in
  |   v1); parsed by `config.ts parseRateLimit()`; a non-integer/negative/NaN/`600x` value — and
  |   SET-but-EMPTY, which `Number("")` would read as DISABLED — fails the BOOT loudly.
  | verify=THE WRITER'S OWN, in-turn: `bash scripts/gate.sh` -> exit 0 (GREEN) · 14 test files · 142
  | tests · 2.41s · raw log `.gate-logs/gate.log`; no memory ceiling needed (GUARD g3 still open and
  | still honest). The DISPATCHER's independent gate and its own arms are OWED.
  | arms=checkpoints/ratelimit-differential.sh, the gate lock held across BOTH arms, sha256 printed
  | before and after, restore from HEAD in an `EXIT INT TERM` trap, a control BEFORE and AFTER, raw
  | transcript `checkpoints/ratelimit-differential.out` (key-shaped strings scrubbed — ledger row 21):
  |   A the reset comparison NEUTRALISED so the window never rolls, src/server/ratelimit.ts
  |     `810abb51…c2753` -> `e80048e5…c355a`, RED on `PIN R3: the window rolls` — `expected 429 to be
  |     200`; R1/R2/R4–R8 stayed GREEN (the limiter still counts inside the window).
  |   B the bucket cap REMOVED (`if (buckets.size >= maxBuckets) evictOldest()` -> `if (false) …`),
  |     src/server/ratelimit.ts `810abb51…c2753` -> `9814f184…df0b7f`, RED on BOTH R6 tests (`expected
  |     500 to be less than or equal to 8`; `expected 4596 to be less than or equal to 4096`) while
  |     **PIN R2 stayed GREEN** — the arm isolates the BOUND, not the limiter.
  |   Both controls GREEN (14 files · 142 tests), the file restored byte-identical, both arms cheap
  |   exit=0 (no `error TS`), no VOID probe.
  | brief_correction=THE BRIEF REPEATED A STALE DOC CLAIM: it says `docs/DEPLOYMENT.md` calls the
  |   store's ingress "rule #5" and points at `docs/BOARD.md:964`. A grep of `docs/` finds `rule #5`
  |   ONLY in `docs/BOARD.md` lines 734 and 993 (and ledger row 31); DEPLOYMENT did not repeat it, and
  |   964 is not the line. The two BOARD places are corrected to `#6` (verified against
  |   `/etc/cloudflared/config.yml`: six hostname rules, `apps.futuremagic.de` above `store`), and the
  |   correct ordinal is ADDED to the DEPLOYMENT ingress section. Also: the brief's arm (a) says
  |   "invert the reset comparison"; a LITERAL inversion rolls the window on EVERY request and reddens
  |   R1/R2 too, so arm A NEUTRALISES the comparison (window never rolls) and reddens R3 alone.
  | docs_amended=docs/DECISION-LEDGER.md (row 65), docs/SEAM-INDEX.md (pipeline, the limiter row,
  |   gotcha 17), docs/TESTING.md (R1–R8, the 2-arm differential, the CORS-pin change and why it was
  |   not relaxed, honest unknowns), docs/API.md (rate-limiting section, error table, Limits table,
  |   route statuses, Non-goals), docs/DEPLOYMENT.md (env table + the ingress ordinal), docs/BOARD.md.
  | copies=COPIES: 1 — checked, no duplication (grepped `rate.?limit`, `retry-after`, `bucket`,
  |   `CF-Connecting-IP`, `x-forwarded-for` across src/ tests/ docs/: the limit is parsed in ONE place,
  |   the table/identity/exemptions live in ONE module, the middleware is registered in ONE place, and
  |   the exposed header value is the ONE constant `CORS_EXPOSE_HEADERS`).
  | retire_owed=worktree `worktrees/rate-limit` and branch `feat/rate-limit` are the DISPATCHER's to
  |   retire after it verifies this landing. NOT claimed retired here: the branch still exists (the
  |   writer is on it), so the `retired_branch=` key must not be used (board.sh would correctly report
  |   BOARD STALE).

LANDED | row=57 | sha=bd55b7e (the VERIFIED CODE tip ON THE REBASED TREE: `src/server/config.ts`,
  | `src/server/app.ts`, `src/server/main.ts`, `tests/cors.test.ts`, `tests/entrypoint.test.ts`,
  | `tests/helpers/server.ts`, `checkpoints/cors-differential.sh`; the docs commit carrying THIS
  | line, ledger row 57, docs/TESTING.md, docs/API.md and docs/SEAM-INDEX.md is its child — a
  | commit cannot name its own sha. The pre-push rebase replayed the pre-rebase tip `2d0e2ae` as
  | `bd55b7e` with an EMPTY content delta (`git diff --stat 2d0e2ae bd55b7e -- src tests
  | checkpoints` is empty), so the differential transcript's CONTROL line naming `2d0e2ae`
  | describes exactly the code that lands) | D1: CORS — A BROWSER ON ANOTHER ORIGIN CAN CALL THIS
  | API. Writer session `session-ef1b5440-a82c-47f7-b16d-987f278a138a` (a subagent of dispatcher
  | session dcd6176e-b4b9-4759-b64d-4c90d3495dfa), worktree worktrees/cors, branch feat/cors, base
  | origin/main 7798ff6, REBASED onto origin/main 264cdc1 before push. The dispatcher's
  | `IN-FLIGHT | row=57` block is FOLDED by this record (a mechanical union; docs/BOARD.md is the
  | only file the fold touched, and no other landing's record was altered).
  | what it is=THE ORDER IS THE FIX. A CORS `app.use("*", …)` step in `src/server/app.ts`,
  |   registered ABOVE `app.use("*", guard)`: a preflight (`OPTIONS` + `Access-Control-Request-Method`)
  |   is answered 204 THERE, with no key, and never reaches the guard — which matches EVERY path
  |   before routing and would otherwise answer 401, making the browser block the real request (no
  |   edge rule can fix that; a preflight needs a 2xx the origin owns). Every other request walks the
  |   pipeline unchanged. It is MIDDLEWARE, not a route, so the registered route table is unchanged
  |   and PIN A1-A3 stay green. `SERVERSTORE_CORS_ORIGINS` (comma-separated, trimmed) is parsed AND
  |   validated in `src/server/config.ts` and reaches the app as an explicit `corsOrigins`
  |   dependency; UNSET means `*`, safe because the API has no cookies and no ambient credentials.
  |   `Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS`; `Allow-Headers: authorization,
  |   x-api-key, content-type` (authorization named EXPLICITLY — the wildcard does not cover it);
  |   `Max-Age: 600`; `Expose-Headers: x-serverstore-sha256`; `Allow-Credentials` NEVER sent. A
  |   disallowed origin gets no allow-origin header and is NOT 403d — CORS is a browser-READ
  |   control, not the perimeter (row 21), so it sees the guard's own 401/403 and the BROWSER blocks.
  | verify=THE WRITER'S OWN, in-turn: `bash scripts/gate.sh` → exit 0 (GREEN) · 13 test files · 119
  |   tests · 2.18s · raw log `.gate-logs/gate.log`; no memory ceiling needed (GUARD g3 still open
  |   and still honest). The DISPATCHER's independent gate and its own arms are OWED.
  | arms=checkpoints/cors-differential.sh, the gate lock held across BOTH arms, `src/server/app.ts`
  |   sha256 printed before and after, restore from HEAD in an EXIT/INT/TERM trap INCLUDING web/, a
  |   control BEFORE and AFTER, raw transcript checkpoints/cors-differential.out:
  |   A the CORS step MOVED AFTER the key guard (the brief's named defect), app.ts
  |     9f32ff66…a7569 → 519ee2ba…27002, RED on `PIN O1: an unkeyed preflight is 2xx, allows PATCH,
  |     and names authorization as a whole word` — `expected 401 to be less than 300`; O3's
  |     PREFLIGHT half falls as ASSERTED collateral (`expected 401 to be 204`), while O2, O3's header
  |     half, O4, O5 and O6 stay GREEN (so the arm proves the ORDER, not "CORS is gone").
  |   B every response sends `Access-Control-Allow-Credentials: true`, app.ts 9f32ff66…a7569 →
  |     7a0db3e2…44c50, RED on `PIN O4` — `expected 'true' to be null`; O1/O2/O3/O5/O6 stay GREEN.
  |   both controls GREEN (13 files · 119 tests), app.ts back at 9f32ff66…a7569. Same file, different
  |   anchors → different hashes. No VOID probe.
  | HARNESS BUG, found by running it and recorded rather than quietly fixed: arm A's first end
  |   anchor was `app.get("/healthz")`, which swept the `const guard` declaration into the moved
  |   block and failed the TYPECHECK (`error TS2448`) instead of reddening PIN O1; the block is now
  |   delimited by its own first and last lines and both arms refuse attribution when the cheap tier
  |   fails.
  | pins=PIN O1-O6 (`tests/cors.test.ts`; O6 = the boundary validation, added beyond the brief) and
  |   PIN D7 (`tests/entrypoint.test.ts`; the spawned service proves `main.ts` WIRES the config, not
  |   just that `resolveConfig` parses it). PIN A1-A3 stayed GREEN.
  | judgement calls (all in ledger row 57): CORS headers are GATED ON THE `Origin` HEADER, so a
  |   no-Origin request is literally unchanged; SET-but-EMPTY `SERVERSTORE_CORS_ORIGINS` fails the
  |   BOOT instead of silently becoming `*`; each entry must be a BARE origin (a bare hostname or a
  |   URL with a path fails the boot loudly); a disallowed origin is never 403d; and the unit ships
  |   no `SERVERSTORE_CORS_ORIGINS`, so the LIVE service answers every origin today (safe: no
  |   cookies) — narrowing it is an operator setting, not a requirement for the game.
  | COPIES: 1 — checked, no duplication (grepped: "access-control", "cors", "origin" across src/
  |   tests/ web/ — the policy is parsed once in `src/server/config.ts parseCorsOrigins()`, the four
  |   header values and the step live once in `src/server/app.ts`, and the allowlist reaches the app
  |   as an explicit `corsOrigins` dependency rather than a second `process.env` read).
  | retired=nothing yet — the worktree worktrees/cors, branch feat/cors and writer session
  |   session-ef1b5440… are the dispatcher's to retire after ITS OWN verification; this writer does
  |   not retire itself.
  | docs=ledger row 57 · docs/TESTING.md (O1-O6 + D7, both arms with hashes, the harness bug, and
  |   the honest unknowns) · docs/API.md (a CORS section, the Limits row, the stale "no CORS"
  |   non-goal removed) · docs/SEAM-INDEX.md (the CORS seam, the pipeline map, gotchas 14-15) · this
  |   board.

LANDED | row=58 | sha=bd55b7e (the VERIFIED CODE tip — the CORS landing on the rebased tree; the
  | row-57 record commit e39b5aa is its child and THIS row-58 record rides in a commit below that,
  | because a commit cannot name its own sha. Pulled, restarted and re-probed BEFORE my own gate,
  | per GUARD g5)
  | verify=THE DISPATCHER'S OWN, on the INTEGRATED tree: gate exit 0 GREEN · 13 files · 119 tests ·
  | 2.24s (raw log `.gate-logs/dispatcher-gate-s12.log`), matching the writer's own count. Arms,
  | neither of them the writer's: R deleted `authorization` from `CORS_ALLOW_HEADERS` → RED on PIN O1
  | ALONE (the preflight still succeeds, so a status-only assertion would pass — this is the silent
  | failure the pin exists for); T neutralised the allowlist decision INSIDE the CORS step
  | (`deps.corsOrigins.includes(origin)` → `true`) → RED on PIN O3 with PIN D7 as HONEST COLLATERAL
  | (D7 spawns the real entrypoint and asserts the same negative end-to-end, so both must fall).
  | Both files restored byte-identical; lock held across both arms; no VOID probe.
  | LIVE=https://store.futuremagic.de — restarted to CORS, probe PASS exit 0, and the perimeter
  | checked BY HAND: a live preflight answers 204 with `access-control-allow-origin: *`,
  | `allow-headers: authorization, x-api-key, content-type`, `allow-methods: GET, POST, PUT, PATCH,
  | DELETE, OPTIONS`, `max-age: 600`, `expose-headers: x-serverstore-sha256`; an unauthenticated
  | cross-origin call is 401 that still CARRIES allow-origin; `allow-credentials` count = 0.
  | MY OWN ERROR: my first allowlist arm (S) mutated `parseCorsOrigins` in `config.ts` — the wrong
  | LAYER — and reddened D7/O6 but NOT O3; the harness REFUSED to attribute it and exited 1, which is
  | the metric fix of row 50 working. Also recorded: this arms harness has NO control run of its own,
  | so the GREEN evidence is the separate full gate above — a red arm proves nothing is green.
  | retired=worktree worktrees/cors · branch feat/cors · session session-ef1b5440…
  | host audit after the landing: lock free · 0 node processes · 0 chrome processes.
  | THE TURN-BASED GAME IS UNBLOCKED. Nothing is owed to the game by this project; narrowing the
  | allowlist to the game's origin is an operator setting, not a requirement.
  | docs=ledger row 58 · this board.

LANDED | row=55 | sha=81341ff (the C2 tip; pulled, restarted and re-probed BEFORE my own gate, per
  | GUARD g5 — this landing changes the SCHEMA)
  | verify=THE DISPATCHER'S OWN, on the INTEGRATED tree: gate exit 0 GREEN · 12 files · 104 tests.
  | Arms, neither of them the writer's: P removed the scoped-admin RESULT-scope boundary → RED on
  | PIN E2 (a scoped admin could widen a key beyond its own stores); Q froze the audit timestamp →
  | RED on PIN E4 AND E8 (E8 drives an edit through the route after dropping the columns, so a stamp
  | that never moves fails it too — honest collateral). Both files restored byte-identical.
  | LIVE=restarted to C2; probe PASS; the live database now carries updated_at/updated_by and every
  | existing key holds NULL for both ("never changed"); PATCH is live (401 without a key).
  | docs/API.md's stale "public host is behind Access" claim corrected by the writer after
  | re-measuring the probe.
  | retired=worktree worktrees/key-edit · branch feat/key-edit · session 10c1ec41…
  | docs=ledger row 55 · this board.

LANDED | row=53 | sha=3f0a866 (the VERIFIED CODE tip ON THE REBASED TREE: `src/core/db.ts`,
  | `src/core/keys.ts`, `src/core/types.ts`, `src/core/validate.ts`, `src/server/app.ts`,
  | `web/index.html`, `web/app.js`, `web/app.css`, `tests/keys.test.ts`,
  | `tests/helpers/server.ts`, `checkpoints/key-edit-differential.sh`, plus `docs/API.md` and
  | `docs/SEAM-INDEX.md`; the docs commit carrying THIS line, ledger row 53, `docs/TESTING.md`
  | and the differential transcript is its child — a commit cannot name its own sha. The
  | pre-push rebase replayed the pre-rebase tip `5273c89` as `3f0a866` with an EMPTY content
  | delta (`git diff --stat 5273c89 3f0a866 -- src tests web docs/API.md docs/SEAM-INDEX.md
  | checkpoints/key-edit-differential.sh` is empty), so the transcript's CONTROL line naming
  | `5273c89` describes exactly the code that lands) | C2: NAMED, EDITABLE KEYS
  | WITH AN AUDIT STAMP. Writer session `10c1ec41-c7cb-4c40-908c-13bc3fe856d0` (a subagent of
  | dispatcher session dcd6176e…), branch feat/key-edit, worktree
  | worktrees/key-edit, base origin/main a556854, REBASED onto origin/main 08405de before push.
  | The dispatcher's `IN-FLIGHT | row=53` block is FOLDED by this record (it sat inside the
  | SESSION block and was removed as a mechanical union — `docs/BOARD.md` is the only file the
  | fold touched, and no other landing's record was altered). `PATCH /keys/:id` takes any subset of
  | `{label, stores, perms}`, reuses the SAME boundary as minting (requireAdmin +
  | `holdsStores` + the same parsers), refuses a revoked key, and never writes the key's
  | VALUE — the credential a holder already has keeps working with its new grant.
  | `updated_at`/`updated_by` are added by an idempotent add-if-absent migration and served
  | by `GET /keys`; a never-edited key says "never changed". The console gains an Edit
  | affordance per row (disabled for a revoked key, with an in-use warning and a
  | "changed <when> by <label>" line).
  | verify=THE WRITER'S OWN, in-turn: `bash scripts/gate.sh` → exit 0 (GREEN) · 12 test
  | files · 104 tests · 2.12s · raw log `.gate-logs/gate.log`; RE-GATED on the REBASED tree
  | after the conflict resolution — exit 0 GREEN · 12 files · 104 tests · 2.15s; no memory
  | ceiling needed (GUARD g3 still open and still honest). The DISPATCHER's independent gate,
  | its own arms, the GUARD g5 restart and the live re-probe are OWED.
  | arms=checkpoints/key-edit-differential.sh, the gate lock held across BOTH arms, each
  | mutated file's sha256 printed before and after, restore from HEAD in an EXIT/INT/TERM
  | trap INCLUDING web/, a control BEFORE and AFTER, raw transcript
  | checkpoints/key-edit-differential.out (key-shaped strings scrubbed — ledger row 21):
  |   A `editKey` RE-MINTS the key's value (the row's key_hash rotates to a fresh raw key),
  |     src/core/keys.ts e85264ac…e669 → 68e4edbc…9b01, RED on `PIN E6: an edit does NOT
  |     change the key's value` — `expected 401 to be 200` (the holder's key stopped
  |     authenticating); E1/E2 fell as EXPECTED collateral (that IS what a changed value
  |     means) and E3/E4/E5/E7/E8 stayed GREEN.
  |   B the revoked-key refusal removed (`if ((false as boolean)) {`), src/server/app.ts
  |     87eabf30…3478 → 1bd4c3d2…417d, RED on `PIN E3: a REVOKED key cannot be edited back
  |     to life` — `expected 200 to be 403`; E4/E5/E6/E7/E8 stayed GREEN.
  |   both controls GREEN (12 files · 104 tests), both files back at their before hashes.
  |     The two arms carry DIFFERENT hashes in DIFFERENT files. No VOID probe.
  | pins=PIN E1-E8 (E8 added beyond the brief: the audit-column migration is REAL — the
  |   columns are dropped from a live database and the next boot adds them back). PIN L1's
  |   exact-field list gained updatedAt/updatedBy in the same commit.
  | judgement calls (all in ledger row 53): the containment predicate is read FOUR times
  |   for a scoped admin so it cannot DEMOTE a peer admin key, with no self-edit exception;
  |   the admin-grant rule reads the CHANGE, not the resulting set (a master may rename or
  |   narrow an existing admin key, and may narrow a master admin to a named store); a
  |   blank label on PATCH means "unlabelled", identical to mint; and a STALE claim in
  |   `docs/API.md` (Access 302) was corrected, re-measured by probe-live → PASS exit 0.
  | COPIES: 3->1 — three copies folded: the label rule is now ONE rule
  |   (`src/core/validate.ts` parseLabel/DEFAULT_LABEL + `src/core/keys.ts` assertLabel)
  |   serving mint and edit; the key-entry projection is now ONE function
  |   (`src/server/app.ts` keyEntry) serving `GET /keys` and the `PATCH` response; the
  |   audit-column DDL is ONE add-if-absent migration (`src/core/db.ts`
  |   migrateKeyAuditColumns) rather than a `CREATE TABLE` edit alone.
  | retired=nothing yet — the worktree, branch and writer session are the dispatcher's to
  |   retire after its own verification.
  | docs=ledger row 53 · `docs/TESTING.md` (E1-E8 + both arms) · `docs/API.md` ·
  |   `docs/SEAM-INDEX.md` · this board.

LANDED | row=54 | sha=262df1b (the record commit; the C1 tip verified is 7e92967 — pulled,
  | restarted and re-probed BEFORE my own gate, per GUARD g5)
  | verify=THE DISPATCHER'S OWN, on the INTEGRATED tree: gate exit 0 GREEN · 12 files · 96 tests ·
  | 2.11s. Arms, neither of them the writer's and both on the asset it did not touch: Z an
  | `ssk_`-shaped string in `web/index.html` → RED on U1 AND U4 (U4 also forbids an inline key);
  | W a remote `<script src="https://…">` → RED on U4 alone. Both restored byte-identical, and the
  | FAIL-line metric fixed in row 50 named exactly the pins that fell.
  | LIVE=https://store.futuremagic.de/ serves the console WITHOUT a key (200 HTML 4824 bytes;
  | /app.js 200 11683; /app.css 200 3478); probe PASS exit 0. docs/API.md's "unknown path is 404"
  | is corrected in this commit: without a valid key EVERY path answers 401, which is the better
  | behaviour — the API never reveals which routes exist.
  | retired=worktree worktrees/admin-ui · branch feat/admin-ui · session 529a0ac5…
  | docs=ledger row 54 · this board.

LANDED | row=50 | sha=5217cec (the B2 tip; pulled, restarted and re-probed BEFORE my own gate, per
  | GUARD g5)
  | verify=THE DISPATCHER'S OWN, on the INTEGRATED tree: gate exit 0 GREEN · 11 files · 92 tests ·
  | 2.04s. Arms, neither of them the writer's: X neutered the ONE containment predicate
  | (`holdsStores` -> true) → FOUR pins fell across THREE features (M3 and G2 at the mint boundary,
  | L2 at the listing filter, L4 at the revoke boundary); Y removed the peer-admin half of the
  | revoke rule → L4 fell (200 vs 403), so that rule IS pinned. LIVE: restarted to B2, probe PASS,
  | and /keys, /keys/:id/revoke, /whoami all answer 401 (registered, key required).
  | MY OWN ERROR: the harness's "which pins fell" metric matched pin names in the PASSING tree too;
  | verdicts were read from the FAIL lines and the metric is fixed.
  | retired=worktree worktrees/key-lifecycle · branch feat/key-lifecycle · session a5bcf77c…
  | docs=ledger row 50 · this board.

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
LANDED | row=80 | sha=620a71b (the VERIFIED CODE tip; the slice-17 landing itself is row 79 below)
  | verify=THE DISPATCHER'S OWN, on the INTEGRATED tree: gate exit 0 GREEN · 18 files · 172 tests ·
  | 4.15s, of which `tests/concurrency.test.ts` is 2.86s — the multi-process pins' price on every gate
  | run, stated rather than discovered later (raw log `.gate-logs/dispatcher-gate-s17.log`).
  | arms=`.gate-logs/dispatcher-arms-s17.sh`, transcript `.gate-logs/dispatcher-arms-s17.out`, the gate
  | lock held across a control and ALL THREE arms, sha256 printed before and after, restore from HEAD in
  | an `EXIT INT TERM` trap with the hash asserted back, a control BEFORE and AFTER, `error TS` = VOID,
  | a VOID arm RECORDED while the run continues. Arms, none of them the writer's (the writer armed A the
  | journal mode back to DELETE → Y5 with Y7 as its declared twin, B the busy timeout disabled → Y7 with
  | Y4 as its declared twin) — these three go after the OTHER half of the slice, the boot import whose
  | whole job is to move live bytes without losing or inventing one:
  |   R the import's SHA256 RE-VERIFICATION removed (`src/storage/migrate.ts` `26b3ab49…4e45` →
  |     `72517785…c15d`) → **RED on PIN Y2 ALONE**: bytes that are NOT the entry would be imported
  |     silently, i.e. the database would serve content the row does not name.
  |   S the legacy tree deleted BEFORE the import (the order the module promises to keep,
  |     `26b3ab49…4e45` → `ed4b1423…3ac2`) → **RED on PIN Y2 with PIN Y3 as HONEST COLLATERAL** (Y3 is
  |     the keys-survive pin; a boot that fails takes every assertion that needs a boot with it, and the
  |     failing test names confirm both are the same mechanism, not two defects).
  |   T the loud NULL-content read replaced by EMPTY BYTES (`src/storage/kinds.ts` `c86b5cae…86ab` →
  |     `b4f95100…296b`) → **RED on the intended test** (`a GET whose row has no content fails loudly,
  |     not with empty bytes`, `expected 200 to be >= 500` — the empty-bytes fallback served a 200).
  |     My harness's FAIL-line metric could not NAME it, because that pin lives in a file header
  |     (`tests/objects.test.ts` declares "PIN 4, 5, 8" once) and not in the test name: the metric now
  |     falls back to printing the failing test names, so an arm can never be silently unattributable
  |     again. The arm was attributable from its log within a minute, and this is my own machinery
  |     error recorded rather than a hole in the pins.
  |   both controls GREEN (18 files · 172 tests), every mutated file back at its before-hash, 0 of OUR
  |   chrome processes after every run (scoped, per TRAP t8).
  | THE LIVE MIGRATION, VERIFIED BY WITNESS RATHER THAN BY HOPE (`.gate-logs/live-witness.py`, run
  | before and after; digests only, no key material): a FRESH copy of the data root was taken first
  | (`serverstore-data.backup-pre-migration`), then the unit was restarted at **14:34:54 CEST** and its
  | boot ran the import. Result — **the 6 `access_keys` rows and their 3 scope rows are BYTE-IDENTICAL
  | before and after (`e73652f1…` and `8b14cb9b…` unchanged: the master key survives, the owner's one
  | stated must-survive)**, the 175 object rows are identical (`28b8a26e…`), `objects with content`
  | went **0 → 175**, blob FILES went **177 → 0** (the `stores/` tree is gone), `journal_mode` went
  | **delete → wal**, `integrity_check` = **ok**, and **all 175 rows' content re-hashes to its recorded
  | `sha256` with 0 size mismatches and 0 hash/NULL problems** — the import moved the right bytes, not
  | merely some bytes. `scripts/probe-live.sh https://store.futuremagic.de` → **PASS exit 0**, the
  | public hostname is served, and the disk layout is now `serverstore.db` + `-wal` + `-shm` and
  | nothing else. The key-bearing read is the OWNER's acceptance step (the dispatcher holds no key),
  | and the pre-migration copy stays until he confirms it.
  | retired=worktree worktrees/sqlite-core · branch feat/sqlite-core (was 57b455d, verified fully merged
  | with `git branch --merged main`) · writer session bef2ab2d… — salvage-checked BEFORE deletion
  | (tracked-clean worktree, tip == origin/main). Host after: only `main` in `git worktree list`, no
  | `feat/sqlite-core` in `git branch -a`, 0 processes referencing the worktree, lock free.
  | docs=ledger row 80 · this board.

LANDED | row=79 | sha=620a71b (the WRITER'S CODE tip; the docs child naming it follows on this branch)
  | verify=THE WRITER'S OWN, in-turn: `bash scripts/gate.sh` exit 0 GREEN · 18 files · 172 tests ·
  | 3.56s · raw log .gate-logs/gate.log. DISPATCHER'S INDEPENDENT GATE IS OWED.
  | arms=checkpoints/sqlite-core-differential.sh — the gate lock held across BOTH arms, a CONTROL at
  | each end, src/core/db.ts sha256 0edb252b…10dc3 printed before/after and asserted back. ARM A
  | (`journal_mode = WAL` -> `DELETE`, 1e6814a5…bd90e): PIN Y5 RED (`READS 1 MAX 931 ERRORS 0` against
  | the 250 ms bound — the reader waited) and PIN Y7 RED as the DECLARED TWIN of the same mechanism;
  | Y1/Y4/Y6 GREEN. ARM B (busy timeout set then DISABLED to 0, 9f390820…4cd99): PIN Y7 RED
  | (`expected +0 to be 5000`) and PIN Y4 RED as the DECLARED TWIN (the second PROCESS fails instead
  | of queueing); Y3/Y5/Y6 GREEN. No `error TS`, no VOID probe, both controls GREEN, hashes restored.
  | docs=ledger row 79 · SEAM-INDEX (the medium is ONE handler; the transaction is ONE seam; the WAL
  | rules and WHY; verify-then-delete; the removed shared-blob concept; the async-medium trade named)
  | · STORAGE.md REWRITTEN (one database file, WAL sidecars, the three-file/`VACUUM INTO` backup rule,
  | the boot import, measured engine limits) · DEPLOYMENT.md (the sidecar row, the backup section, the
  | first-boot migration ordering) · TESTING.md (Y1–Y8, both arms with hashes, the multi-process cost,
  | honest unknowns) · API.md storage sentences ONLY — the wire contract is unchanged and PIN A1–A3
  | stayed green.
  | note=the live data root /home/administrator/serverstore-data was NEVER touched and is NOT migrated
  | by this landing: the dispatcher takes the three-file backup and restarts the unit, and THAT boot
  | runs the import (loud on any missing/corrupt/mismatched blob). COPIES: 4->1 — the ONE
  | `withImmediateTransaction()` seam; the item DML is the ONE `handlerFor()` handler under
  | `src/storage/`.
  | retired=OWED — worktree worktrees/sqlite-core · branch feat/sqlite-core stay until the dispatcher
  | verifies this landing.
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
