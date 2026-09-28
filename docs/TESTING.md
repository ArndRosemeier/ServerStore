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

Same shape as the earlier differentials — the slice is committed FIRST (the transcript's
CONTROL line names the pre-rebase code tip `20e2f75`, which the pre-push rebase replayed
as `0570fc2` with an EMPTY content delta), the same lock
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

## The key-edit pins (slice 11, E1–E8, `PATCH /keys/:id`)

Slice 11 (ledger rows 51, 52) adds the **second granting door**: `PATCH /keys/:id`
rewrites what a key **holds** (`label`, `stores`, `perms`) and never what it **is**. It
reuses the SAME boundary as minting — `Auth.requireAdmin` for WHO may grant,
`Auth.holdsStores` for the store boundary, `parseStores`/`parsePermissions`/the label
rule for validation — and the write itself is ONE transaction in
`src/core/keys.ts editKey()`. Two schema columns (`updated_at`, `updated_by`) carry the
audit stamp, added by an idempotent add-if-absent migration.

| # | Pin | Where |
| ---: | --- | --- |
| E1 | an edit changes **exactly** the fields given, and nothing else: a rename leaves stores and perms untouched, a perms-only edit leaves the label and stores untouched, a stores-only edit leaves label and perms untouched and REPLACES (does not merge) the scope — and `id`/`key_hash`/`prefix`/`created_at` are byte-identical throughout | `tests/keys.test.ts` (`PIN E1`) |
| E2 | an editor may grant only what it could have minted — a store-scoped admin CAN edit inside its set (the positive control), but is refused **403** for: widening into a store it does not hold, escaping to `["*"]`, granting `admin`, a key outside its set, and a PEER ADMIN key inside its set (rename and demotion both) — with the target's whole stored state unchanged after every refusal, and the master half: adding `admin` without `["*"]` is 403, adding it with `["*"]` works | `tests/keys.test.ts` (`PIN E2`) |
| E3 | a **REVOKED** key cannot be edited back to life — every kind of edit (rename, perms, stores, all three) is **403** naming the revocation, `revoked_at` does not move, the row is otherwise untouched, and the key is still `401` on its next request | `tests/keys.test.ts` (`PIN E3`) |
| E4 | an edit is **stamped and visible** — a never-edited key reports `updatedAt`/`updatedBy` as `null` in `GET /keys`, and after an edit both hold the edit instant and the **caller's** key id (a distinct editor key proves it is neither the target's nor the master's); a second edit MOVES the timestamp (the clock is advanced, so the claim is not vacuous); the row really holds the stamp; the response carries no raw key and no hash | `tests/keys.test.ts` (`PIN E4`) |
| E5 | a non-admin key cannot edit anything — `401` without a key, `403` for a verified non-admin whatever field it sends (the message says only an admin key may edit keys), not even its own row, and nothing changes | `tests/keys.test.ts` (`PIN E5`) |
| E6 | an edit does **NOT** change the key's value — the SAME raw key still authenticates afterwards and reports the NEW grant (writes and deletes in the new store, refused in the old one), `id`/`key_hash`/`prefix`/`created_at` are byte-identical, and the response carries no key material | `tests/keys.test.ts` (`PIN E6`) |
| E7 | a body with no recognised field is refused (`400`) and **nothing changes** — an empty object, the old `store` field, an unknown field BESIDE a valid one (the whole request is refused, so the valid field is not applied), a non-object body, no body, and the mint-identical validation refusals (empty/mixed `stores`, empty/unknown `perms`, a store that does not exist) | `tests/keys.test.ts` (`PIN E7`) |
| E8 | a database that predates the audit columns is migrated **add-if-absent** — the columns are DROPPED from a real database, the next boot adds them back, a third boot changes nothing, and the migrated column is usable through the route (a pre-C2 key is "never changed", then stamped by an edit) | `tests/keys.test.ts` (`PIN E8`) |

**E8 is added beyond the brief's E1–E7, deliberately.** The audit columns are a schema
change on the LIVE database, and this project's rule for a migration is that it is
**real rather than asserted** (B1's G6, ledger row 22's lesson). A pin that read the
`CREATE TABLE` would prove nothing for the file the service actually opens.

**PIN L1's exact-field list changed in the same commit**: the `GET /keys` entry gained
`updatedAt` and `updatedBy`, so the list-of-exactly-nine-fields assertion is now
eleven. That is the only edit-pin interaction with the existing suite, and it is stated
rather than left for a reader to discover.

**The judgement call E2 records.** The brief's E2 names the widen/grant cases. The
implementation reads the ONE containment predicate **four** times for a store-scoped
admin — target scope, target `admin`, result scope, result `admin` — because "an editor
may grant only what it could have minted" also has to stop a scoped admin **demoting a
peer admin key**, which a result-only rule would allow. It is the revoke boundary's own
"only keys it could have minted" shape (row 46), so it is still ONE seam. PIN E2 pins
both the rename and the demotion refusal.

## The key-edit differential (2 arms + two controls)

Machinery: `checkpoints/key-edit-differential.sh`. Raw transcript:
`checkpoints/key-edit-differential.out` (per-arm raw logs are `*.log`, so gitignored).

Same shape as the earlier differentials — the slice is committed FIRST (the transcript's
CONTROL line names the pre-rebase code tip `5273c89`, which the pre-push rebase replayed
as `3f0a866` with an EMPTY content delta — `git diff --stat 5273c89 3f0a866 -- src tests
web docs/API.md docs/SEAM-INDEX.md checkpoints/key-edit-differential.sh` is empty — so the
gate and the arms ran on exactly the code that lands), the same lock `scripts/gate.sh`
takes is held across every arm, each mutated file's sha256 is printed before and after,
restore is `git checkout HEAD --` inside an `EXIT INT TERM` trap, and a control runs
BEFORE **and** AFTER. The restore names **every** file an arm touches **and `web/`** —
the console is part of this slice and exists now, and a restore that knows only today's
two source files is exactly the bug `deploy-differential.sh` already paid for. Both arms
mutate a DIFFERENT file, so the harness can refuse a VOID probe.

| Arm | Injected defect | File | sha256 before → after | Went RED on |
| --- | --- | --- | --- | --- |
| A | the edit **RE-MINTS the key's value** — `editKey` rotates the row's `key_hash` to the hash of a brand-new raw key, so "edit" behaves like re-mint and the holder's credential stops working | `src/core/keys.ts` | `e85264ac…e669` → `68e4edbc…9b01` | `PIN E6: an edit does NOT change the key's value` — `expected 401 to be 200` (the same raw key no longer authenticates). **E1 and E2 fall with it, recorded rather than hidden**: every pin that authenticates with the same raw key after an edit MUST fall when the value changes — that is the defect, not a second one. **E3/E4/E5/E7/E8 stayed GREEN** |
| B | the **REVOKED-key refusal is removed** (`if ((false as boolean)) {`), so a revoked key can be edited — and therefore revived | `src/server/app.ts` | `87eabf30…3478` → `1bd4c3d2…417d` | `PIN E3: a REVOKED key cannot be edited back to life` — `expected 200 to be 403`; **E4/E5/E6/E7/E8 stayed GREEN** |
| control | none — the committed tree `5273c89`, same lock held | — | — | **GREEN**: 12 files · 104 tests |
| control | none — the restored tree, both files back at their before hashes | — | `e85264ac…e669` / `87eabf30…3478` | **GREEN**: 12 files · 104 tests |

- The two arms are the two facts that give "edit in place" its meaning, in opposite
  directions: the VALUE must survive (A) and REVOCATION must stay terminal (B). Neither
  arm leaves its own half red by accident: A keeps E3 green, B keeps E6 green.
- **Arm A's collateral is the honest part.** It reddens THREE pins (E1, E2, E6) and the
  FAIL lines are exactly those three; the harness's anti-vacuity assertion is the set
  that SURVIVES (E3, E4, E5, E7, E8 and the whole earlier suite), not "only E6 fell". The
  named pin the brief required — E6 — is among them.
- **The harness's red-metric reads BOTH forms of a failure** (`× <pin>` in the suite tree
  and `FAIL … > <pin>` in the failure block) via `pin_red()`. The earlier harnesses
  matched only the `×` form; row 50 fixed the dispatcher's metric for the same reason, and
  this harness starts corrected. A pin that cannot be SEEN to fail is a pin that cannot be
  relied on (row 25).
- No hash was unchanged (a VOID probe would have been refused by the harness), the two
  arms produced DIFFERENT hashes in DIFFERENT files, both files were restored
  byte-identical, and both controls are GREEN — so the injection, and nothing else, was
  the difference.

## The CORS pins (slice 12, O1–O6 + D7)

Slice 12 (ledger row 57) makes this API answer a browser on **another origin**. The trap
is the ORDER: the key guard matches EVERY path before routing, so a preflight that
reached it would be `401` and the browser would block the real request. The CORS step is
therefore registered BEFORE `app.use("*", guard)` and answers a preflight itself. It is
**middleware, not a route**, so the registered route table — and PIN A1's comparison
against `docs/API.md` — is unchanged.

| # | Pin | Where |
| ---: | --- | --- |
| O1 | a preflight is answered **2xx WITHOUT a key** — `OPTIONS` + `Access-Control-Request-Method` gets `204` with `Allow-Methods` naming GET/POST/PUT/PATCH/DELETE/OPTIONS, `Allow-Headers` naming **`authorization` as a whole word** (never `*`) plus `x-api-key`/`content-type`, and a positive `Max-Age`; it is answered before ROUTING (a route with no `OPTIONS` method still gets it); an `OPTIONS` **without** `Access-Control-Request-Method` is not a preflight and still `401`s | `tests/cors.test.ts` (`PIN O1`) |
| O2 | a cross-origin request with a valid key is **readable** — `GET /stores` with `Origin` + a key returns `200` and the REAL body plus `Access-Control-Allow-Origin`; a cross-origin object `GET` carries `x-serverstore-sha256` **and** the `Expose-Headers` that lets a browser read it | `tests/cors.test.ts` (`PIN O2`) |
| O3 | an allowlist is honoured — a listed origin is echoed (the CONCRETE origin) with `Vary: Origin`; an unlisted origin gets **no** allow-origin header and is **not** `403` (the API answers normally and the BROWSER blocks); a preflight from the listed origin is `204` echoing it, an unlisted one is not authorised | `tests/cors.test.ts` (`PIN O3`) |
| O4 | credentials are never allowed — no response of any kind carries `Access-Control-Allow-Credentials` and none sets a cookie, across BOTH policies and across preflights, keyed responses, `401`s, a `404`, `/healthz` and the UI | `tests/cors.test.ts` (`PIN O4`) |
| O5 | nothing else changed — a request with no `Origin` is unchanged (`200` and the real body, no allow-origin header; unkeyed still `401 unauthorized`), the three UI routes still serve, and the CORS step adds **no route** (no `OPTIONS` entry in `registeredRoutes()`) | `tests/cors.test.ts` (`PIN O5`) |
| O6 | the allowlist is **validated at the boundary** — unset is the `*` policy and entries are trimmed and kept in order, while set-but-empty, `*` mixed with names, a bare hostname, a URL with a path or trailing slash, a non-http scheme and a duplicate each fail LOUDLY in `parseCorsOrigins()` (so `resolveConfig()` throws and the BOOT fails, rather than a policy that silently matches nothing) | `tests/cors.test.ts` (`PIN O6`) |
| D7 | **the RUNNING service's policy comes from the environment** — a spawned entrypoint with `SERVERSTORE_CORS_ORIGINS` set answers a listed-origin preflight `204` echoing that origin with `Vary: Origin`, and does not authorise an unlisted one (`401`, no allow-origin header) | `tests/entrypoint.test.ts` (`PIN D7`) |

**O6 and D7 are added beyond the brief's O1–O5, deliberately** (the same choice slice 11
made with E8), and both are reported rather than silent. O6 exists because the brief
requires the setting be "validated at the boundary like the other settings", and the
failure mode of NOT validating it is invisible: `SERVERSTORE_CORS_ORIGINS=game.example.com`
(a bare hostname, no scheme) looks like a locked-down allowlist and can never equal an
`Origin` header. D7 exists because a parser pin plus a typecheck does not prove the
WIRING: ledger row 29's lesson is that a pin must see the value reach the process, so the
spawned entrypoint carries the variable through `resolveConfig()` → `main.ts` →
`createApp()`.

**One fixture set.** `tests/cors.test.ts` builds every server through
`createTestServer()`; the helper gained ONE option (`corsOrigins`) which it passes
straight to `createApp`, and `reboot()` carries it too.

## The CORS differential (2 arms + two controls)

Machinery: `checkpoints/cors-differential.sh`. Raw transcript:
`checkpoints/cors-differential.out` (per-arm raw logs are `*.log`, so gitignored).

Same shape as the earlier differentials — the slice is committed FIRST (the transcript's
CONTROL line names the pre-rebase code tip `2d0e2ae`, which the pre-push rebase replayed
as `bd55b7e` with an EMPTY content delta — `git diff --stat 2d0e2ae bd55b7e -- src tests
checkpoints` is empty — so the gate and the arms ran on exactly the code that lands), the
lock `scripts/gate.sh` takes is held across every arm, each mutated file's sha256 is
printed before and after, restore is `git checkout HEAD --` inside an `EXIT INT TERM`
trap over the mutated file **and `web/`**, and a control runs BEFORE **and** AFTER. Both
arms mutate the SAME file (`src/server/app.ts`) at DIFFERENT anchors, so an unchanged or
identical hash would be refused as a VOID probe.

| Arm | Injected defect | File | sha256 before → after | Went RED on |
| --- | --- | --- | --- | --- |
| A | the CORS step is **MOVED AFTER the key guard** — the brief's named defect, verbatim: the preflight then reaches the guard, which matches every path | `src/server/app.ts` | `9f32ff66…a7569` → `519ee2ba…27002` | `PIN O1: an unkeyed preflight is 2xx, allows PATCH, and names \`authorization\` as a whole word` — `expected 401 to be less than 300`. **Expected collateral, ASSERTED rather than hidden:** `PIN O3: a preflight from a listed origin is 204 …` falls with it (`expected 401 to be 204`) — any arm that breaks preflights reddens every pin about one. **O2 and O3's header half stayed GREEN**, which is the anti-vacuity direction: the headers are still emitted for normal requests, so the arm proves the ORDER, not "CORS is gone" |
| B | **every response sends `Access-Control-Allow-Credentials: true`**, injected on the way OUT | `src/server/app.ts` | `9f32ff66…a7569` → `7a0db3e2…44c50` | `PIN O4: no response of any kind carries Allow-Credentials or a Set-Cookie` — `expected 'true' to be null`; **O1/O2/O3/O5/O6 stayed GREEN** (the line is after the preflight's early return) |
| control | none — the committed tree `2d0e2ae`, same lock held | — | — | **GREEN**: 13 files · 119 tests |
| control | none — the restored tree, file back at its before hash | — | `9f32ff66…a7569` | **GREEN**: 13 files · 119 tests |

- **A HARNESS BUG WAS FOUND BY RUNNING IT, and is recorded rather than quietly fixed.**
  Arm A's first version delimited "the CORS block" as everything up to
  `app.get("/healthz")` — but `const guard` is declared BETWEEN the CORS step and that
  route, so the move swept the declaration into the relocated block and the arm failed
  the **typecheck** (`error TS2448: Block-scoped variable 'guard' used before its
  declaration`) instead of reddening PIN O1. The harness now delimit the block by its OWN
  first and last lines, and both arms refuse to be attributed if the cheap tier fails
  (`error TS` in `cheap.log` is a HARNESS FAILURE). The transcript in
  `checkpoints/cors-differential.out` is from the fixed harness.
- **Arm A's collateral is the honest part**, exactly as in the key-edit differential: the
  named pin the brief required (O1) is red, and the harness additionally ASSERTS that
  O3's preflight half falls with it, so "the preflight is not answered" is not confused
  with "a second rule broke". No hash was unchanged, the two arms produced DIFFERENT
  hashes in the same file, the file was restored byte-identical, and both controls are
  GREEN — so the injection, and nothing else, was the difference.

## The prefix-filter pins (slice 13, P1–P8, `GET /stores/{store}/objects?prefix=`)

The object listing's OPTIONAL filter (ledger rows 60, 61). The behaviour half is driven
through the real app on the ONE fixture set; the plan half runs `EXPLAIN QUERY PLAN` on
the **exported production statement** bound with the **production parameters**
(`objectPrefixRange()`), because a pin that re-typed the SQL would prove nothing about
what the server executes.

| # | Pin | Where |
| ---: | --- | --- |
| P1 | `?prefix=` returns exactly the matching entries: `room-4` matches the stored `room-4`, `room-42.a`, `room-420.x` and `room-4x`, while `room-42.` stops at `room-42.a` and does NOT reach `room-420.x`; the field set is unchanged | `tests/objects.test.ts` (`PIN P1`) |
| P2 | a valid prefix that matches nothing is `200 {"objects":[]}`, never `404` | `tests/objects.test.ts` (`PIN P2`) |
| P3 | an empty (`?prefix=`) or whitespace prefix is `400 invalid_name` — the response is never the whole store (the no-prefix listing is asserted separately, so a silent fallback cannot hide) | `tests/objects.test.ts` (`PIN P3`) |
| P4 | an unmatchable prefix is refused `400 invalid_name`, never silently empty: uppercase, `/`, a leading `.`, `..`, 65 characters, whitespace, a leading `-`, and `;` | `tests/objects.test.ts` (`PIN P4`) |
| P5 | with NO prefix the listing is **byte-for-byte** what it was: the fixed clock makes the whole JSON body deterministic, and it is compared as TEXT | `tests/objects.test.ts` (`PIN P5`) |
| P6 | the filter changes no authorization: `read` → 200 with and without a prefix; a key scoped elsewhere → `403` with and without one (and even with an ILLEGAL prefix — authorization is decided before the prefix is parsed); no key → `401`; an unknown store → `404`; `prefix=shared` on `master` returns only `shared.x` while `other` still returns only `shared.y` | `tests/objects.test.ts` (`PIN P6`) |
| P7 | the prefix query is a RANGE on the primary key: the plan uses the index WITH `name>? AND name<?` and contains no `SCAN objects`, and the statement carries no `LIKE`/`substr` | `tests/objects.test.ts` (`PIN P7`) |
| P8 | the API doc's route row and listing bullet state the `prefix` parameter, the `400 invalid_name` refusal and the empty result, the stale "returns them all" sentence is GONE, and `prefix` is named as the ONE filter — with PIN A1–A3 still green in the same file | `tests/api-doc.test.ts` (`PIN P8`) |

**P7's assertion is deliberately NOT the brief's literal wording, and that is the one
place this slice corrects its own specification.** The brief says P7 must assert
`EXPLAIN QUERY PLAN` "contains NO `SCAN objects`". That assertion **cannot fail** for the
`substr`/`LIKE` arm the same brief requires it to fail for: both produce
`SEARCH objects USING INDEX sqlite_autoindex_objects_1 (store=?)`, which is a `SEARCH`, not
a `SCAN`. P7 therefore pins the signal that actually distinguishes an index RANGE from a
store probe plus a row-by-row filter — the `name>? AND name<?` bounds on the index search.
Measured on this box, with `ANALYZE` and 0–5000 rows:

| statement | plan |
| --- | --- |
| `… WHERE store = ? AND name >= ? AND name < ?` | `SEARCH objects USING INDEX sqlite_autoindex_objects_1 (store=? AND name>? AND name<?)` |
| `… AND substr(name, 1, length(?)) = ?` | `SEARCH objects USING INDEX sqlite_autoindex_objects_1 (store=?)` |
| `… AND name LIKE ?` | `SEARCH objects USING INDEX sqlite_autoindex_objects_1 (store=?)` |

## The prefix-filter differential (3 arms + two controls)

Machinery: `checkpoints/prefix-differential.sh`. Raw transcript:
`checkpoints/prefix-differential.out` (per-arm raw logs are `*.log`, so gitignored).

Same shape as the CORS differential — committed first (code tip `695ba2e`), the same lock
held across every arm, each file's sha256 printed before and after, restore from `HEAD` in
an `EXIT INT TERM` trap, a control BEFORE **and** AFTER. **The harness found its OWN bug on
its first run:** arm B's bind-parameter anchor replaced only the `${…}` interpolation
*inside* a template literal (`` `${prefix}${PREFIX_RANGE_HIGH_SENTINEL}` ``), leaving the
literal string `prefix` as the bound value. The arm then matched NOTHING, which reddened
P1 as well as P7 — and the harness **refused the arm as unattributable** (`arm B ALSO
reddened PIN P1`) instead of recording it. The anchor now names the whole template
literal, and the transcript is from the fixed harness.

| Arm | Injected defect | File | sha256 before → after | Went RED on |
| --- | --- | --- | --- | --- |
| A | the range's lower bound is made EXCLUSIVE (`name >= ?` → `name > ?`), so the entry whose name IS the prefix is dropped | `src/storage/kinds.ts` | `7b17b9a6…07fe9` → `1c7746a3…ef6b` | `PIN P1: ?prefix= returns exactly the matching entries` — `expected [ Array(3) ] to deeply equal [ 'room-4', 'room-42.a', …(2) ]`. P2–P7 stayed GREEN (P5 proves the no-prefix listing untouched; P7 proves it is still a range) |
| B | the filter is re-implemented as `substr(name, 1, length(?)) = ?` with its own bind parameters | `src/storage/kinds.ts` | `7b17b9a6…07fe9` → `40d7bda1…96ad` | `PIN P7: the prefix query is a RANGE on the primary key` — `["SEARCH objects USING INDEX sqlite_autoindex_objects_1 (store=?)"]`. **P1–P6 stayed GREEN: every row returned is still correct**, which is exactly why P7 exists |
| C | the API doc's "`prefix` is the ONE filter" truth is replaced by the stale "a store with many objects returns them all" | `docs/API.md` | `8742a568…da7e` → `241348a5…3ced` | `PIN P8: the API doc's stated \`prefix\` behaviour matches the code` — `docs/API.md still carries the stale 'returns them all' sentence`. PIN A1–A3 stayed GREEN (the route set and error vocabulary did not change) |
| control | none — the committed tree, same lock held | — | — | **GREEN**: 13 files · 127 tests |
| control | none — the restored tree, both files back at their before hashes | — | `7b17b9a6…07fe9` / `8742a568…da7e` | **GREEN**: 13 files · 127 tests |

- Every arm ran the cheap tier GREEN (`cheap exit=0`, no `error TS`) and the full tier RED
  (`full exit=1`), and each arm's failure block names the pin above — so no arm is a probe
  that "went red somewhere".
- Arms A and B mutate the SAME file from the same before-hash; their after-hashes DIFFER
  (`1c7746a3…` vs `40d7bda1…`) and they redden DIFFERENT pins, so neither is a duplicate
  arm. Arm C is a third file and a fourth hash.
- The writer's own gate on the identical tree: `bash scripts/gate.sh` → **exit 0 GREEN ·
  13 files · 127 tests · 2.32s** (raw log `.gate-logs/gate.log`).

### Honest unknowns (this slice)

- **No benchmark at scale.** The plan IS the claim being pinned: "the store is not
  scanned". No measurement was taken against a store with millions of rows; SQLite chose
  the index search at every size tried (0–5000 rows, with `ANALYZE`), and a cost-based
  planner *can* choose a full scan for a query it thinks returns most of the table — that
  cannot happen for a prefix on `(store, name)` above a handful of rows, but it is
  asserted by reasoning and the plan, not by a load.
- **P8 is a doc-TEXT pin.** It proves the contract states the rules; the rules themselves
  are proven by P1–P4 and A1–A3. Nothing checks that a human reads the prose as intended.
- **The `\uffff` bound assumes the ASCII name charset and the BINARY collation.** Both are
  structural (the schema declares no collation; `parseName` refuses non-ASCII) and the
  bound is stated in three comments, but nothing asserts that pairing independently — if a
  future slice relaxes the charset, P7's regex and the bound must be re-derived together
  (`docs/SEAM-INDEX.md`, gotcha 16).
- **`?prefix` (no `=`) and repeated `prefix` parameters are not pinned.** The first parses
  as the empty string and is refused by P3's rule; the second is resolved by Hono to one
  value. Neither is asserted, and neither is documented.

## The rate-limit pins (slice 14, R1–R8)

Slice 14 (ledger rows 64/65) bounds request volume on a public endpoint whose only
perimeter is a key. The ONE new module is `src/server/ratelimit.ts`; the ONE new
middleware sits **after** the CORS step and **before** the key guard (that order is the
feature — see `docs/SEAM-INDEX.md`). The behaviour half is driven through the real app on
the ONE fixture set with a **small limit and the fixture's INJECTED clock**, so the
boundary is proved deterministically and **no load is generated** against anything.

**The ONE fixture constructs every app with the limiter DISABLED (`rateLimit: 0`)** —
the operator kill-switch — so the 127 pins written before the limiter existed keep
passing. That is explicit and per-app, NOT a weakened limiter constant: the limiter's own
pins pass `rateLimit: 3` (or `2`/`1`/`600`) into the same fixture, and the module pins call
`createRateLimiter` directly with an injected clock.

| # | Pin | Where |
| ---: | --- | --- |
| R1 | **under the limit, nothing changes** — the first `limit` authenticated requests are `200` with the SAME body an unlimited server returns, and **no rate-limit header is invented on a success** | `tests/ratelimit.test.ts` (`PIN R1`) |
| R2 | the request after the limit is **`429 rate_limited` with `Retry-After`** (an integer ≥ 1, ≤ the window) and **NO side effect**: a refused `PUT` leaves the `objects` table empty and writes no blob. A SECOND test proves the refusal is **in front of the key guard** — an unkeyed call over the limit is `429`, not the `401` it would otherwise get | `tests/ratelimit.test.ts` (`PIN R2`) |
| R3 | **the window rolls** — one second before the boundary the identity is still `429` with `Retry-After` at its floor (`1`); AT the boundary the same identity is served `200` again with no `Retry-After`; the back-off never exceeds the window | `tests/ratelimit.test.ts` (`PIN R3`) |
| R4 | **identities are independent** — a second `CF-Connecting-IP` is unaffected; `X-Forwarded-For`'s FIRST hop is the identity, so a changed SECOND hop cannot evade; `CF-Connecting-IP` WINS when both are present; and the header order + the shared `local` fallback live in ONE function (`clientIdentity`) that never consults a socket address | `tests/ratelimit.test.ts` (`PIN R4`) |
| R5 | **the exemptions are real** — `/healthz`, `/`, `/app.js`, `/app.css` and a CORS preflight all keep answering while the API identity is over its limit, and the API is STILL `429` afterwards (so these are exemptions, not a dead limiter). A second test covers the ONE path on which a preflight reaches the limiter — a DISALLOWED origin's preflight, which falls through the CORS step — and proves it gets the guard's `401`, never a `429` | `tests/ratelimit.test.ts` (`PIN R5`) |
| R6 | **the table is BOUNDED** — with `maxBuckets: 8` and 500 distinct identities the live buckets never exceed the cap, AND a flooding identity interleaved with cold ones is STILL refused (**eviction must not silently disable the limit**; the flooding bucket is refreshed on every use, so eviction takes the cold buckets first). A second test floods `DEFAULT_MAX_BUCKETS + 500` identities against the DEFAULT cap and proves the truncation of an over-long identity key (an attacker-controlled header LENGTH cannot inflate the table) | `tests/ratelimit.test.ts` (`PIN R6`) |
| R7 | **`SERVERSTORE_RATE_LIMIT=0` disables it completely** (700 unkeyed requests, none refused); the **bare default is 600 per 60 s** (`resolveConfig({}).rateLimit === 600`, and the 600th request passes while the 601st is `429`); and a **malformed value fails the BOOT loudly** (`abc`, `-1`, `1.5`, `""`, whitespace, `NaN`, `Infinity`, `600x` all make `resolveConfig` throw, while unset/`0`/`600`/`" 42 "` parse) | `tests/ratelimit.test.ts` (`PIN R7`) |
| R8 | **the documented contract matches the code** — `docs/API.md`'s error table carries `rate_limited`/`429`, the Limits table carries `SERVERSTORE_RATE_LIMIT` with its default, every API route row lists `429` while `/healthz` and the three assets do NOT (the exemption is part of the contract), the response mentions `retry-after`, and the stale "no rate limit" sentences are GONE. PIN A1–A3 stay green in the same gate | `tests/ratelimit.test.ts` (`PIN R8`) |

**The CORS pins were CHANGED in the same commit, deliberately and not relaxed.**
`retry-after` joined `Access-Control-Expose-Headers` (row 64f) because `Retry-After` is
**not** a CORS-safelisted response header: without exposing it, a browser sees the `429`
but cannot read how long to wait. Two pins in `tests/cors.test.ts` (PIN O2, both halves)
asserted that header by **EQUALITY** as `x-serverstore-sha256`; they now assert the FULL
set, `x-serverstore-sha256, retry-after`. They were **not** relaxed to `toContain` — the
complete set IS the claim, and a relaxed pin is how an unintended second header arrives
unnoticed. No other CORS assertion changed.

## The rate-limit differential (2 arms + two controls)

Machinery: `checkpoints/ratelimit-differential.sh`. Raw transcript:
`checkpoints/ratelimit-differential.out` (per-arm raw logs are `*.log`, so gitignored).

Same shape as the earlier differentials — the slice is committed FIRST (the transcript's
CONTROL line names the pre-rebase code tip `a40ca91`, which a rebase onto the dispatcher's
row-64 correction replayed as `6f55c32` and the pre-push rebase onto the row-66 board commit
replayed again as `66a3295` — each replay with an EMPTY content delta on the code
(`git diff --stat a40ca91 66a3295 -- src tests docs/API.md` is empty), so the gate and the
arms ran on exactly the code that lands), the lock `scripts/gate.sh` takes is held
across every arm, the mutated file's sha256 is printed before and after, restore is
`git checkout HEAD --` inside an `EXIT INT TERM` trap, and a control runs BEFORE **and**
AFTER.

| Arm | Injected defect | File | sha256 before → after | Went RED on |
| --- | --- | --- | --- | --- |
| A | **the window never rolls** — the reset comparison (`at >= existing.resetAt`) is neutralised, so a bucket that should have expired is treated as live forever | `src/server/ratelimit.ts` | `810abb51…c2753` → `e80048e5…c355a` | `PIN R3: the window rolls — the same identity is served again and Retry-After never exceeds the window` — `expected 429 to be 200`. **R1/R2/R4/R5/R6/R7/R8 all stayed GREEN**: the limiter still counts and refuses inside the window, so the arm isolates the WINDOW ROLL, not "the limiter is gone" |
| B | **the bucket cap is REMOVED** (`if (buckets.size >= maxBuckets) evictOldest()` → `if (false) …`), so the table grows without limit while the counter still works | `src/server/ratelimit.ts` | `810abb51…c2753` → `9814f184…df0b7f` | BOTH R6 tests: `expected 500 to be less than or equal to 8` and `expected 4596 to be less than or equal to 4096`. **PIN R2 stayed GREEN**, which is exactly what isolates the BOUND rather than the limiter; R1/R3/R4/R5/R7/R8 stayed green too |
| control | none — the committed tree `a40ca91` (replayed as `66a3295`), same lock held | — | — | **GREEN**: 14 files · 142 tests |
| control | none — the restored tree, file back at its before hash | — | `810abb51…c2753` | **GREEN**: 14 files · 142 tests |

- Every arm ran the cheap tier GREEN (`cheap exit=0`, no `error TS`) and the full tier RED
  (`full exit=1`), and each arm's failure block names the pin above — so no arm is a probe
  that "went red somewhere".
- Both arms mutate the SAME file at DIFFERENT anchors; their after-hashes DIFFER
  (`e80048e5…` vs `9814f184…`) and they redden DIFFERENT pins (R3 vs R6), so neither is a
  duplicate arm. No hash was unchanged and the file was restored byte-identical.
- The writer's own gate on the identical tree: `bash scripts/gate.sh` → **exit 0 GREEN ·
  14 files · 142 tests · 2.41s** (raw log `.gate-logs/gate.log`).

### Honest unknowns (this slice)

- **In-memory means a restart forgets.** The counters live in this process only. A service
  restart (a deploy, `GUARD g5`) resets every bucket to zero, so a patient attacker who
  times a restart gets a fresh window. A persistent counter is deliberately NOT built
  (row 64c), and nothing here claims otherwise.
- **One process means no cross-process limit.** There is one service process; if a second
  were ever started (it would fight over the same database), the two would each allow
  `SERVERSTORE_RATE_LIMIT`. Nothing tests a multi-process deployment because none exists.
- **The identity is only as trustworthy as the tunnel.** `CF-Connecting-IP`/the first
  `X-Forwarded-For` hop are what cloudflared supplies; a process ON this box can spoof
  either and evade the limit, which row 64b accepts explicitly (it could already reach
  loopback). These pins drive the headers directly, so they prove the ORDER and the bucket
  behaviour, **not** that cloudflared is the only ingress.
- **No live load test, by rule.** The boundary is proved with the injected clock. The host
  rule forbids synthetic load against `https://store.futuremagic.de`, so nothing here
  verifies the deployed service's actual limit under real traffic — and nothing should.
- **The `Retry-After` header's browser readability is a header assertion, not a browser
  run.** R5 proves the header is on the `429` and PIN O2 proves `retry-after` is exposed;
  the half that actually reads it in a page is unexercised, like every other browser half
  in this project (the OWED headless-browser test).
- **The bucket cap is a memory bound, not a measured one.** R6 asserts the COUNT stays at
  the cap; it does not measure resident bytes. With `MAX_IDENTITY_LENGTH = 64` the keys are
  bounded too, so worst case is ~4096 × 64 bytes of keys plus counts — asserted by
  construction, not by a memory probe.

## The browser pins (slice 15, B1–B8)

Slice 15 (ledger rows 67/68) is TEST-ONLY: it adds no product code. It closes the two gaps
named in rows 49/54 and 57/58 by running the product in the environment those surfaces
exist for — a browser. ONE seam owns the whole browser shape:
`tests/helpers/browser.ts` launches the installed `/usr/bin/google-chrome`
(`--headless=new`, a temp `--user-data-dir` UNDER THE WORKTREE, `--remote-debugging-port=0`
with the port read back from `DevToolsActivePort`), speaks just enough CDP over Node's
BUILT-IN global `WebSocket` (no npm dependency), and kills the browser's whole PROCESS
GROUP. The API under test is the repo's OWN spawned entrypoint
(`tests/helpers/entrypoint.ts`, shared with the D pins), with a master key minted in
process through the ONE mint path (`openDatabase` → `ensureMasterStore` → `mintKey`) before
the spawn.

**The two traps the brief named, handled explicitly:**

- **The rate limiter is in the request path.** The spawned service gets
  `SERVERSTORE_RATE_LIMIT=0` — the operator kill-switch — with a comment saying why, so a
  browser test can never fail for a limiter reason. The limiter keeps its own pins (R1–R8).
- **Every wait has a deadline that FAILS.** `BrowserPage.waitFor` polls with a hard
  deadline and throws with the last thing it saw; each CDP command carries its own timer;
  the DevTools-port poll fails on a launch timeout; the kill is bounded. There is no
  `sleep`-and-hope, no silent retry loop, and **no `describe.skip`/`it.skipIf` anywhere**.
  Each pin also carries a 30 s vitest timeout — deliberately larger than the seam's 5 s
  deadlines, so a stuck page fails on the SEAM's named wait rather than on vitest's default.

**Cross-origin is real.** Two tiny stdlib HTTP servers on their OWN loopback ports are the
allowed and the disallowed origin; the API is spawned with
`SERVERSTORE_CORS_ORIGINS=<the allowed origin>`; and the `fetch` under test is evaluated in
the matching PAGE's context, so the request genuinely carries that page's `Origin`. The
interaction is TRUSTED: elements are FOUND with `Runtime.evaluate` and then clicked with
`Input.dispatchMouseEvent` (and typed with `Input.dispatchKeyEvent` + `Input.insertText`).

| # | Pin | Where |
| ---: | --- | --- |
| B1 | **the console's JavaScript RUNS in a real browser, with NO page error** — navigate to the spawned service's `/`, wait for the connect form, assert no `Runtime.exceptionThrown` and no `Log.entryAdded` error; then click "Use key" with an EMPTY field and assert the console's OWN `no_key` validation renders, which only the served module can produce | `tests/browser.test.ts` (`PIN B1`) |
| B2 | **a master key typed into the console AUTHENTICATES through the UI** — trusted-type the key, trusted-click Connect, wait for the authenticated view (the console's own `GET /whoami`), assert the session line carries that key's id; then assert the key is in NO URL/query/fragment, NO `localStorage`/`sessionStorage` entry, NO cookie, and not left in the password field | `tests/browser.test.ts` (`PIN B2`) |
| B3 | **the console's EDIT flow really PATCHes** — open the editor on a named key row with a trusted click, rename and change a permission (`write` OFF, `delete` ON) with trusted input, save, then assert the EFFECT through `GET /keys`: the label and the canonical perms really changed | `tests/browser.test.ts` (`PIN B3`) |
| B4 | **a real browser on ANOTHER ORIGIN completes an authorized `fetch`** — from the allowed origin's page, `fetch(api + "/stores", {Authorization: Bearer …})` resolves `200` with the parsed body (the browser-enforced preflight + Allow-Headers path) | `tests/browser.test.ts` (`PIN B4`) |
| B5 | **that browser can READ `x-serverstore-sha256`** — the object's hash is readable from the cross-origin response OBJECT, which is only true because it is in `Access-Control-Expose-Headers` | `tests/browser.test.ts` (`PIN B5`) |
| B6 | **a DISALLOWED origin is blocked BY THE BROWSER** — the same `fetch` from the third origin REJECTS with a `TypeError`; the API's own preflight for that origin is the guard's `401` with NO allow-origin header (so the real request was never sent), while the ALLOWED origin's preflight is `204` — i.e. an allowlist, not a service that refuses every browser | `tests/browser.test.ts` (`PIN B6`) |
| B7 | **nothing outlives the test** — a launched browser is killed and BOTH `process.kill(pid, 0)` and `process.kill(-pid, 0)` throw (the launcher AND the tree), the browser is de-registered, `kill()` is idempotent, and the file's `afterAll` asserts no browser is registered and the spawned service really exited | `tests/browser.test.ts` (`PIN B7`) |
| B8 | **a missing browser FAILS loudly** — `launchBrowser({executablePath: <a path that cannot exist>})` rejects with the NAMED `BrowserMissingError`, whose message contains the path; so "no browser" can never be a silent pass | `tests/browser.test.ts` (`PIN B8`) |

**The browser pins do NOT replace the in-process ones, and the in-process ones do not
replace these.** U1–U4 still scan the served bytes; O1–O6 still assert the headers in
process; B1–B6 are the only pins that run the served module and the only ones a BROWSER
enforces. U3's route check and B3's PATCH effect are different claims about the same
button.

## The browser differential (2 arms + two controls)

Machinery: `checkpoints/browser-differential.sh`. Raw transcript:
`checkpoints/browser-differential.out` (per-arm raw logs are `*.log` under
`.diff-harness-browser/`, so gitignored).

Same shape as the earlier differentials — the slice is committed FIRST (the code tip the
transcript's CONTROL line names is this landing's test-only commit), the lock `scripts/gate.sh`
takes is held across every arm, the mutated file's sha256 is printed before and after,
restore is `git checkout HEAD --` inside an `EXIT INT TERM` trap with the hash asserted
back, and a control runs BEFORE **and** AFTER. Chrome processes are counted after every run
(`ps -eo comm= | grep -c '^chrome$'` → `0`), and a non-zero count VOIDs the run.

| Arm | Injected defect | File | sha256 before → after | Went RED on |
| --- | --- | --- | --- | --- |
| A | **the console's EDIT AFFORDANCE is removed** — the Edit button still renders, but its click handler is a no-op | `web/app.js` | `ea2462f5…db0f` → `bbd6f863…0efc` | `PIN B3: the console's EDIT flow really PATCHes` — the seam's OWN deadline: `BrowserError: timed out after 5000ms waiting for the per-row editor to replace the row; last: the expression is falsy (false)`. **B1, B2, B4–B8, U1–U4 and O2 all stayed GREEN** — the console still runs and still authenticates, so the arm isolates the EDIT FLOW rather than "the page is broken" |
| B | **the REAL response stops exposing the header set** — the `c.res.headers.set("access-control-expose-headers", …)` line that runs AFTER `next()` is removed (the preflight's `204` keeps its own, so the preflight assertions survive) | `src/server/app.ts` | `e62df5e8…12a7` → `649ef876…5542` | `PIN B5: that browser can READ the exposed x-serverstore-sha256` — `expected null to be '60ba8907…'`. **B1–B4, B6–B8, U1–U4, O1 and R5 stayed GREEN**, so the arm isolates the EXPOSED SET rather than "CORS is off" |
| control | none — the committed tree | — | — | **GREEN**: 15 files · 150 tests; `tests/browser.test.ts (8 tests) 1530ms` |
| control | none — the restored tree, both files back at their before hashes | — | — | **GREEN**: 15 files · 150 tests; `tests/browser.test.ts (8 tests) 1672ms` |

**Arm B's EXPECTED COLLATERAL, named rather than hidden: PIN O2 in `tests/cors.test.ts`
goes RED too** (both halves — the cross-origin `GET /stores` and the object GET). O2 is the
IN-PROCESS twin of exactly the contract B5 proves in a browser, so no mutation of
`src/server/app.ts` can redden B5 alone; the brief's global "an arm that reddens a pin it
did not name is VOID" rule is unsatisfiable for its own arm (b) wording. The harness
therefore ASSERTS O2 is red (a change that stopped reddening it would mean the arm no
longer targets the contract), and the same class of overlap was recorded in row 54 for
U1/U4. No `error TS` in either arm, and every other pin stayed green — so neither arm is a
probe that "went red somewhere".

### Honest unknowns (this slice)

- **ONE browser engine.** Everything here runs the installed Chrome over CDP. Firefox,
  Safari and a phone browser are unproven, and so is any behaviour that differs between
  them.
- **A scripted UI flow is NOT a claim about visual layout.** No pin asserts that anything
  is visible, reachable, or usable on a small screen; B3 asserts an EFFECT through the
  API, deliberately, because the effect is the claim.
- **Only three console flows are executed.** B1–B3 cover load, authenticate and edit.
  Mint, revoke (`window.confirm`), store creation, the copy button and the
  disabled-for-revoked state are still only static-scanned by U1–U4.
- **`favicon.ico` is excluded from B1's error scan, deliberately.** Chrome asks for it,
  the key guard answers `401` (no such route, no key), and a missing favicon is not a
  broken console. Every other network error and every page exception is fatal.
- **The kill depends on the test runner keeping its promises.** The process-group kill runs
  from the helper's `afterAll`, a failure path and a synchronous `process.once("exit")` net;
  a `SIGKILL` of the vitest worker itself would still leave the group, which no in-process
  cleanup can prevent. The arms therefore COUNT chrome processes from the shell after every
  run (0), and any future harness must do the same.
- **The browser is trusted to be a browser.** The pins prove the BROWSER blocks a
  disallowed origin; they say nothing about a non-browser client, and CORS remains a
  browser-READ control, never the perimeter (row 21).
- **The 429's `Retry-After` is still not read by a browser.** R5 proves the header is on
  the `429` and O2 proves `retry-after` is exposed, but no page reads it — the owed gap is
  narrower now (a real page proves cross-origin HEADER reading works at all), not closed.
- **No live host was touched.** Everything runs against a spawned service on loopback with
  a scratch data root; `https://store.futuremagic.de` was never loaded (the host rule
  forbids synthetic load), so nothing here verifies the DEPLOYED console in a browser.

## The destructive-lifecycle pins (slice 16, X1–X9)

The three destructive routes and the byte reclamation they imply (ledger rows 70, 71). Every
pin drives the real app through the ONE fixture against a real temp data root; the sharing
half (`X7`) and the last-admin half (`X3`) read the DATABASE and the FILESYSTEM directly,
because that is where the claims live. `tests/destructive.test.ts` is the file; the ONE
existing assertion it REPLACES is `tests/objects.test.ts`'s "DELETE… leaves the blob", which
asserted the debt this slice closes (it now asserts reclamation of an UNSHARED blob).

| # | Pin | Where |
| ---: | --- | --- |
| X1 | `DELETE /keys/:id` removes the key row AND its `key_stores` rows (asserted in the SQLite file, not by counting responses), the key disappears from `GET /keys`, and the credential answers `401` on the **NEXT** request; a **REVOKED** key is deletable too | `tests/destructive.test.ts` (`PIN X1`) |
| X2 | deleting a key is **revoke's boundary**: a store-scoped admin cannot delete a key outside its scope (`403`) nor one holding `admin` (`403`), a master can, **self-deletion is allowed**, and a NON-admin key is `403` even for its own id | `tests/destructive.test.ts` (`PIN X2`) |
| X3 | the **LAST live admin key** is refused `409 conflict` and still works; with TWO live admins either may be deleted and the survivor still authenticates; a **REVOKED** admin does not count (and is itself deletable); an **EXPIRED** admin does not count either | `tests/destructive.test.ts` (`PIN X3`) |
| X4 | emptying a store removes every entry, reclaims its blob FILES from disk (not merely unreferencing them), leaves a sibling store's bytes alone, leaves the store and every key's scope untouched, and emptying an already-empty store is `200` with `deleted: 0` | `tests/destructive.test.ts` (`PIN X4`) |
| X5 | a store with a key scoped to it cannot be deleted: `409 conflict` NAMING the blocking key (id and label), the store still lists, its objects still read, its directory is still there; delete the key and the store delete succeeds and the directory is gone | `tests/destructive.test.ts` (`PIN X5`) |
| X6 | the confirm token is SERVER-side: missing, empty and mismatched `confirm` are `400 bad_request` on BOTH bulk routes and NOTHING is deleted (objects, bytes, stores and the scoped key all still there); the correct token works | `tests/destructive.test.ts` (`PIN X6`) |
| X7 | two names with IDENTICAL bytes share one blob file; deleting one leaves the survivor's bytes intact and the file present; deleting the LAST row removes both the row and the file | `tests/destructive.test.ts` (`PIN X7`) |
| X8 | authorization and the error surface are unchanged in kind: emptying needs `delete` (a `read`-only key is `403`), deleting a store needs a master (a store-scoped admin AND a `["*"]` key without `admin` are `403`), an unknown store/key is `404`, every destructive route without a key is `401`, and a traversal attempt is `400 invalid_name` (the store name goes through the ONE parser before any path is built) | `tests/destructive.test.ts` (`PIN X8`) |
| X9 | the docs match the code: the three routes are in `docs/API.md`'s table with their permissions, statuses and the confirm token, the app REGISTERS them, `conflict` is in the error table at `409`, and the last-live-admin, confirm and shared-content rules are all stated — with PIN A1–A3 green in the same gate | `tests/destructive.test.ts` (`PIN X9`) |

## The destructive-lifecycle differential (2 arms + two controls)

Machinery: `checkpoints/destructive-differential.sh`. Raw transcript:
`checkpoints/destructive-differential.out` (per-arm raw logs are `*.log`, so gitignored).

The slice is committed FIRST (the transcript's CONTROL line names the code tip `55f1bbf`,
replayed by the pre-push rebase onto the dispatcher's `d906bbd` — which carries `d9b2016`'s
`docs/STORAGE.md` — as `f066f65`, with an empty content delta on the code). Same shape as
every earlier differential: the gate lock held across the CONTROL
and BOTH arms, each file's sha256 printed before and after, restore from `HEAD` in an
`EXIT INT TERM` trap with the hash asserted back, `error TS` = VOID, a control BEFORE and
AFTER.

| Arm | Injected defect | File | sha256 before → after | Went RED on |
| --- | --- | --- | --- | --- |
| A | the store-delete key-scope refusal is neutralised (the blocker list is forced empty), so the `stores` row is deleted while a `key_stores` row still names it | `src/server/app.ts` | `62247607…c2bf` → `2f7afd9c…c162` | `PIN X5: a store with a key scoped to it cannot be deleted` — `expected 500 to be 409`, and the server logs `FOREIGN KEY constraint failed`: the refusal is what turns the schema's error into a NAMED, actionable 409. **X4 (empty), X6 (confirm) and X8 (error surface) stayed GREEN** |
| B | the shared-content check is removed from the single-object delete, so the blob is ALWAYS deleted | `src/storage/kinds.ts` | `b49f2013…bbca` → `f4152115…c307` | `PIN X7: deleting one object reclaims only UNSHARED content` — the survivor's read answers `{"error":{"code":"internal","message":"ENOENT…"}}` instead of the bytes. **The ORDINARY delete stayed GREEN** (`tests/objects.test.ts` 23/23 — a lone object's blob MUST go, which is why always-deleting passes there), and X5, X6, X8 stayed GREEN |
| control | none — the committed tree, same lock held | — | — | **GREEN**: 16 files · 159 tests |
| control | none — the restored tree, both files back at their before hashes | — | `62247607…c2bf` / `b49f2013…bbca` | **GREEN**: 16 files · 159 tests |

- Arm A's RED is the schema's own foreign key surfacing as a 500 where the route must answer
  a named `409`; it does NOT redden X6 or X8, so the refusal and the confirm rule are
  **different mechanisms** and the arm is attributable.
- Arm B is the two-sided check the brief asks for: the SHARED case reddens (`X7`) while the
  UNSHARED case stays green, which is exactly what distinguishes "the sharing check is gone"
  from "delete is broken".
- Arms mutate DIFFERENT files from different before-hashes; no arm reddened a pin it did not
  name, so there is no declared twin to report.
- The writer's own gate on the identical tree: `bash scripts/gate.sh` → **exit 0 GREEN ·
  16 files · 159 tests · 2.45s** (raw log `.gate-logs/gate.log`).

### Honest unknowns (this slice)

- **The removals are not one transaction.** A `sqlite` DELETE and an `rm` cannot be atomic
  together, so a crash BETWEEN them leaves orphan bytes (for empty-store, delete-store and
  the single-object delete alike). The ORDER is the safe one — rows first — so the leftover
  is always space, never a row whose blob is missing (which would be an unreadable object);
  but the space is unreclaimed until a future sweep, and nothing asserts the crash window.
- **No concurrency pin.** The sharing check reads the row set and then deletes, with no
  interleaving possible in a single-threaded `node:sqlite` process — asserted by the
  architecture, not by a test. A second process writing the same data root is already out of
  scope (`docs/STORAGE.md`: one process owns the root).
- **No orphan SWEEP for overwritten content.** `PUT` replaces a row and the previous
  content's file stays; nothing collects it, and this slice does not change that. X4/X5/X7
  cover what a DELETE reclaims, not what an overwrite strands.
- **X9 is a doc-TEXT pin.** It proves the contract states the routes, the confirm rule and
  the reclamation behaviour; the behaviour itself is X1–X8 and A1–A3. Nothing checks that a
  human reads the prose as intended.
- **The live host was not touched.** No request, no key, no restart: every pin uses a temp
  data root under the test's own scratch, and `https://store.futuremagic.de` was never
  loaded (the host rule forbids synthetic load). Whether the deployed service is restarted
  onto this code is the dispatcher's step under GUARD g5, not a claim here.

## The full gate

`bash scripts/gate.sh` is the ONE command; exit `0` (GREEN) means both tiers passed.
Raw log: `.gate-logs/gate.log` (gitignored). This doc deliberately carries **no test
count**: a tally restated in prose goes stale inside its own landing (ledger row 22
deleted one for exactly that), so the LANDED row on `docs/BOARD.md` records the numbers
for the specific landing it verified.

## What is NOT tested yet (honest unknowns)

- **The admin UI's in-browser behaviour — PARTLY CLOSED by slice 15 (B1–B3), and the rest
  still unproven.** U1–U4 scan the SERVED bytes and the served status/content types, and
  plain JS is not typechecked (ledger row 48 accepted that price knowingly). Since slice 15
  a real Chrome runs the served `web/app.js` (B1), authenticates a typed key through the UI
  (B2) and drives slice 11's EDIT flow end to end (B3). What is still UNPROVEN: every other
  console control — mint, revoke (`window.confirm`), store creation, the copy button, the
  disabled-for-revoked state, the "changed … by …" audit line, the "this key is the one you
  are using" warning — and anything visual (a scripted flow says nothing about layout).
  Those claims need their own pins.
- **No concurrency test.** Two writers racing the same object name are handled by an
  upsert, but nothing exercises it. Unproven rather than claimed.
- **RETIRED: "no test binds a port or exercises `main.ts`".** D1–D4 now spawn the real
  entrypoint and speak HTTP to it over loopback, so the loopback binding is a pin and
  not "a code constant plus a review". What remains unproven about the deployment is
  everything that only exists ON THE HOST: the unit has never been installed, so
  nothing has exercised `Restart=on-failure`, the cloudflared ingress, or the live
  hostname. `scripts/probe-live.sh` is the command that will check the last of those,
  and its live run is a step in `docs/DEPLOYMENT.md`, not a test.
- **Reclamation is tested; an orphan SWEEP is not — because there is none.** X4, X5 and X7
  prove the bytes a DELETE reclaims (an entry, a whole store, a store directory) and the
  sharing trap that makes a naive delete wrong. A file orphaned by **overwriting** a name
  (`PUT` replaces the row and the old file stays) is still not reclaimed and is not tested —
  there is nothing to test (ledger row 71, `docs/STORAGE.md`).
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
- **An edit keeps no HISTORY, and `expiresAt` cannot be edited.** `PATCH /keys/{id}`
  records only the LAST change (`updatedAt`/`updatedBy`); what a key used to hold is not
  recoverable through the API, and an expiry set at mint time stays. Both are deferred
  and named (ledger row 52), so nothing here tests them — there is nothing to test.
- **`PATCH /keys/{id}`'s `404`-vs-`403` oracle is the SAME shape as the lifecycle's**:
  the route is admin-only, a valid-bodied request for an unknown id is `404` and a key
  outside a scoped admin's set is `403`, so a scoped admin can tell "no such key" from
  "not yours". Recorded, not claimed leak-free (the same note as the lifecycle's, for the
  same reason).
- **CLOSED by slice 15: a real browser makes the cross-origin call.** O1–O6 still drive
  `app.request()` in-process and D7 still talks to a spawned entrypoint over loopback —
  they assert the HEADERS a browser needs. B4–B6 are the half only a browser can show: a
  page on a genuinely different origin completes an authorized `fetch` (B4), READS the
  exposed `x-serverstore-sha256` (B5), and is BLOCKED with a `TypeError` when its origin is
  not in the allowlist (B6, with the API's own `401`-and-no-allow-origin preflight proving
  the real request was never sent). One browser engine only, and the deployed host's
  environment is still not asserted by anything.
- **The wildcard default means the DEPLOYED service answers every origin today.** That is
  the brief's decision (ledger rows 56/57) and is safe because there are no cookies, but
  it is a policy an operator can narrow with `SERVERSTORE_CORS_ORIGINS` and nothing
  asserts what the live host's environment holds. The game needs no narrowing to work.
- **A preflight to a path the app does not register is answered `204`.** The CORS step
  runs before ROUTING (that is what makes it work for `/stores`), so it cannot know
  whether the path exists; the REAL request is still `401`/`404`. Pinned by O1's
  before-routing test, and recorded here so it is not mistaken for a route-shaped probe
  of the API surface.
- **CORS is not authentication and is not the perimeter.** Nothing in these pins claims
  an origin allowlist keeps a non-browser client out; `curl` ignores every header here,
  and the key guard behind the step remains the only perimeter (ledger row 21).
