# Brief — slice 10 (C1): the admin UI (same origin, no build)

Cut from `docs/BRIEF.md`. Self-contained. Ledger row assigned by the dispatcher: **49**.

---

You are a WRITER on **ServerStore** (Node 24 + TypeScript, pnpm, vitest, ONE gate). Read
`/home/administrator/projects/ServerStore/AGENTS.md` FIRST, then `docs/DECISION-LEDGER.md` rows 7, 30,
**43**, **46**, **47**, **48**, `docs/SEAM-INDEX.md`, and `docs/API.md`.

## Where you work (READ THIS TWICE)

Worktree `/home/administrator/projects/ServerStore/worktrees/admin-ui`, branch `feat/admin-ui`, base
`origin/main` (the dispatcher names the sha in the dispatch; it is the tip after B2). EVERY
read/edit/write/bash call MUST use an ABSOLUTE path under that worktree. Never touch the main tree.
You are the only writer in flight.

You are a subagent: your background jobs DIE when your turn ends. Run the gate IN-TURN, foreground.

## The intent

Owner, verbatim: *"I want to have a web UI where i can do all these things after entering the master
key. I do not want to use the terminal to administer this."* Rows 47 and 48 fix the scope and the
two forks: **served by the store service on the same hostname**, and **no-build static assets**.

## What to build

1. **Three fixed asset routes on the service**: `GET /` (the HTML), `GET /app.js`, `GET /app.css`.
   Serve those THREE PATHS from `web/` — literally, with no directory-walking, so no path traversal
   or static-file subsystem is introduced. `GET /` must not shadow any API route.
2. **`web/index.html`, `web/app.js` (one ES module, plain JavaScript), `web/app.css`.** Behaviour:
   - **Key entry.** A `type="password"` field and a button. The key lives in a JavaScript variable for
     the life of the page: **never `localStorage`, never `sessionStorage`, never a cookie, never a URL,
     never `history`, never the console.** A "forget key" button clears it. On load there is no key.
   - **Prove the key.** On entry call `GET /whoami` and show what the key IS (label, stores, perms),
     or the refusal. Nothing else is fetched until that succeeds.
   - **Stores:** list them (`GET /stores`); create one (`POST /stores`, a name).
   - **Keys:** list them (`GET /keys`); mint one (`POST /keys` with `label`, `stores`, `perms`, optional
     `expiresAt`) and show the returned key **ONCE** in a clearly-marked panel with a copy button and a
     blunt warning that it can never be shown again; revoke one (`POST /keys/:id/revoke`).
   - **Permissions:** `read` and `write` checked by default; `delete` and `admin` unchecked, and
     `admin` is never offered for a store-scoped key (the API refuses it anyway — surface that).
   - **Errors are visible**: render the API's `{error:{code,message}}` envelope in the page, never a
     silent failure or a bare `console.error`.
   - **Phone-usable**: layout that works in a narrow browser window.
3. **`docs/API.md`** gains the three UI routes and a short "admin UI" section: what it is for, that the
   key is memory-only, and that it is served from the same origin. **PIN A1–A3 must stay green** — the
   new routes are registered, so the doc must list them, or the pin must exclude them through a NAMED,
   tested list (a silent exclusion is forbidden).

## Pins (a pin's NAME is part of the deliverable)

1. `PIN U1: the UI routes are served, and the served bytes carry no secret` — `GET /` is 200 HTML that
   contains no `ssk_`-shaped string, and `/app.js` and `/app.css` are served with sane content types.
2. `PIN U2: the UI never persists the key` — a source scan of the SERVED `app.js` asserting it
   references none of `localStorage`, `sessionStorage`, `document.cookie`, `location.search`,
   `location.hash`, `history.pushState`.
3. `PIN U3: every path the UI calls is a route the API registers` — parse the request paths out of
   `web/app.js` and require each to match a route from `createApp().routes` (normalise `:id`), so a
   renamed route breaks the UI's pin instead of the user's click.
4. `PIN U4: the HTML carries no inline key and no remote script` — no `<script src="http…">`, no
   inline secret, everything same-origin.

Reuse the ONE fixture set. The UI's logic inside a browser is **not** exercised by any of these — say
so in `docs/TESTING.md` as an honest unknown, and name the headless-browser test as owed.

## Verification (yours)

1. `bash scripts/gate.sh` IN-TURN, FOREGROUND, raw log kept. `0` = VERIFIED, `2` = the suite did NOT
   run, `9` = lock busy → wait and retry. Report a FULL green run.
2. Your differential: **commit first**, then TWO arms — (a) make `app.js` write the key to
   `localStorage` → **U2 must go RED**; (b) make it fetch a path no route registers → **U3 must go
   RED**. Print each file's sha256 before and after; hold the lock across both; restore from `HEAD` in
   an `EXIT INT TERM` trap; identical arms = VOID.
3. `git -C <worktree> pull --rebase origin main`, then `git push origin HEAD:main`.
4. If you cannot finish, COMMIT the coherent partial state on your branch and report BLOCKED.

## Docs to amend in the SAME commit

`docs/DECISION-LEDGER.md` **row 49**; `docs/SEAM-INDEX.md` (the UI seam: the three routes, where the
assets live, and the memory-only key rule); `docs/TESTING.md` (U1–U4, both arms, and the honest
unknown); `docs/BOARD.md` LANDED row; `docs/API.md`. Carry the `COPIES:` line.

## Your report (short)

`LANDED` or `BLOCKED`, then: sha; gate counts + peak; each arm with its printed hash and what went
red; the `COPIES:` line; judgement calls; docs amended; and anything this brief got wrong.
