# Brief — slice 12 (D1): CORS for browsers on other origins

Cut from `docs/BRIEF.md`. Self-contained. Ledger row assigned by the dispatcher: **57**.

---

You are a WRITER on **ServerStore** (Node 24 + TypeScript, pnpm, vitest, ONE gate). Read
`/home/administrator/projects/ServerStore/AGENTS.md` FIRST, then `docs/DECISION-LEDGER.md` rows 7, 21,
28, 30, 32, **43**, **56**, `docs/SEAM-INDEX.md`, and `docs/API.md`.

## Where you work (READ THIS TWICE)

Worktree `/home/administrator/projects/ServerStore/worktrees/cors`, branch `feat/cors`, base
`origin/main` = **7798ff6**, already installed. EVERY read/edit/write/bash call MUST use an ABSOLUTE
path under that worktree. Never touch the main tree. You are the only writer in flight.

You are a subagent: your background jobs DIE when your turn ends. Run the gate IN-TURN, foreground.

## Why this slice exists

A turn-based game is being built against this store from **another origin**, and a browser cannot
call this API at all without CORS (row 56). **The trap that makes this more than a header:** the key
guard matches EVERY path before routing, so an `OPTIONS` preflight would answer **401** and the
browser would block the real request. A Cloudflare rule cannot fix that — a preflight needs a 2xx the
origin owns.

## What to build

1. **Config.** `SERVERSTORE_CORS_ORIGINS` — comma-separated allowlist — read in `src/server/config.ts`
   with the project's existing boundary-validation style (trim, drop empties). **When it is unset the
   policy is `*`**, which is safe HERE and only here: the API uses **no cookies and no ambient
   credentials** (the key is an explicit header), so a wildcard grants nothing a key does not already.
2. **A CORS step BEFORE the key guard** in `src/server/app.ts` (the order is the whole point):
   - Any request carrying an `Origin` that is allowed (or the `*` policy) gets
     `Access-Control-Allow-Origin` — the concrete origin when an allowlist is in use, `*` otherwise —
     plus **`Vary: Origin`** whenever the answer depends on the origin.
   - A **preflight** (`OPTIONS` carrying `Access-Control-Request-Method`) is answered **2xx without
     any key**, with `Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS`,
     `Access-Control-Allow-Headers: authorization, x-api-key, content-type` and a `Max-Age`.
     **`authorization` must be named EXPLICITLY** — the `*` wildcard does NOT cover it, and that is the
     classic silent failure.
   - Every response exposes `x-serverstore-sha256` (`Access-Control-Expose-Headers`) so a browser can
     read an object's hash.
   - **`Access-Control-Allow-Credentials` is NEVER sent**, on any response. There are no cookies here
     and there must never appear to be.
   - A **disallowed** origin gets **no** allow-origin header (the browser blocks it). Do not 403 it:
     CORS is a browser-READ control, not an API perimeter — `curl` ignores it and row 21's rule that
     the key is the perimeter stands.
3. **`docs/API.md`**: a short CORS section — the env var, the preflight, that no credentials are ever
   allowed, and that a browser on another origin needs nothing else. **PIN A1–A3 stay green** (no
   route is added, so the route table must not change).

## Pins (a pin's NAME is part of the deliverable)

1. `PIN O1: a preflight is answered 2xx WITHOUT a key` — `OPTIONS` with `Origin` and
   `Access-Control-Request-Method: PATCH`; Allow-Methods includes PATCH and Allow-Headers names
   `authorization` as a whole word.
2. `PIN O2: a cross-origin request with a valid key is readable` — `GET /stores` with `Origin` and a
   key returns the real body plus `Access-Control-Allow-Origin`.
3. `PIN O3: an allowlist is honoured` — with `SERVERSTORE_CORS_ORIGINS` set, a listed origin gets the
   header, an unlisted one does not, and `Vary: Origin` is present.
4. `PIN O4: credentials are never allowed` — no response, preflight or not, carries
   `Access-Control-Allow-Credentials`, and no `Set-Cookie` appears.
5. `PIN O5: nothing else changed` — a request with no `Origin` behaves exactly as before, and the
   three UI routes still serve.

Reuse the ONE fixture set (`tests/helpers/server.ts`); never a second one.

## Verification (yours)

1. `bash scripts/gate.sh` IN-TURN, FOREGROUND, raw log kept. `0` = VERIFIED, `2` = the suite did NOT
   run, `9` = lock busy → wait and retry. Report a FULL green run.
2. Your differential: **commit first**, then TWO arms — (a) move the CORS step AFTER the key guard
   (the preflight then 401s) → **O1 must go RED**; (b) send `Access-Control-Allow-Credentials: true`
   → **O4 must go RED**. Print each file's sha256 before and after; hold the lock across both;
   restore from `HEAD` in an `EXIT INT TERM` trap — **include `web/` in the restore path**; identical
   arms = VOID.
3. `git -C <worktree> pull --rebase origin main`, then `git push origin HEAD:main`.
4. If you cannot finish, COMMIT the coherent partial state on your branch and report BLOCKED.

## Docs to amend in the SAME commit

`docs/DECISION-LEDGER.md` **row 57**; `docs/SEAM-INDEX.md` (the CORS seam and WHY it must precede the
guard); `docs/TESTING.md` (O1–O5, both arms with hashes); `docs/BOARD.md` LANDED row; `docs/API.md`.
**Carry the `COPIES:` line** — `COPIES: n→1 — <the seam>` or `COPIES: 1 — checked (grepped: <what>)`.

## Your report (short)

`LANDED` or `BLOCKED`, then: sha; gate counts + peak; each arm with its printed hash and what went
red; the `COPIES:` line; judgement calls; docs amended; and anything this brief got wrong.
