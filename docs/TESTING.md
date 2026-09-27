# Testing — the pins, and the probe that proves them

**The test is the statement.** This file does not restate behaviour; it records
*what is pinned*, *what the writer did to prove the pins can go RED*, and *the exact
evidence left behind*.

- The ONE command: `bash scripts/gate.sh` — `0` GREEN · `1` RED · `2` cheap tier only
  (not a pass) · `9` refused, VOID. Raw log: `.gate-logs/gate.log`.
- The suite: `vitest`, `tests/**/*.test.ts`. One fixture set
  (`tests/helpers/server.ts`): a real temp data root, a real SQLite file, a real Hono
  app driven through `app.request()`. **No port is bound in a test**, and no test
  writes outside its own temp directory.

## The pins

Each pin's NAME is the contract. `tests/` maps to them as follows.

| # | Pin | Where |
| ---: | --- | --- |
| 1 | No key → **401**, and nothing is written to the data root | `tests/auth.test.ts` (`PIN 1`) |
| 2 | A key scoped to store A cannot read/write B (**403**), and B's bytes are untouched | `tests/auth.test.ts` (`PIN 2`) |
| 3 | A **revoked** key is refused 401; an **expired** key is refused 401 | `tests/auth.test.ts` (`PIN 3`) |
| 4 | `PUT` then `GET` is byte-identical (sha256 equal), and the blob on disk hashes to the same value | `tests/objects.test.ts` (`PIN 4`) |
| 5 | The presented raw key never appears in `serverstore.db` (checked as BYTES) | `tests/objects.test.ts` (`PIN 5`) |
| 6 | `master` exists after first boot; a second and third boot do not duplicate it | `tests/core.test.ts` (`PIN 6`) |
| 7 | `GET /healthz` needs no key; every other route is 401 without one | `tests/auth.test.ts` (`PIN 7`) |
| 8 | Path traversal and an over-cap body each produce their named error code (`invalid_name`, `payload_too_large`) | `tests/objects.test.ts` (`PIN 8`) |
| 9 | `pnpm run admin:key` mints a key the HTTP API accepts as admin; **no HTTP route mints an admin key without one** | `tests/admin-key.test.ts` (`PIN 9`) |
| — | The process itself (gate vocabulary, the lock refusing a concurrent run, the reconciler saying CANNOT LOOK) | `tests/gate.test.ts` |
| — | The SOURCE TREE runs under strip-only Node (this is what `pnpm run serve` executes) | `tests/runtime.test.ts` |

Supporting tests that are pins in their own right: the empty body is refused (no
object is finalised from nothing); a missing blob fails **loudly** (500 `internal`,
never empty bytes); a store row whose kind has no handler is a named 500, never a
fallback to `bytes`; `x-api-key` behaves exactly like `Authorization: Bearer`; an
illegal name that only *looks* like a traversal (`a..b`) is still a legal name.

## The secret tripwire pins (slice 3)

A public repo is fine for this project (ledger rows 20–21); "we won't push the key" is
what needed a mechanism. The scanner is `tests/helpers/secrets.ts`, called by ONE test
file, `tests/secrets.test.ts` — deliberately **not** a step in `scripts/gate.sh`, which
is the ONE way the suite runs (a second check path there could be skipped silently).
**Tracked** means what a push would PUBLISH (`git ls-files`).

| # | Pin | Where |
| ---: | --- | --- |
| S1 | the tracked tree carries no GitHub token shape (`ghp_`/`gho_`/`ghu_`/`ghs_`/`ghr_`+36, `github_pat_`+22) | `tests/secrets.test.ts` (`PIN S1`) |
| S2 | the tracked tree carries no PEM private key | `tests/secrets.test.ts` (`PIN S2`) |
| S3 | the host credential's value appears in no tracked file — and an absent credential file makes this FAIL with "cannot check", never pass silently | `tests/secrets.test.ts` (`PIN S3`) |
| S4 | the scanner DETECTS a planted fake token (the tripwire's falsifiability, on a throwaway git repo) | `tests/secrets.test.ts` (`PIN S4`) |
| S5 | a legal `ssk_…` fixture is NOT flagged (the anti-cry-wolf pin) | `tests/secrets.test.ts` (`PIN S5`) |
| S6 | no tracked `.db` / `.sqlite` / `.sqlite3` artifact, and `.gitignore` carries the three patterns | `tests/secrets.test.ts` (`PIN S6`) |

**The rule that is deliberately absent: a bare `ssk_`-shaped scan.** Our own tests mint
key-shaped fixtures (`tests/auth.test.ts`, `tests/admin-key.test.ts`), so such a rule
would either red on the suite or force an exclusion list covering the very files most
likely to hide a real leak. The planted token in `tests/secrets.test.ts` is likewise
built from parts, never written as a literal, because that file is itself tracked.

## The writer's differential (4 arms + control)

Machinery: `checkpoints/differential.sh`. Raw output: `checkpoints/differential.out`
(per-arm raw logs are kept locally but are `*.log`, so gitignored).

Shape: the slice is committed first; the harness takes **the same lock
`scripts/gate.sh` takes** (derived from the git common dir — one lock across the main
tree and every worktree) and holds it across every arm; each arm edits ONE line,
prints its file's sha256 before and after, runs both tiers, and restores with
`git checkout HEAD --`. The restore is also in an `EXIT INT TERM` trap, so a crash
mid-arm cannot leave the tree mutated. Because the harness itself holds the lock, the
arms run the two tiers directly instead of calling `gate.sh` — calling the gate would
make it (correctly) refuse itself with exit 9, which is VOID, not evidence.

| Arm | Injected defect | File | sha256 before → after | Went RED on |
| --- | --- | --- | --- | --- |
| A | the seeded store is named `MASTER`, not `master` | `src/stores/registry.ts` | `6e6c490d…82f7` → `fa46f254…4cec` | `PIN 6: the master store exists after first boot, and a second boot does not duplicate it` — `expected [ 'MASTER' ] to deeply equal [ 'master' ]` |
| B | the raw key is persisted NEXT TO its hash (`hash:raw`) | `src/core/keys.ts` | `931f1c87…5d23` → `dab67ee6…8fb2` | `PIN 5: the presented key string never appears in the database file` — `the master key must not be in serverstore.db: expected true to be false` |
| C | the revoked-key check is inverted (`revoked_at === null` → return null) | `src/core/keys.ts` | `931f1c87…5d23` → `ce1e32cb…50e4` | `PIN 3: A REVOKED key is refused 401` — `expected 401 to be 200` |
| D | a parameter property (`constructor(readonly key: T)`) replaces the plain fields | `src/server/app.ts` | `99367879…22e4` → `55bf1568…c527` | `every side-effect-free module imports in a real node process` — `IMPORT FAILED: …/src/server/app.ts :: TypeScript parameter property is not supported in strip-only mode` |
| control | none — the restored tree, same lock still held | — | — | **GREEN**: 6 files · 52 tests · ~1.9s |

- Every arm's tier run exited **1** and every arm's named pin appears in the log, so no
  arm is a probe that "went red somewhere".
- Arm B and arm C inject into the SAME file but produce DIFFERENT hashes and DIFFERENT
  red pins; arm D is in a third file and a fourth hash. Two arms with identical output
  would be a VOID probe, not evidence.
- Arm D is not decoration: it is the **defect this slice actually shipped**. The suite
  was green while `pnpm run serve` and `pnpm run admin:key` died at import, because
  vitest transpiles and strip-only Node does not. It was found by probing the real
  server by hand (healthz 200, `pnpm run admin:key` → a key the live API accepted,
  PUT/GET over loopback, `ss -ltn` showing `127.0.0.1:8477` only) — and the probe is
  now a test, so the next one cannot hide.
- No VOID probe occurred: the harness asserts `before != after` before running each
  arm, and exits non-zero ("VOID probe") if a hash is unchanged.
- The control run is the proof that the injection, and nothing else, was the
  difference: same tree, same lock, exit **0**.

## The tripwire's differential arm (slice 3)

Machinery: `checkpoints/tripwire-differential.sh`. Raw output:
`checkpoints/tripwire-differential.out` (the per-arm gate log is `*.log`, so gitignored).

Because the tripwire is itself an arm, its differential is small: the slice is
committed FIRST, an obviously fake GitHub token (`ghp_` + 36×`A`) is appended to a
tracked file, and the ONE gate (`bash scripts/gate.sh`, with `GATE_LOG_DIR` redirected
per arm so the green log survives) must go RED on PIN S1. The file's sha256 is printed
before and after — an unchanged hash would be a VOID probe — and the restore runs from
`HEAD` in an `EXIT INT TERM` trap, so a crash cannot leave the token in the tree. A
control gate run on the restored tree must be GREEN.

| Arm | Injected defect | File | sha256 before → after | Went RED on |
| --- | --- | --- | --- | --- |
| S | a fake `ghp_`+36×`A` appended to a tracked file | `AGENTS.md` | `2af90514d3fc…409e` → `d0034621e1d6…7f0e` | `PIN S1: the tracked tree carries no GitHub token shape` — `a GitHub token shape is TRACKED — it is already published: remove it and rotate it: expected [ Array(1) ] to deeply equal []`, received `["AGENTS.md: GitHub token shape at byte offset 7671"]` |
| control | none — the restored tree | — | `2af90514d3fc…409e` (back) | **GREEN**: 7 files · 60 tests · ~2.0s |

## The full gate

`bash scripts/gate.sh` is the ONE command; exit `0` (GREEN) means both tiers passed.
Raw log: `.gate-logs/gate.log` (gitignored). This doc deliberately carries **no test
count**: a tally restated in prose goes stale inside its own landing (ledger row 22
deleted one for exactly that), so the LANDED row on `docs/BOARD.md` records the numbers
for the specific landing it verified.

## What is NOT tested yet (honest unknowns)

- **No concurrency test.** Two writers racing the same object name are handled by an
  upsert, but nothing exercises it. Unproven rather than claimed.
- **No test binds a port or exercises `main.ts`.** The loopback binding is a code
  constant plus a review, not a pin. It WAS probed by hand — the server was started,
  served `/healthz` 200, accepted a key minted by `pnpm run admin:key`, round-tripped
  an object, and `ss -ltn` showed `127.0.0.1:8477` and nothing else — but a hand probe
  is not a pin. The automated version needs a spawned server, and that is owed to the
  deployment slice, which also owns the `systemctl --user` unit.
- **No garbage collection test** — there is no GC (brief §4, ledger row 19).
- **Memory ceiling (GUARD g3) not implemented**; the suite is still trivial.
- **The tripwire only knows the pinned shapes.** A secret in a format outside
  `ghp_`/`github_pat_`/PEM (or a github.com credential for another host) is not
  caught; the tripwire is a net, not a proof.
- **An UNTRACKED secret is out of scope by design** — tracked is what a push would
  publish (ledger row 23).
- **PIN S3 depends on this host's `~/.git-credentials` existing.** On a machine
  without it the gate is RED by design: "cannot check" is not a pass (AGENTS.md
  rule 1).
