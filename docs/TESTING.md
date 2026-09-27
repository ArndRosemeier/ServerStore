# Testing — the pins, and the probe that proves them

**The test is the statement.** This file does not restate behaviour; it records
*what is pinned*, *what the writer did to prove the pins can go RED*, and *the exact
evidence left behind*.

- The ONE command: `bash scripts/gate.sh` — `0` GREEN · `1` RED · `2` cheap tier only
  (not a pass) · `9` refused, VOID. Raw log: `.gate-logs/gate.log`.
- The suite: `vitest`, `tests/**/*.test.ts`. One fixture set
  (`tests/helpers/server.ts`): a real temp data root, a real SQLite file, a real Hono
  app driven through `app.request()`. **One test file does bind a port** —
  `tests/entrypoint.test.ts` spawns the real entrypoint and talks to it over loopback —
  and every child it starts is killed in an `afterEach`; nothing outside a temp
  directory is written, and the loopback pin additionally *reads* `/proc/net/tcp`.

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
| D1 | The real entrypoint **boots and serves `/healthz`** from the repo's own start command | `tests/entrypoint.test.ts` (`PIN D1`) |
| D2 | The entrypoint listens on **`127.0.0.1` and NOT on `0.0.0.0`** (read from `/proc/net/tcp` + `/proc/net/tcp6`) | `tests/entrypoint.test.ts` (`PIN D2`) |
| D3 | An unauthenticated API call is **refused 401 by the running service** | `tests/entrypoint.test.ts` (`PIN D3`) |
| D4 | **SIGTERM stops the service and leaves no child behind** (no `0A` socket, child reaped) | `tests/entrypoint.test.ts` (`PIN D4`) |
| D5 | The unit file **passes `systemd-analyze verify`** | `tests/deploy.test.ts` (`PIN D5`) |
| D6 | The unit file **does not make the bind host configurable** | `tests/deploy.test.ts` (`PIN D6`) |
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

## The process pins (slice 4, the deployment)

The service's PROCESS contract, pinned where it was previously only reviewed. It was
the honest unknown of slices 1–3: *"No test binds a port or exercises `main.ts`"*.
**D1–D4 close it** — they spawn the real entrypoint and speak HTTP to it.

| # | Pin | Where | How it is checked |
| ---: | --- | --- | --- |
| D1 | the real entrypoint boots and serves `/healthz` from the repo's own start command | `tests/entrypoint.test.ts` | `spawn("node", ["--experimental-strip-types", "src/server/main.ts"])` with `SERVERSTORE_PORT`/`SERVERSTORE_DATA_ROOT`; poll `/healthz` for ≤5s (bounded; the poll also aborts the moment the child EXITS) and assert `200 {"ok":true}` |
| D2 | the entrypoint listens on `127.0.0.1` and NOT on `0.0.0.0` | `tests/entrypoint.test.ts` | the LISTEN (`0A`) sockets on the port, from **both** `/proc/net/tcp` and `/proc/net/tcp6`, must be exactly one, at `127.0.0.1`; an unreadable procfs FAILS with that reason, it never skips |
| D3 | an unauthenticated API call is refused 401 by the running service | `tests/entrypoint.test.ts` | `GET /stores` with no key → `401` and the body's `error.code === "unauthorized"` |
| D4 | SIGTERM stops the service and leaves no child behind | `tests/entrypoint.test.ts` | `SIGTERM`, the child exits **on that signal**, no `0A` socket remains within 5s, and the child is reaped |
| D5 | the unit file passes `systemd-analyze verify` | `tests/deploy.test.ts` | the real binary; a missing one FAILS with that reason |
| D6 | the unit file does not make the bind host configurable | `tests/deploy.test.ts` | no `SERVERSTORE_HOST`/`SERVERSTORE_BIND`/`HOST=` **directive** (comments are stripped first — the unit's header names them in the sentence that forbids them), and the `DEFAULT_HOST` reason must still be present |

Two properties of the machinery are load-bearing and were both learned by failing:
the boot wait is **bounded** (5s, then a failure that prints the child's output), and
**every child is SIGKILLed in `afterEach`** even when a test threw — a backgrounded
server that outlives the suite is the orphan the host rules exist for. The loopback
pin counts only `0A` sockets: after SIGTERM the probe's own sockets sit in `TIME_WAIT`
(`06`) on that port for a minute, and treating a kernel leftover as a listener is a
false failure that never clears.

## The deployment differential (2 arms + two controls)

Machinery: `checkpoints/deploy-differential.sh`. Raw transcript:
`checkpoints/deploy-differential.out` (per-arm raw logs are `*.log`, so gitignored).

Same shape as the core differential above — committed first, the same lock held across
every arm, each file's sha256 printed before and after, restore from `HEAD` in an
`EXIT INT TERM` trap — plus a control BEFORE **and** AFTER, so the arms are
attributable in both directions. **Two harness bugs were found by running it**: the
first version's `restore` knew only the first file it mutated, and a "already restored"
flag then made the second explicit `restore` a no-op — both fixed, and the regression
is recorded in the harness comment rather than quietly repaired.

| Arm | Injected defect | File | sha256 before → after | Went RED on |
| --- | --- | --- | --- | --- |
| D2 | the bind host is `0.0.0.0` (the defect GUARD g1 exists for) | `src/server/config.ts` | `cce5fb08…ef02` → `ff7d1551…743e` | `PIN D2: the entrypoint listens on 127.0.0.1 and NOT on 0.0.0.0` — `expected '0.0.0.0' to be '127.0.0.1'`, on the `/proc/net/tcp` line `[{"ipv4":"0.0.0.0","raw":"00000000","state":"0A"}, …]` |
| D6 | the unit's comment naming `DEFAULT_HOST` is deleted (the realistic "tidied unit" regression: the directives survive, the reasoning does not) | `deploy/serverstore.service` | `27e9c0f9…5d86` → `efa686be…3d3f` | `PIN D6: the unit file does not make the bind host configurable` — `expected '…' to match /DEFAULT_HOST/` |
| control | none — the committed tree, same lock held | — | — | **GREEN** |
| control | none — the restored tree, both files back at their before hashes | — | `cce5fb08…ef02` / `27e9c0f9…5d86` | **GREEN** |

Each arm went red on its OWN named pin and on nothing else, and no hash was unchanged
(a VOID probe would have been refused by the harness).

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

## The mint-authorization pins (slice 7, `POST /keys`)

Slice 6 bounded minting by the minter's OWN permissions (the subset rule); slice 7
**supersedes it with the owner's stricter rule (ledger row 39): only a key holding
`admin` may mint at all.** `Auth.requireAdmin()` is the first thing the route decides —
**before the body is read** — so a non-admin key's request has no side effect. The subset
check is consequently unreachable (`admin` implies every permission) and was **DELETED**;
a future slice that lets a NON-admin key mint must reinstate it in the same commit
(`docs/SEAM-INDEX.md`, "Who may MINT", and the comment in `src/server/app.ts`).

| # | Pin | Where |
| ---: | --- | --- |
| M1 | a NON-admin key cannot mint ANY key, not even one with a SUBSET of its own permissions — 403 `forbidden`, the message says only an admin key may mint, and the key count is UNCHANGED | `tests/keys.test.ts` (`PIN M1`) |
| M2 | a store-scoped ADMIN key mints WITHIN its store — `read` → 201 (store omitted, so the caller's own scope is used) and `read`+`write` → 201; the read child reads (200), the read+write child writes (201) and is refused a DELETE it was not granted (403) | `tests/keys.test.ts` (`PIN M2`) |
| M3 | a store-scoped admin key still cannot mint for another store (403, count unchanged) — nor escape to `*` | `tests/keys.test.ts` (`PIN M3`) |
| M4 | only a MASTER admin key may grant `admin`, and only for scope `*` — the positive (master grants `admin` for `*` → 201, and the child really is a master admin) AND both refusals (a store-scoped admin granting `admin` → 403; a master admin granting `admin` for a NAMED store → 403) | `tests/keys.test.ts` (`PIN M4`) |
| M5 | a master admin key still mints any non-admin permission for any existing store — the bootstrap positive control: `read`+`write`+`delete` → 201, and the child deletes (204) | `tests/keys.test.ts` (`PIN M5`) |

**Which slice-6 pin meanings CHANGED (required by the slice-7 brief).** Slice 6's K1–K3
asserted the subset rule *through the route*; that route no longer reaches it, because a
non-admin minter is refused before any permission check.

- **K1/K2** ("a read-only / no-`delete` key cannot mint what it lacks") keep the same
  OUTCOME — 403 and the count unchanged — but their MEANING changed: they are no longer
  about a missing permission, they are M1's "a non-admin key cannot mint at all", and the
  message changed with it. Replaced by **M1**.
- **K3** ("a key passes on exactly what it holds, and no more") is **gone**, and its
  positive direction is now the opposite: a `read`+`write` key minting `read`+`write` is
  correctly **403** (M1). The minting positive that survives is **M2** — a store-scoped
  ADMIN key minting within its store.
- **K4** ("the boundaries that already held still hold") folded into **M3** (cross-store →
  403) and **M4** (an `admin` grant needs a master admin AND `*`).
- **K5**'s meaning is UNCHANGED — a master admin mints any non-admin permission for any
  existing store — and it is carried forward as **M5**.

The slice-6 arms recorded below are HISTORY: their anchor (`const lacks = …`) no longer
exists in `src/server/app.ts`, so re-running `checkpoints/keys-subset-differential.sh`
would (and should) refuse with a harness failure rather than mutate a line that is not
there.

## The permission-boundary pins (slice 6, `POST /keys`) — SUPERSEDED by slice 7's M1–M5 above

The store boundary of `POST /keys` was already pinned (PIN 2, `tests/auth.test.ts`);
what was **not** pinned — and was wrong — is the PERMISSION boundary. A key is the
principal AND the limit (ledger rows 2, 6, 36), so a key may pass on what it holds and
no more. Measured defect before the fix (ledger row 35): a key minted
`{store:"master", perms:["read"]}` minted `{store:"master", perms:["write","delete"]}`
→ **201**, and the child then wrote (201) and deleted (204).

| # | Pin | Where |
| ---: | --- | --- |
| K1 | a READ-ONLY key cannot mint a permission it does not hold — 403 `forbidden`, the message names it, and the key count is UNCHANGED | `tests/keys.test.ts` (`PIN K1`) |
| K2 | a key lacking `delete` cannot mint `delete` — 403, and nothing was minted | `tests/keys.test.ts` (`PIN K2`) |
| K3 | a key passes on exactly what it holds, and no more — a `read`+`write` key mints `read`+`write` → 201 AND a bare `read` (a legal subset) → 201; the child writes (201) and is refused a DELETE (403) | `tests/keys.test.ts` (`PIN K3`) |
| K4 | the boundaries that already held still hold — another store → 403; `admin` without a master admin key → 403; a master admin key granting `admin` for a STORE (not `*`) → 403 | `tests/keys.test.ts` (`PIN K4`) |
| K5 | a master admin key still mints any non-admin permission for any existing store — the bootstrap positive control: `read`+`write`+`delete` → 201, and the child deletes (204) | `tests/keys.test.ts` (`PIN K5`) |

K3 carries the **subset-not-equality** direction in the same test (the bare-`read`
mint), which is what makes arm B below able to fail it.

## The permission-boundary differential (slice 6, HISTORY — superseded K1–K5)

Machinery: `checkpoints/keys-subset-differential.sh`. Raw transcript:
`checkpoints/keys-subset-differential.out` (per-arm logs are `*.log`, so gitignored).

Same shape as the earlier differentials — the slice is committed FIRST, the same lock
`scripts/gate.sh` takes is held across every arm, each mutated file's sha256 is printed
before and after, restore is `git checkout HEAD --` inside an `EXIT INT TERM` trap, and
a control runs BEFORE **and** AFTER. Both arms mutate the ONE anchored line (the
subset predicate's refusal list) in `src/server/app.ts`.

| Arm | Injected defect | sha256 before → after | Went RED on |
| --- | --- | --- | --- |
| A | the subset check is **DELETED** (`lacks` pinned to `[]`) — the pre-fix behaviour | `f4db030f…cb18` → `dc8ab008…5471` | `PIN K1` — `expected 201 to be 403` (a `read`-only key minted a `write` key), and `PIN K2` — `expected 201 to be 403` |
| B | the check is **STRICTER than correct** — for a non-`admin` minter the requested perms must EQUAL its grantable set, so a legal SUBSET is refused | `f4db030f…cb18` → `5eebf6fa…95d8` | `PIN K3` — `expected 403 to be 201` (`key cannot grant 'read': it does not hold that permission`), the bare-`read` subset mint; **K1/K2/K4/K5 stayed GREEN** |
| control | none — the committed tree, same lock held | — | **GREEN**: 11 files · 80 tests |
| control | none — the restored tree, `app.ts` back at `f4db030f…cb18` | — | **GREEN**: 11 files · 80 tests |

- The two arms are the two directions the rule can be wrong: **absent** (A) and
  **over-strict** (B). Arm A proves K1/K2 are not vacuous; arm B proves K3 is not,
  because a check that simply refused everything would have satisfied A's pins.
- **Arm B is SURGICAL, and the harness enforces it.** Its first draft demanded
  equality for *every* minter; because a master admin holds `admin`, which can never
  EQUAL a non-admin request, that draft also broke the bootstrap path and reddened
  every fixture that mints through HTTP (K4, K5, PIN 2, PIN 5 and two registry tests) —
  proving "arm B breaks many things" rather than "K3 catches over-strictness". The arm
  now leaves the `admin` branch carrying the correct subset behaviour on purpose, and
  the harness asserts that ONLY K3 may fall (`× PIN K(1|2|4|5)` in the arm log is a
  HARNESS FAILURE). Observed: exactly one failing K-pin, K3, and both controls GREEN.
- No hash was unchanged (a VOID probe would have been refused by the harness), the two
  arms produced DIFFERENT hashes, and both controls are GREEN — so the injection, and
  nothing else, was the difference.

## The mint-authorization differential (2 arms + two controls)

Machinery: `checkpoints/mint-admin-differential.sh`. Raw transcript:
`checkpoints/mint-admin-differential.out` (per-arm raw logs are `*.log`, so gitignored).

Same shape as the earlier differentials — the slice is committed FIRST, the same lock
`scripts/gate.sh` takes is held across every arm, each mutated file's sha256 is printed
before and after, restore is `git checkout HEAD --` inside an `EXIT INT TERM` trap, and
a control runs BEFORE **and** AFTER. Both arms rewrite the ONE anchored line — the
`auth.requireAdmin()` call — in `src/server/app.ts`.

| Arm | Injected defect | sha256 before → after | Went RED on |
| --- | --- | --- | --- |
| A | the admin requirement is **DELETED** (any key may mint again) | `00f477d8…3528` → `11e2e60c…f8ed` | `PIN M1` — `expected 201 to be 403` (a `read`-only key minted a `read` key); **M2/M5 stayed GREEN** |
| B | the rule is **STRICTER than correct** — an admin minter must ALSO be a MASTER admin, so a store-scoped admin key is refused | `00f477d8…3528` → `9e0c9588…1808` | `PIN M2` — `expected 403 to be 201` (`this operation requires a master admin key`); **M1/M3/M4/M5 stayed GREEN** |
| control | none — the committed tree, same lock held | — | **GREEN**: 11 files · 80 tests |
| control | none — the restored tree, `app.ts` back at `00f477d8…3528` | — | **GREEN**: 11 files · 80 tests |

- The two arms are the two directions the rule can be wrong: **absent** (A) and
  **over-strict** (B). Arm A proves M1 is not vacuous; arm B proves M2 is not — and,
  because M1 and M5 stay green while M2 falls, it proves M2 tells a STORE-SCOPED admin
  apart from a MASTER admin rather than the slice having simply broken the flow.
- **Arm B is SURGICAL, and the harness enforces it.** Its first draft replaced the call
  with a bare `auth.requireMasterAdmin()`, which also changed the NON-admin refusal
  message and so reddened M1 as well — proving "arm B breaks many things" rather than
  "M2 catches over-strictness". The arm now leaves the non-admin branch carrying the
  correct refusal (and its message) on purpose; the harness asserts that ONLY M2 may
  fall (`× PIN M1`/`× PIN M5` in the arm log is a HARNESS FAILURE). Observed: exactly
  one failing M-pin, M2, and both controls GREEN.
- No hash was unchanged (a VOID probe would have been refused by the harness), the two
  arms produced DIFFERENT hashes, and both controls are GREEN — so the injection, and
  nothing else, was the difference.

## The key-scope pins (slice 8, `POST /keys` + `GET /whoami`)

Slice 8 (ledger rows 30, 41, 42) gives a key a SCOPE: a SET of stores. It is stored as
`access_keys.scope_all` — the `["*"]` master case, which no foreign key can hold — plus
one `key_stores` row per store (an FK per store, so a stored scope can never name a
missing one); loaded ONCE by `resolveKey` (no N+1 in `authorize`, which only reads the
record it was handed); and tested in ONE place, `Auth.authorize`. The wire changed from
`store: string` to `stores: string[]`, `GET /whoami` is new, and a row written in the
OLD single-store shape is MIGRATED then the column is dropped.

| # | Pin | Where |
| ---: | --- | --- |
| G1 | a key scoped to `[a,b]` reads and writes `a` and `b`, and is REFUSED `c` — 403 with the key's ACTUAL scope in the message, and `c`'s bytes and rows untouched | `tests/keys.test.ts` (`PIN G1`) |
| G2 | a scoped ADMIN key mints only inside its own SET — 201 for a store in its set (and for the whole set), 403 for a store outside it (naming both sets), 403 for a partially-outside list, 403 for `["*"]`, and NO key row and NO scope row on any refusal | `tests/keys.test.ts` (`PIN G2`) |
| G3 | `POST /keys` rejects an EMPTY list (`400 invalid_scope`), a MIXED `["*",a]` list (`400 invalid_scope`) and a store that does not exist (`404 not_found`), each with nothing minted; the OLD `store` field is `400 bad_request` naming `stores` | `tests/keys.test.ts` (`PIN G3`) |
| G4 | `GET /whoami` returns `id`, `label`, `stores` and `perms` (plus `expiresAt`/`lastUsedAt`) — the body carries EXACTLY those keys and never the raw key — and is 401 without a key | `tests/keys.test.ts` (`PIN G4`) |
| G5 | a master key (`["*"]`) spans every store INCLUDING one created AFTER it was minted, and only a master may grant `admin`: master + `["*"]` → 201 (and the child administers stores), a scoped admin → 403, a named store → 403 | `tests/keys.test.ts` (`PIN G5`) |
| G6 | a key row written in the OLD single-store shape still authorizes exactly as before: the old column is GONE, `store='*'` became `scope_all`, a named store became one `key_stores` row, the legacy scoped key works in its store (201/200) and is refused another (403), and a legacy `*` key spans every store | `tests/keys.test.ts` (`PIN G6`) |

The M1–M5 pins above keep their meaning (only an `admin` key may mint; a scoped admin
mints within its set; an `admin` grant needs a master admin and `["*"]`), and PIN 2
(`tests/auth.test.ts`) is now the **single-store case of the same membership test** G1
exercises with a set.

## The key-scope differential (2 arms + two controls)

Machinery: `checkpoints/key-stores-differential.sh`. Raw transcript:
`checkpoints/key-stores-differential.out` (per-arm logs are `*.log`, so gitignored).

Same shape as the earlier differentials — the slice is committed FIRST, the same lock
`scripts/gate.sh` takes is held across every arm, each mutated file's sha256 is printed
before and after, restore is `git checkout HEAD --` inside an `EXIT INT TERM` trap, and a
control runs BEFORE **and** AFTER. Each arm edits ONE anchored line in a DIFFERENT file,
so the harness can refuse a VOID probe (an unchanged hash, or two arms with the same hash).

| Arm | Injected defect | File | sha256 before → after | Went RED on |
| --- | --- | --- | --- | --- |
| A | `authorize` IGNORES the store set (`… && false`), so a scoped key spans everything — the AUTHORIZE half | `src/server/app.ts` | `921e3f32…2101` → `12a37481…a243e5` | `PIN G1: a key scoped to [a,b] reads and writes a and b, and is refused c` — `expected 200 to be 403` (the cross-scope READ reached `c`); **G2/G3 stayed GREEN** (the MINTING branch is untouched, so the arm did not simply break the tree) |
| B | the MIGRATION skips the legacy row (the `INSERT INTO key_stores … SELECT …` is dropped), so a pre-existing key loses its scope — the MIGRATION half | `src/core/db.ts` | `1c715908…d76a` → `fa0976a8…1b53` | `PIN G6: a key row written in the OLD single-store shape still works after the migration` — `expected [] to deeply equal [ { store: 'alpha' } ]` (the scope row was never written); **G1/G2/G4/G5 stayed GREEN** |
| control | none — the committed tree, same lock held | — | — | **GREEN**: 11 files · 86 tests |
| control | none — the restored tree, both files back at their before hashes | — | `921e3f32…2101` / `1c715908…d76a` | **GREEN**: 11 files · 86 tests |

- The arms are the two halves of the ONE seam, in opposite directions: AUTHORIZE (A) and
  MIGRATION (B). **Arm B is what proves the migration is REAL rather than asserted** — the
  pin is not "the old column is gone", it is "the carried-over SCOPE still authorizes
  exactly as before", and dropping only the data half reddens it.
- **Arm A also reddens PIN 2 and PIN G6, and that is recorded rather than hidden:** all
  three stand on the same membership predicate, so removing it necessarily reddens them.
  The harness asserts only what the arm can isolate (G2/G3 GREEN), and the slice-2 lesson
  is applied in the honest direction: the claim is "G1 catches `authorize` ignoring the
  set", not "only G1 fell". PIN 2 is the single-store case of the same predicate; G6's
  behavioral half asks the migrated key to be refused a store outside its scope.
- No hash was unchanged (a VOID probe would have been refused by the harness), the two arms
  produced DIFFERENT hashes in DIFFERENT files, and both controls are GREEN — so the
  injection, and nothing else, was the difference.

The doc a **client developer** reads is `docs/API.md`, and it is held to the code by
`tests/api-doc.test.ts` — the truth is DERIVED, never restated. Both directions matter:
the doc may not omit a route and may not invent one.

| # | Pin | Where | How it is checked |
| ---: | --- | --- | --- |
| A1 | every route the app registers is in the API doc, and every route in the doc is registered | `tests/api-doc.test.ts` | the `METHOD /path` set from `createApp({dataRoot, dbPath}).routes` (middleware filtered: it registers as method `ALL` on `/*`) versus the doc's `## Routes` table, compared in BOTH directions; the doc's `{store}`/`{name}` placeholders are normalised to Hono's `:store`/`:name` by the test |
| A2 | every code in `ERROR_CODES` appears in the doc's error table | `tests/api-doc.test.ts` | the `## Errors` table must contain every `ERROR_CODES` entry **and** nothing outside it, each with the status the code maps to (`new StoreError(code, "probe").status`, so the statuses are the code's own, never retyped) |
| A3 | the doc's stated max-bytes default equals the code's | `tests/api-doc.test.ts` | the `## Limits` row's byte value **and** its MiB rendering versus `DEFAULT_MAX_BYTES` **imported** from `src/server/config.ts` |

A missing `## Routes`/`## Errors`/`## Limits` section, or a row in an unparseable
shape, makes the pin **throw** — never pass vacuously: a check that cannot read the doc
must say so (AGENTS.md rule 1).

## The client-contract differential (4 arms + two controls)

Machinery: `checkpoints/api-doc-differential.sh`. Raw transcript:
`checkpoints/api-doc-differential.out` (per-arm raw logs are `*.log`, so gitignored).

Same shape as the earlier differentials: the slice is committed FIRST, the same lock
`scripts/gate.sh` takes is held across every arm, each mutated file's sha256 is printed
before and after, restore is `git checkout HEAD --` inside an `EXIT INT TERM` trap, and
a control runs BEFORE **and** AFTER.

| Arm | Injected defect | File | sha256 before → after | Went RED on |
| --- | --- | --- | --- | --- |
| R | a NINTH route, `app.get("/ping", …)`, registered and absent from the doc | `src/server/app.ts` | `99367879…22e4` → `f20fc393…eae6` | `PIN A1: every route the app registers is in the API doc, and every route in the doc is registered` — `expected [ 'GET /ping' ] to deeply equal []` |
| D | a fake row (`GET /ping`) added to the doc's route table | `docs/API.md` | `f0d0aa87…edcb` → `5342d862…109e` | `PIN A1: …` (the doc→code direction) — `expected [ 'GET /ping' ] to deeply equal []` |
| E | the doc renames an error code, `unauthorized` → `unautorized` | `docs/API.md` | `f0d0aa87…edcb` → `52bf4ad2…404d` | `PIN A2: every code in ERROR_CODES appears in the doc's error table` — `expected [ 'unauthorized' ] to deeply equal []` |
| M | the doc's stated `SERVERSTORE_MAX_BYTES` default changed to `1024` | `docs/API.md` | `f0d0aa87…edcb` → `e1f79bc1…a36f` | `PIN A3: the doc's stated max-bytes default equals the code's` — `expected 1024 to be 67108864` |
| control | none — the committed tree, same lock held | — | — | **GREEN**: 10 files · 75 tests |
| control | none — the restored tree, both files back at their before hashes | — | `99367879…22e4` / `f0d0aa87…edcb` | **GREEN**: 10 files · 75 tests |

Arms R and D are the SAME pin in OPPOSITE directions — the reason A1 is pinned both
ways; arms E and M mutate the SAME file to DIFFERENT hashes and different named pins.
No hash was unchanged (a VOID probe would have been refused by the harness), and each
arm went RED on its own named pin and nothing else.

## The key-lifecycle pins (slice 9, `GET /keys` + `POST /keys/:id/revoke`)

Slice 9 (ledger row 46) makes the key lifecycle self-service: `GET /keys` is the admin
inventory and `POST /keys/:id/revoke` is the revoke route. Both are admin-only and reuse
the SAME scope-containment predicate the mint boundary already enforces
(`Auth.holdsStores`); `Auth.requireAdmin(action)` now carries the action in its message,
so mint, list and revoke share ONE "who may administer keys" predicate.
`src/core/keys.ts` `listKeys()` is the read seam (two queries whatever the population,
revoked keys included so the inventory is also the audit view).

| # | Pin | Where |
| ---: | --- | --- |
| L1 | `GET /keys` is admin-only (401 without a key, 403 for a valid non-admin) and its body contains NEITHER the raw key NOR its secret NOR its stored `sha256` — with every entry carrying EXACTLY the documented nine fields, so a secret field cannot be added silently | `tests/keys.test.ts` (`PIN L1`) |
| L2 | a store-scoped admin lists only the keys whose scope lies inside its OWN set (its own key included) and a master lists EVERY key | `tests/keys.test.ts` (`PIN L2`) |
| L3 | a revoked key is refused `401` on the NEXT request on the same running app — no restart, no cache | `tests/keys.test.ts` (`PIN L3`) |
| L4 | a store-scoped admin cannot revoke a key outside its scope (403, and the target is STILL USABLE), cannot revoke a MASTER key (403, master still administers), and cannot revoke an in-scope key holding `admin` (403) — with a POSITIVE control that it CAN revoke an in-scope non-admin key | `tests/keys.test.ts` (`PIN L4`) |
| L5 | revoke is idempotent: the first call is `changed: true`, the second is `changed: false` with the FIRST `revokedAt`, and the row really holds that timestamp | `tests/keys.test.ts` (`PIN L5`) |
| L6 | an unknown id is `404 not_found`; a NON-admin gets `403` first and learns nothing; and a key may revoke ITSELF — the store-scoped-admin case is the interesting one, since its own key holds `admin` — taking effect on the next request | `tests/keys.test.ts` (`PIN L6`) |

**The clock is advanced between L5's two calls on purpose.** The fixture's clock is
frozen, so a buggy implementation that overwrote `revoked_at` on a second call would
write the same instant and "the timestamp did not move" would be vacuously true. L5
moves the clock, so the frozen timestamp is evidence.

**The prefix decision.** `GET /keys` RETURNS `prefix`. It is `ssk_` plus the first 8
characters of the (already public) `id` — 12 characters, the stored
`DISPLAY_PREFIX_LENGTH` — so it carries no secret byte: the secret starts after the id.
It is returned so a console shows the same handle the operator saw at mint without
re-deriving the rendering. L1 pins the absence of the FULL key, the SECRET half and the
HASH, which is the material that matters; `prefix` is deliberately inside that boundary.
(`GET /whoami` still returns no prefix at all: it is the caller asking about itself.)

## The key-lifecycle differential (2 arms + two controls)

Machinery: `checkpoints/key-lifecycle-differential.sh`. Raw transcript:
`checkpoints/key-lifecycle-differential.out` (per-arm raw logs are `*.log`, so
gitignored).

Same shape as the earlier differentials: the slice is committed FIRST (code tip
`7cc3afe` — the pre-rebase `534189c`, which the CONTROL line in the raw transcript names,
replayed by the pre-push rebase with an EMPTY content delta), the same lock
`scripts/gate.sh` takes is held across every arm, the mutated
file's sha256 is printed before and after, restore is `git checkout HEAD --` inside an
`EXIT INT TERM` trap, and a control runs BEFORE **and** AFTER. Both arms inject into
`src/server/app.ts` — the listing projection and the revoke boundary — and the harness
now ALSO fails an arm whose TYPECHECK breaks, because a tree that does not compile
proves nothing about a pin.

| Arm | Injected defect | sha256 before → after | Went RED on |
| --- | --- | --- | --- |
| A | `GET /keys` INCLUDES the stored hash (a `hash` field added to every entry) — the inventory carries key material | `d8a056dc…b86ef` → `fd7f35a8…73df` | `PIN L1: GET /keys is admin-only and returns NO key material` — `expected '{"keys":…}' not to contain '<sha256>'` |
| B | the REVOKE scope rules are IGNORED (`if ((false as boolean)) {`), so a scoped admin may revoke outside its scope and may revoke a master key | `d8a056dc…b86ef` → `0be47025…bbd5` | `PIN L4: a scoped admin cannot revoke outside its own scope, and cannot revoke a master key` — `expected 200 to be 403` |
| control | none — the committed tree, same lock held | — | **GREEN**: 11 files · 92 tests |
| control | none — the restored tree, `app.ts` back at its before hash | `d8a056dc…b86ef` (back) | **GREEN**: 11 files · 92 tests |

- The arms are the two halves of the slice in OPPOSITE directions: LEAK (A) and
  BOUNDARY (B). Arm A leaves the revoke boundary alone, so L2–L6 stay GREEN — that is
  the anti-vacuity direction; arm B leaves the listing projection alone, so L1/L2 stay
  GREEN, and the revoke mechanics it does not remove (idempotency L5, the 404 and
  self-revocation L6) survive.
- **Arm B's FIRST DRAFT was a literal `&& false`, and it broke the TYPECHECK** —
  `TS18047: 'target' is possibly 'null'` on three lines, because the constant condition
  collapses the earlier `if (target === null) throw` narrowing. That would have proved
  "the tree does not compile", not "L4 sees the missing boundary", so the arm was made
  surgical with `false as boolean` (which keeps the injected condition typecheck-clean)
  and the harness now asserts the arm's cheap tier carries no `error TS`. The discarded
  draft is recorded here rather than quietly fixed (the row-25/37 lesson).
- No hash was unchanged (a VOID probe would have been refused by the harness), the two
  arms produced DIFFERENT hashes from the same before-hash, and both controls are GREEN
  — so the injection, and nothing else, was the difference.

## The admin-UI pins (slice 10, U1–U4)

Slice 10 (ledger row 49) serves the owner's admin console from the **same origin** as
the API, as **no-build** assets: `GET /` (HTML), `GET /app.js` (one ES module, plain
JavaScript) and `GET /app.css`. `src/server/assets.ts` `UI_ASSETS` is the WHOLE static
surface — three literal routes, each naming its file under `web/` literally, with no
directory walking and no client-supplied string in a path. The routes are registered
beside `/healthz`, **before** the key guard, because the console itself must load
without a key (it is the page that asks for one) and `GET /whoami` is what proves the
key; `GET /` is a literal path, so it is not a catch-all and shadows no API route.

| # | Pin | Where |
| ---: | --- | --- |
| U1 | the three UI routes are SERVED — `GET /` is 200 HTML, `/app.js` and `/app.css` carry sane content types — and the served bytes carry no key-shaped string; `GET /stores` is still `401` and an unknown path is still the API's envelope, so `GET /` shadows nothing | `tests/admin-ui.test.ts` (`PIN U1`) |
| U2 | a scan of the SERVED `app.js` references none of `localStorage`, `sessionStorage`, `document.cookie`, `location.search`, `location.hash`, `history.pushState` — the key is memory-only | `tests/admin-ui.test.ts` (`PIN U2`) |
| U3 | every path literal the SERVED `app.js` calls matches a route from `createApp(...).routes` (a template's `${…}` normalised to `:id`), so a renamed route breaks the pin instead of the operator's click | `tests/admin-ui.test.ts` (`PIN U3`) |
| U4 | the HTML loads no remote script or asset, carries no inline `<script>` body, and no key-shaped string | `tests/admin-ui.test.ts` (`PIN U4`) |

`registeredRoutes()` now lives in the ONE fixture set (`tests/helpers/server.ts`) and is
read by BOTH `tests/api-doc.test.ts` (PIN A1, doc vs code) and `tests/admin-ui.test.ts`
(PIN U3, UI paths vs code): the route-set derivation exists ONCE, so the doc, the UI and
the code cannot drift on three different copies of it. The path scan reads comments too
— a path named in prose is still a claim about routes.

**HONEST UNKNOWN, named in the brief and repeated here: none of these pins executes the
console.** Plain JavaScript is not typechecked by the cheap tier at all (tsconfig covers
`src/**` and `tests/**`), and U1–U4 are static scans of the served bytes plus the served
status/content-type checks. The UI's behaviour IN a browser — that a click really mints,
that `whoami` really gates the rest, that the copy button works, that the layout is
usable on a phone — is **NOT exercised by any automated check**. A **headless-browser
test is OWED** and is explicitly not v1 (ledger row 48): the host rule that a browser is
a process TREE whose kill belongs in a `trap` makes it a slice of its own.

## The admin-UI differential (2 arms + two controls)

Machinery: `checkpoints/admin-ui-differential.sh`. Raw transcript:
`checkpoints/admin-ui-differential.out` (per-arm raw logs are `*.log`, so gitignored).

Same shape as the earlier differentials — the slice is committed FIRST (code tip
`20e2f75`, which the CONTROL line in the raw transcript names), the same lock
`scripts/gate.sh` takes is held across every arm, `web/app.js`'s sha256 is printed
before and after each arm, restore is `git checkout HEAD --` inside an `EXIT INT TERM`
trap, and a control runs BEFORE **and** AFTER. Both arms inject into `web/app.js` — the
one file the console IS — in opposite directions: PERSISTENCE (A) and ROUTES (B).

| Arm | Injected defect | File | sha256 before → after | Went RED on |
| --- | --- | --- | --- | --- |
| A | the key is written to a browser store (`localStorage.setItem` beside the ONE assignment to `key`) | `web/app.js` | `6e1b862b…d128` → `1619558c…d247` | `PIN U2: the served app.js references no key-persistence API` — `expected [ 'localStorage' ] to deeply equal []`; U1/U3/U4 stayed GREEN |
| B | the console calls a path no route registers (`fetch("/no-such-route")` appended) | `web/app.js` | `6e1b862b…d128` → `3c977fbd…88f8` | `PIN U3: every path the UI calls is a route the API registers` — `expected [ '/no-such-route' ] to deeply equal []`; U1/U2/U4 stayed GREEN |
| control | none — the committed tree, same lock held | — | — | **GREEN**: 12 files · 96 tests |
| control | none — the restored tree, `app.js` back at its before hash | — | `6e1b862b…d128` | **GREEN**: 12 files · 96 tests |

- The two arms are the two claims U2 and U3 make about the SAME served file, and they
  are independent: A leaves every path literal alone, B leaves the key handling alone,
  so each pin reddens on its own arm and neither is vacuous.
- No hash was unchanged (a VOID probe would have been refused by the harness), the two
  arms produced DIFFERENT hashes from the SAME before-hash, and both controls are GREEN
  — so the injection, and nothing else, was the difference.
- **What these arms do NOT prove** is the honest unknown above: an arm here shows the
  STATIC scan catches a class of defect; no arm runs the page.

## The full gate

`bash scripts/gate.sh` is the ONE command; exit `0` (GREEN) means both tiers passed.
Raw log: `.gate-logs/gate.log` (gitignored). This doc deliberately carries **no test
count**: a tally restated in prose goes stale inside its own landing (ledger row 22
deleted one for exactly that), so the LANDED row on `docs/BOARD.md` records the numbers
for the specific landing it verified.

## What is NOT tested yet (honest unknowns)

- **The admin UI's in-browser behaviour.** U1–U4 scan the SERVED bytes and the served
  status/content types; NOTHING executes `web/app.js` in a browser, and plain JS is not
  typechecked (ledger row 48 accepted this price knowingly). The pins catch a persisted
  key, a secret in the served bytes and a path that is not a registered route; they
  cannot catch a logic error inside a handler a click reaches. **A headless-browser test
  is OWED and is not v1** — and it must kill its process TREE in a `trap`, because one
  headless Chrome run leaves dozens of processes behind.
- **No concurrency test.** Two writers racing the same object name are handled by an
  upsert, but nothing exercises it. Unproven rather than claimed.
- **RETIRED: "no test binds a port or exercises `main.ts`".** D1–D4 now spawn the real
  entrypoint and speak HTTP to it over loopback, so the loopback binding is a pin and
  not "a code constant plus a review". What remains unproven about the deployment is
  everything that only exists ON THE HOST: the unit has never been installed, so
  nothing has exercised `Restart=on-failure`, the cloudflared ingress, or the live
  hostname. `scripts/probe-live.sh` is the command that will check the last of those,
  and its live run is a step in `docs/DEPLOYMENT.md`, not a test.
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
- **The scope migration's LOUD failure path is unexercised.** G6 migrates a legacy row
  whose store exists; a legacy row naming a store that has since vanished makes the
  `key_stores` foreign key fail (wrapped in a boot-time error, deliberately — see
  `migrateLegacyKeyScope`), and nothing asserts that message. It cannot happen today
  through the API (there is no store-delete route and `POST /keys` refused a missing
  store before this slice too), which is exactly why it is declared rather than claimed.
- **`GET /whoami`'s `lastUsedAt` is the CURRENT request's timestamp.** `touchKey` now
  returns the value it wrote and the guard puts it on the record, so the field is never
  the previous call's — pinned only implicitly by G4's `typeof string`; the exact
  equality is not asserted against a clock.
- **The key lifecycle's 404-vs-403 oracle for KEYS.** The brief fixes the order — an
  unknown id is `404`, a key outside the caller's scope is `403` — so a store-scoped
  admin can tell "no such key" from "not yours". That is a deliberate, recorded shape
  (it mirrors `requireStore()` before `authorize()` on the object routes, ledger row 33
  finding (d)), not a claim that it leaks nothing. Key ids are public lookup ids and a
  scoped admin can already list the keys inside its own set.
- **No pagination, filter, sort or search on `GET /keys`** (ledger row 46): the
  population is the operator's keys and one response is the whole inventory. If that
  stops being true, the route grows a cursor and this line changes with it.
- **Self-revoking the last admin key is irreversible over HTTP.** L6 pins that
  self-revocation works and takes effect immediately; nothing warns the caller, and the
  only recovery is minting another admin key from the box (`pnpm run admin:key`, ledger
  row 7). Recorded as a known consequence, not a defect.
- **A revoked key's `lastUsedAt` is frozen at its last successful request.** Nothing
  clears it and nothing tests it; it is the honest reading of the column.
