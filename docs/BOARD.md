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
reconciled: 2e44eaf · 2026-09-27T16:10Z — the gated landing commit, and now MACHINE-VERIFIED:
  `bash scripts/board.sh` → BOARD RECONCILED (exit 0), reporting "2e44eaf is on origin/main" and
  "2e44eaf is an ancestor of the remote". (An earlier line here read "20c132d · 2026-09-27T17:45Z",
  which was LOCAL time mislabelled as Z — the dispatcher's error, corrected rather than quietly.)

SESSION | id=session-dcd6176e-b4b9-4759-b64d-4c90d3495dfa | role=dispatcher (chief of staff)
  | state=WAITING on ONE writer (slice 2, row 19) — dispatch is the only work in flight
  | goal=goal-1f2f2e27-ed8d-470d-8499-c1eeed63b3b6 (paused; untouched since creation)
  | host=12 cores · 23Gi RAM · load 0.6 · / has 506GB free
  | remote=https://github.com/ArndRosemeier/ServerStore.git — PUBLIC, owner-created 2026-09-27.
  |   origin/main = a20fc95 and HEAD == origin/main: the first push landed and the board is
  |   machine-verified. (Row 16's private `Store` repo is ORPHANED — nothing points at it.)

IN-FLIGHT | row=19 | writer=session-b0fbcc08-9760-4545-bad0-1e5acd46d524 | model=harness default
  | worktree=/home/administrator/projects/ServerStore/worktrees/core | branch=feat/core
  | base=b60c716 | dispatched_by=session-dcd6176e-b4b9-4759-b64d-4c90d3495dfa
  | state=dispatched 2026-09-27T16:11Z, no commit yet | brief=docs/briefs/slice-2-core.md
  | note=the multi-store core. The ONE seam: the request pipeline (resolve key -> authorize against
  |   a named store -> dispatch to that store's storage). Hono app factory testable in-process via
  |   app.request(); node:sqlite metadata (verified to load unflagged on Node 24); content-addressed
  |   bytes under a data root OUTSIDE the repo; store registry with an idempotently seeded `master`
  |   store; hashed scoped access keys returned once; local `pnpm run admin:key` bootstrap with NO
  |   HTTP route that mints an admin key. Pins: 401 with no key, 403 across stores, revoked and
  |   expired refused, byte-identical round-trip, THE RAW KEY ABSENT FROM THE DB FILE, idempotent
  |   master seed, healthz needs no key, traversal and over-cap refused with named codes.

NOTE | tsconfig includes tests/ only. src/ arrives with the first FEATURE slice (the multi-store
  core); inventing a dead module now would be vanity, and the ledger records it as unproven.
NOTE | Toolbox's machinery MOVED (now docs/README.md, WAY-OF-WORKING.md, BOARD, DECISION-LEDGER,
  SEAM-INDEX, TESTING, GATE, BRIEF + a 4-file scaffold). We have the minimum it names — board,
  ledger, brief, ONE gate, a lock — and deliberately have NO SEAM-INDEX and NO TESTING doc yet:
  there is no seam and no behaviour to record. Both land with the first feature slice.

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
QUEUE | row=17 | the reconciler defect (row 15) is STILL upstream at Toolbox head 824a8b5 —
  scaffold/scripts/board.sh:53 and :60 keep the bare `git rev-parse`. Toolbox is outside this
  project, so it needs the owner's word before anyone touches it.
QUEUE | row=none | HTTP framework (Hono vs Fastify) — deliberately deferred to the first feature slice.
QUEUE | row=none | FIRST FEATURE SLICE: multi-store core — store registry + master store + access-key
  auth (hashed, prefixed, scoped) + PUT/GET, per ledger rows 5, 6, 10.
QUEUE | row=none | systemd --user unit + cloudflared ingress for the live subdomain.

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
  | remote=https://github.com/ArndRosemeier/ServerStore.git (PUBLIC; origin/main = a20fc95)
  | gate=bash scripts/gate.sh  (0 green · 1 red · 2 cheap only · 9 refused/VOID)
  | logs=.gate-logs/gate.log | board=bash scripts/board.sh | rules=AGENTS.md
  | decisions=docs/DECISION-LEDGER.md rows 1-14 | briefs=docs/BRIEF.md
  | sessions=~/.dsh/sessions/--home-administrator-projects-ServerStore--
```

## Landed

```
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
  `tests/process/gate-contract.test.ts`.
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
