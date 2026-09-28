# Brief — slice 14 (F1): rate limiting on the public endpoint

Cut from `docs/BRIEF.md`. Self-contained. Ledger row assigned by the dispatcher: **65**.

---

You are a WRITER on **ServerStore** (Node 24 + TypeScript, pnpm, vitest, ONE gate). Read
`/home/administrator/projects/ServerStore/AGENTS.md` FIRST, then `docs/DECISION-LEDGER.md` rows 21,
**28**, 43, **57/58** (CORS), **64** (this slice's design — the authority for every choice below),
`docs/SEAM-INDEX.md`, and `docs/API.md`.

## Where you work (READ THIS TWICE)

Worktree `/home/administrator/projects/ServerStore/worktrees/rate-limit`, branch `feat/rate-limit`,
already created and installed. EVERY read/edit/write/bash call MUST use an ABSOLUTE path under that
worktree. Never touch the main tree. You are the only writer in flight.

Your base is the tip of `origin/main` that carries THIS brief — **resolve it and record the resolved
sha in your landing row** (`git -C /home/administrator/projects/ServerStore/worktrees/rate-limit
rev-parse --short origin/main`). Do not trust a sha quoted from memory, including in this brief.

You are a subagent: your background jobs DIE when your turn ends. Run the gate IN-TURN, foreground.

## Why this slice exists

The service answers any origin since CORS landed, on a public hostname whose only perimeter is a key,
and **nothing bounds request volume** (rows 28/43). Ledger row 64 fixes the design; this brief turns it
into code. The trap that makes this more than a counter: **a bucket table keyed by a client-supplied
header is itself a denial-of-service vector**, and a limiter placed after the key guard protects only
callers who already hold a key.

## What to build

1. **ONE new module, `src/server/ratelimit.ts`** — the whole feature. No npm dependency (Node stdlib
   only). It exports a small factory that takes `{ limit, windowMs, now, maxBuckets? }` and returns
   something with `check(identity): { allowed: boolean; retryAfterSeconds: number }`.
   - **Per identity, fixed window with an injected clock**: the FIRST request in a window opens the
     bucket; request N ≤ limit passes; request N+1 is refused until the window rolls. Use the
     project's injected `now` (milliseconds) — never `Date.now()` directly.
   - **`limit === 0` means DISABLED** and `check` always allows (the operator kill-switch).
   - **BOUNDED**: the bucket table has a hard cap (`maxBuckets`, default 4096). When the cap is
     reached, EVICT (oldest/expired first) and SWEEP expired buckets — never grow without limit, and
     never let eviction stop the limiter from limiting. A flood of distinct identities must stay at
     the cap while the limit still applies.
   - `retryAfterSeconds` must be an integer ≥ 1 and never longer than the window.
2. **Wire it in `src/server/app.ts` ABOVE `app.use("*", guard)`** (and above the CORS step, or below
   it — but it MUST run for unauthenticated API requests, which is the whole point). It applies to the
   **API**, and it is a no-op for:
   - `/healthz` and the three UI assets (`/`, `/app.js`, `/app.css`) — the probe and the operator's
     console must never be limited;
   - **CORS preflights** (`OPTIONS` carrying `Access-Control-Request-Method`, row 57) — limiting a
     preflight breaks a browser for no gain.
   A refused request returns **429** with the existing envelope `{error:{code,message}}` and a
   **`Retry-After`** header, and it must never read the body or reach a handler (no side effects).
3. **Identity**, in this order: `CF-Connecting-IP`, else the FIRST hop of `X-Forwarded-For`, else the
   single shared identity `local`. The peer socket address is USELESS here (the unit binds loopback and
   the only ingress is cloudflared) — say that in a comment so nobody "fixes" it later.
4. **`src/server/config.ts`**: `SERVERSTORE_RATE_LIMIT` parsed at the boundary, default **600**
   requests per 60-second window, `0` = disabled. A non-numeric, negative or non-integer value fails
   the BOOT loudly (the project's boundary rule; `parsePositiveInt` is the existing style — extend it
   or follow it, but do not silently coerce). Window: 60_000 ms, not configurable in v1 (say so).
5. **ONE new error code `rate_limited` (429)** in `src/core/errors.ts`, and `docs/API.md` updated in
   the SAME commit (its error table is checked against `ERROR_CODES` by PIN A2, and its route table's
   status lists gain `429`).
6. **`retry-after` joins `Access-Control-Expose-Headers`** — a browser cannot read `Retry-After`
   otherwise, so without this the 429 is useless to the exact clients this API now serves. **This
   breaks two CORS pins that assert the header by EQUALITY (`tests/cors.test.ts:124,144`):** update
   them in the SAME commit to assert the **FULL set** (`x-serverstore-sha256, retry-after`) — do NOT
   relax them to `toContain`; the complete set is the claim, and a relaxed pin is how an unintended
   header arrives unnoticed. Record the change and its reason in `docs/TESTING.md`.
7. **Docs truths to fix in the same commit** (both are drift found while grounding this design):
   - the store's ingress is **rule #6**, not #5 (`/etc/cloudflared/config.yml` has six hostname rules;
     `apps.futuremagic.de` sits above `store.futuremagic.de`) — correct `docs/BOARD.md:964` and the
     deployment prose that repeats it;
   - `docs/API.md`'s non-goals say there is no rate limit — that sentence becomes the truth (the env
     var, the default, the 429, and that healthz/assets/preflights are exempt). `docs/DEPLOYMENT.md`
     gains the variable in its env list.
8. **Explicitly NOT in this slice**: per-key buckets (deferred and named in row 64), a distributed or
   persistent counter, limiting `/healthz`/assets/preflights, a `/metrics` endpoint, and any change to
   the key guard, the CORS policy or the storage layer.

## Pins (a pin's NAME is part of the deliverable)

1. `PIN R1: under the limit, nothing changes` — with a small limit and an injected clock, the first
   `limit` requests behave exactly as before (same status, same body), and no rate-limit header is
   invented on a success.
2. `PIN R2: the request after the limit is 429 with `Retry-After` and no side effect` — the envelope
   is `{error:{code,message}}` with code `rate_limited`, `Retry-After` is an integer ≥ 1, and a
   refused **PUT** created/changed NOTHING (read the object back and/or count rows).
3. `PIN R3: the window rolls` — advance the injected clock past the window and the same identity is
   served again; `Retry-After` never exceeds the window.
4. `PIN R4: identities are independent` — one identity exhausting its bucket does not refuse another
   (two different `CF-Connecting-IP` values; and `X-Forwarded-For`'s FIRST hop is the identity, so a
   second hop cannot be used to evade).
5. `PIN R5: the exemptions are real` — `/healthz`, `/`, `/app.js`, `/app.css` and a CORS **preflight**
   all keep answering while the API identity is over its limit.
6. `PIN R6: the table is BOUNDED` — with `maxBuckets` small (e.g. 8) and MANY distinct identities, the
   number of live buckets never exceeds the cap, AND the limiter STILL refuses a flooding identity
   (eviction must not silently disable the limit). Assert both halves; a pin that only checks the cap
   is satisfied by a limiter that does nothing.
7. `PIN R7: `SERVERSTORE_RATE_LIMIT=0` disables it completely` — and the default (600/60s) is what a
   bare config yields; a malformed value fails the BOOT loudly rather than defaulting.
8. `PIN R8: the documented contract matches the code` — `docs/API.md`'s error table and route
   statuses carry `rate_limited`/`429` and the env table carries the variable (PIN A1–A3 must stay
   green), and the doc's stale "no rate limit" sentence is gone.

Reuse the ONE fixture set (`tests/helpers/server.ts`); never a second one. **The ONE fixture must
construct the app with the limiter DISABLED (or a limit no test can reach) so the existing 127 pins
keep passing — and that must NOT be done by weakening the limiter: the limiter's own pins build their
own app with a small limit and an injected clock.** If you find yourself relaxing a limiter constant
to keep an old test green, STOP and report it.

## Verification (yours)

1. `bash scripts/gate.sh` IN-TURN, FOREGROUND, raw log kept. `0` = VERIFIED, `2` = the suite did NOT
   run, `9` = lock busy → wait and retry. Report a FULL green run with its counts.
2. Your differential: **commit first**, then at least TWO arms, each aimed at a DIFFERENT mechanism:
   (a) the limiter's WINDOW never rolls (the reset comparison inverted) → R3 must go RED; (b) the
   bucket cap removed (unbounded growth) → R6 must go RED while R2 stays green (so the arm isolates
   the bound, not the limiter). Print each mutated file's sha256 before and after; hold the gate lock
   across BOTH arms; restore from `HEAD` in an `EXIT INT TERM` trap and assert each hash is back; an
   arm that reddens a pin it did not name, or that breaks the TYPECHECK (`error TS`), is VOID.
3. `git -C /home/administrator/projects/ServerStore/worktrees/rate-limit pull --rebase origin main`,
   then `git push origin HEAD:main`.
4. **Do NOT generate synthetic load against `https://store.futuremagic.de`** (the host rule forbids
   it) and do not restart the live unit yourself. If you cannot finish, COMMIT the coherent partial
   state on your branch and report BLOCKED — and if you can PROVE a design choice of this brief wrong
   (including "before the guard", the header order, or the 600 default), report BLOCKED with the
   evidence rather than implementing around it.

## Docs to amend in the SAME commit

`docs/DECISION-LEDGER.md` **row 65**; `docs/SEAM-INDEX.md` (the limiter seam: where it sits in the
pipeline and WHY it is before the guard, the identity order, the bounded table, the exemption list,
and the exposed `Retry-After`); `docs/TESTING.md` (R1–R8, both arms with hashes, the CORS-pin change
with its reason, honest unknowns — in-memory means a restart forgets, and one process means no
cross-process limit); `docs/BOARD.md` LANDED row; `docs/API.md`; `docs/DEPLOYMENT.md`.
**Carry the `COPIES:` line** — `COPIES: n→1 — <the seam>` or `COPIES: 1 — checked (grepped: <what>)`.
The last slice's landing forgot it and the dispatcher had to carry it; do not repeat that.

## Your report (short)

`LANDED` or `BLOCKED`, then: the resolved base sha; the code sha; gate counts; each arm with its
printed hashes and exactly which pin went red; the `COPIES:` line; every judgement call the brief left
open; the docs amended; and anything this brief got wrong.
