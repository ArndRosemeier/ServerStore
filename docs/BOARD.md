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
| `QUEUE` | owner requests and known debt not yet dispatched, with the row number reserved |
| `QUEUE-CLOSED` | a queue line whose scope is consumed (kept one screen, then dropped) |
| `TRAP` | a mistake that actually happened, with the rule that prevents it |
| `GUARD` | a mechanism protecting the process (host, memory, compaction) and how to verify it |
| `RECOVERY` | where a successor finds lost context |

---

## Board

```
reconciled: c0731fe · 2026-09-27T16:33:53Z — the gated tree tip of slice 2, verified by the DISPATCHER's own
  gate (exit 0 GREEN · 6 files · 52 tests · 1.90s) and by its own arms E and H (ledger row 22).
  `bash scripts/board.sh` must report this marker as an ancestor of origin/main. (An earlier line
  here read "20c132d · 2026-09-27T17:45Z" — LOCAL time mislabelled as Z, the dispatcher's error,
  corrected rather than quietly.)

SESSION | id=session-dcd6176e-b4b9-4759-b64d-4c90d3495dfa | role=dispatcher (chief of staff)
  | state=ONE writer in flight (slice 3, row 23); slice 2 verified and retired
  | goal=goal-1f2f2e27-ed8d-470d-8499-c1eeed63b3b6 (paused; untouched since creation)
  | host=12 cores · 23Gi RAM · / has 506GB free · a FOREIGN gate (BlasterMaster) was mid-run at
  |   16:35Z, and ~30 orphaned headless Chrome processes from Imager/.gate-logs are ~32h old —
  |   neither is ours to reap; both are why the load is not zero.
  | remote=https://github.com/ArndRosemeier/ServerStore.git — PUBLIC, owner-created 2026-09-27.
  |   origin/main carries the row-19 landing (c0731fe) and the reconcile (023e098).

IN-FLIGHT | row=23 | writer=session-ebb420aa-fa06-400d-a250-84a28af0f55c | model=harness default
  | worktree=/home/administrator/projects/ServerStore/worktrees/tripwire | branch=feat/tripwire
  | base=023e098 | dispatched_by=session-dcd6176e-b4b9-4759-b64d-4c90d3495dfa
  | state=dispatched 2026-09-27T17:15:21Z, no commit yet | brief=docs/briefs/slice-3-tripwire.md
  | note=the SECRET TRIPWIRE — the mechanism behind ledger row 21. A pure scanner in
  |   tests/helpers/secrets.ts over the TRACKED tree (what would be published): GitHub token
  |   shapes, PEM private-key headers, and the host credential's exact value compared in memory
  |   and never printed ("cannot check" reported LOUDLY when the file is absent, never a silent
  |   pass), plus no tracked *.db/*.sqlite. It must be ABLE to go red (PIN S4 plants a fake
  |   token) and must NOT cry wolf on our own key-shaped fixtures (PIN S5) — which is why the
  |   obvious bare-`ssk_` rule was rejected in the brief.

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
QUEUE | row=none | DEPLOYMENT: systemd --user unit + cloudflared ingress for
  store.futuremagic.de + the first end-to-end probe through the tunnel. The owner picked this
  ("Deploy it"); the tunnel restart needs his go-ahead at that moment (TRAP t1), and the master
  key is HIS to mint — the dispatcher must never hold it.

TRAP | t1 | Adding a hostname to /etc/cloudflared/config.yml REQUIRES RESTARTING the tunnel — a few
  | seconds in which dsh.futuremagic.de (the owner's own GUI), opencode.futuremagic.de and
  | openclaw.futuremagic.de all drop. Passwordless sudo works, so this line is the only guard.
TRAP | t2 | Two FOREIGN processes were mid-run at reconcile in BlasterMaster/worktrees/dup-tripwire
  | (`npm run gate`, `npm run build`). The gate lock is PER-REPO, so it does not exclude a peer
  | project's suite; check pgrep / board.sh before a big run.

GUARD | g1 | Never bind to 0.0.0.0. Loopback + tunnel is how every service on this box is exposed
  | (precedent: apps-web.service).
GUARD | g2 | A long check never runs in the foreground in the dispatcher session; a WRITER runs its
  | own gate IN-TURN, because a subagent's background jobs die with its turn.
GUARD | g3 | Memory ceiling: NOT YET IMPLEMENTED — the suite is trivial, so there is nothing to
  | bound. Debt, not a claim. It lands with the first suite that is not.
GUARD | g4 | The suite lock is per-repo (`.gate-lock` at the git common dir). Verify: run the gate
  | twice — the second run exits 9 and is VOID. It does NOT exclude a peer project's suite.

RECOVERY | repo=/home/administrator/projects/ServerStore | branch=main
  | remote=https://github.com/ArndRosemeier/ServerStore.git (PUBLIC; origin/main now carries the
  |   row-19 landing, whose sha is the LANDED row below)
  | gate=bash scripts/gate.sh  (0 green · 1 red · 2 cheap only · 9 refused/VOID)
  | logs=.gate-logs/gate.log | board=bash scripts/board.sh | rules=AGENTS.md
  | decisions=docs/DECISION-LEDGER.md rows 1-24 (row 19 appended by the writer out of numeric
  |   order; row 23 is the tripwire landing, row 24 the Toolbox upstream fix)
  | briefs=docs/BRIEF.md + docs/briefs/ | seams=docs/SEAM-INDEX.md | tests=docs/TESTING.md
  | sessions=~/.dsh/sessions/--home-administrator-projects-ServerStore--
```

## Landed

```
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
