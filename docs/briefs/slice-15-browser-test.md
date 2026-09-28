# Brief — slice 15 (G1): the headless-browser test the console and CORS are owed

Cut from `docs/BRIEF.md`. Self-contained. Ledger row assigned by the dispatcher: **68**.

---

You are a WRITER on **ServerStore** (Node 24 + TypeScript, pnpm, vitest, ONE gate). Read
`/home/administrator/projects/ServerStore/AGENTS.md` FIRST, then `docs/DECISION-LEDGER.md` rows **49**,
**53/54** (the console and its owed browser test), **57/58** (CORS and its browser half), **64/66**
(rate limiting — note the limiter is now in the request path), **67** (this slice's design — the
authority), `docs/SEAM-INDEX.md` and `docs/API.md`.

## Where you work (READ THIS TWICE)

Worktree `/home/administrator/projects/ServerStore/worktrees/browser-test`, branch
`feat/browser-test`, already created and installed. EVERY read/edit/write/bash call MUST use an
ABSOLUTE path under that worktree. Never touch the main tree. You are the only writer in flight.

Your base is the tip of `origin/main` that carries THIS brief — **resolve it and record the resolved
sha in your landing row** (`git -C /home/administrator/projects/ServerStore/worktrees/browser-test
rev-parse --short origin/main`). Do not trust a sha quoted from memory, including this one.

You are a subagent: your background jobs DIE when your turn ends. Run the gate IN-TURN, foreground.

## Why this slice exists

Two product surfaces have never been executed in the environment they exist for — a browser:

1. **The admin console** (rows 49/54): U1–U4 are STATIC scans of the served bytes. Nothing clicks
   Connect, nothing clicks Edit, so the C2 `PATCH` flow is proven only by driving the route directly.
2. **CORS** (rows 57/58): O1–O6 assert the HEADERS a browser needs, in process. The half that
   actually BLOCKS a disallowed origin is the browser's own, and it has never run.

**This is a TEST-ONLY slice: no product code changes.** `/usr/bin/google-chrome` is installed on this
box. The owner chose to drive it directly (board row 66) — do not add a dependency.

## What to build

1. **`tests/helpers/browser.ts` — the ONE seam.** It owns everything browser-shaped:
   - **launch** `/usr/bin/google-chrome` with `--headless=new`, `--no-first-run
     --no-default-browser-check --disable-gpu --disable-dev-shm-usage`, a **temp `--user-data-dir`
     under the WORKTREE** (never `/tmp`), and a loopback `--remote-debugging-port` you choose (port 0
     plus reading `DevToolsActivePort` from the profile is the robust way);
   - **connect** to the DevTools WebSocket with Node's built-in global `WebSocket` (Node 24 — no
     package) and speak just enough CDP: `Target.*` (or the browser-level
     `/json/new?url=` HTTP endpoint), `Page.navigate`, `Runtime.evaluate` with `awaitPromise: true`,
     and `Input.dispatchMouseEvent`/`Input.insertText` for interaction;
   - **interact like a user where it matters**: prefer the `Input.*` domain (TRUSTED events) for the
     console click/typing flow; if you use `element.click()` say so in the docs and why;
   - **kill**: Chrome is a process TREE. Start it in its OWN PROCESS GROUP and kill the GROUP
     (`process.kill(-pid, 'SIGKILL')` after SIGTERM), from `afterAll` **and** a failure path, so no
     error route can skip cleanup. Assert afterwards that the tree is gone.
   - **Missing browser = a LOUD FAILURE**, never a skip: if `/usr/bin/google-chrome` is not
     executable, `throw` with a message naming the path. Do not `describe.skip`, do not
     `it.skipIf`, do not catch it into a pass.
2. **`tests/browser.test.ts` — the pins.** Spawn the API the way `tests/entrypoint.test.ts` already
   does (the repo's own entrypoint, a scratch data root, a free loopback port). You will need a
   MASTER KEY inside that service's database: use the project's ONE mint path in process before the
   spawn (or `pnpm run admin:key`) — never a hand-written row. **The rate limiter is now in the
   request path:** give the spawned service a limit you cannot reach (`SERVERSTORE_RATE_LIMIT=0` or a
   large value) so a new test cannot fail for a limiter reason, and say so in a comment.
3. **Cross-origin for real:** a tiny Node stdlib HTTP server on its OWN loopback port serves a minimal
   page (`<html><body>ok</body></html>`); the `fetch` under test is evaluated in THAT page's context,
   so the request is genuinely cross-origin. A THIRD origin (a second tiny server, or a second port)
   is the disallowed one when the API is spawned with `SERVERSTORE_CORS_ORIGINS=<the allowed origin>`.
   No HTML fixture file is needed and none should be added.

## Pins (a pin's NAME is part of the deliverable)

1. `PIN B1: the console's JavaScript RUNS in a real browser` — navigate to the spawned service's `/`,
   wait for the connect form, and assert NO page error was reported (`Runtime.exceptionThrown` /
   `Log.entryAdded`) — a served-but-broken page must fail here.
2. `PIN B2: a master key typed into the console AUTHENTICATES through the UI` — insert the key, click
   Connect with a TRUSTED event, and assert the console shows the authenticated view (its own
   `GET /whoami` succeeded). Assert the key is NOT in the URL and NOT in `localStorage`/`sessionStorage`
   (the C1 promise, now measured in the real environment).
3. `PIN B3: the console's EDIT flow really PATCHes` — click Edit on a key row, change the label (and a
   permission), save, and assert the EFFECT through the API (the key's label/perms really changed) —
   not merely that the DOM changed.
4. `PIN B4: a real browser on ANOTHER ORIGIN completes a request carrying Authorization` — from the
   second origin's page context, `fetch(api + "/stores", {headers: {Authorization: "Bearer <key>"}})`
   resolves with `200` and the parsed body. This is the preflight + Allow-Headers path, enforced by a
   browser rather than asserted in process.
5. `PIN B5: that browser can READ x-serverstore-sha256` — the exposed header is readable from the
   cross-origin response object.
6. `PIN B6: a DISALLOWED origin is blocked BY THE BROWSER` — with the API spawned under an explicit
   allowlist, the same fetch from the OTHER origin REJECTS (a `TypeError`), which is the half no
   in-process pin can show. Assert the rejection is the browser's CORS refusal and that the API itself
   was never reached with that origin (e.g. the preflight fell through to 401).
7. `PIN B7: nothing outlives the test` — after the file, the Chrome process tree is gone (assert with
   `process.kill(pid, 0)` throwing, and record the self-match-free count
   `ps -eo comm= | grep -c '^chrome$'` → 0 in your report) and every spawned server is stopped.
8. `PIN B8: a missing browser FAILS loudly` — the helper's launch path throws a NAMED error when the
   binary is absent; prove it by pointing the helper at a non-existent path (an injected
   `executablePath`) and asserting the throw, so "no browser" can never be a silent pass.

Every wait must have a DEADLINE that FAILS (no `sleep`-and-hope, no silent retry loops), and the whole
file should finish well inside a minute on this box.

## Verification (yours)

1. `bash scripts/gate.sh` IN-TURN, FOREGROUND, raw log kept. `0` = VERIFIED, `2` = the suite did NOT
   run, `9` = lock busy → wait and retry. Report a FULL green run with its counts, and report the
   browser test's own duration so the next reader knows what it costs the gate.
2. **Prove the browser test can FAIL**: your differential needs at least TWO arms, each watched RED
   against a NAMED pin, in a way that does not need product code:
   (a) break the CONSOLE's served asset (e.g. make `web/app.js` throw at load, or remove the Edit
   affordance) → B1 or B3 must go RED while B4–B6 stay GREEN;
   (b) make the API's CORS step NOT expose `x-serverstore-sha256` (or drop `authorization` from
   Allow-Headers) → B5 (or B4) must go RED while the console pins stay GREEN.
   Print each mutated file's sha256 before and after, hold the gate lock across BOTH arms, restore
   from `HEAD` in an `EXIT INT TERM` trap and assert each hash is back; an arm that reddens a pin it
   did not name, or that breaks the typecheck (`error TS`), is VOID.
3. `git -C /home/administrator/projects/ServerStore/worktrees/browser-test pull --rebase origin main`,
   then `git push origin HEAD:main`.
4. **Do NOT generate synthetic load against `https://store.futuremagic.de`**, do not restart the live
   unit, and do not leave a browser running: your own spawns only, and everything you start is dead
   before you report (on success AND on failure). If you cannot finish, COMMIT the coherent partial
   state on your branch and report BLOCKED — and if you can PROVE a choice in this brief wrong (the
   Chrome flags, the CDP approach, the trusted-event requirement, putting it in the gate), report
   BLOCKED with the evidence rather than implementing around it.

## Docs to amend in the SAME commit

`docs/DECISION-LEDGER.md` **row 68**; `docs/SEAM-INDEX.md` (the browser seam: the helper as the ONE
place Chrome is launched/driven/killed, the process-GROUP rule, the loud-failure rule, and what the
browser now covers that in-process pins cannot); `docs/TESTING.md` (B1–B8, both arms with hashes, the
cost of the file in the gate, and the honest unknowns — e.g. one browser engine only, and a scripted
UI flow is not a claim about visual layout); `docs/BOARD.md` LANDED row.
**Carry the `COPIES:` line** — `COPIES: n→1 — <the seam>` or `COPIES: 1 — checked (grepped: <what>)`.
There must be exactly ONE place that launches a browser and ONE place that kills a process tree.

## Your report (short)

`LANDED` or `BLOCKED`, then: the resolved base sha; the code sha; gate counts and the browser file's
duration; each arm with its printed hashes and exactly which pin went red; the `COPIES:` line; the
chrome-process count after the run (must be 0); every judgement call the brief left open; the docs
amended; and anything this brief got wrong.
