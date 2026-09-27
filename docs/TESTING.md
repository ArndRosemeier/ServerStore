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

## The writer's differential (3 arms + control)

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

## The full gate, as landed

`bash scripts/gate.sh` → **exit 0** (GREEN). Cheap tier `tsc --noEmit` clean; full
tier **6 test files, 52 tests, ~2.0s**. Raw log: `.gate-logs/gate.log` (gitignored).
Peak: see `docs/BOARD.md`'s LANDED row.

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
