# Brief — slice 18 (J1): the console's four destructive actions

Cut from `docs/BRIEF.md`. Self-contained. Ledger row assigned by the dispatcher: **82**.

---

You are a WRITER on **ServerStore** (Node 24 + TypeScript, pnpm, vitest, ONE gate; the console is
NO-BUILD static JS). Read `/home/administrator/projects/ServerStore/AGENTS.md` FIRST, then
`docs/DECISION-LEDGER.md` rows **49** (the console and its security promises), **53** (rename/edit and
the audit stamp), **61** (`prefix=`), **68/69** (the browser test that will verify you), **70** (the
owner's ask, verbatim), **71/73** (the destructive API, LIVE) and **81** (this slice's design — the
authority for every choice below), plus `docs/SEAM-INDEX.md`, `docs/API.md` and `tests/browser.test.ts`.

## Where you work (READ THIS TWICE)

Worktree `/home/administrator/projects/ServerStore/worktrees/console-destructive`, branch
`feat/console-destructive`, already created and installed. EVERY read/edit/write/bash call MUST use an
ABSOLUTE path under that worktree. Never touch the main tree. You are the only writer in flight.

Your base is the tip of `origin/main` that carries THIS brief — **resolve it and record the resolved
sha in your landing row**. Do not trust a sha quoted from memory, including this one.

**Never touch the live service or `/home/administrator/serverstore-data`.** Your tests spawn their own
service with their own scratch data root.

You are a subagent: your background jobs DIE when your turn ends. Run the gate IN-TURN, foreground.

## Why this slice exists

The owner administers the store entirely through the console and asked for four things (row 70). The
ROUTES for all four are already built, verified and LIVE (rows 71/73) — this slice is the console and
nothing else. Verbatim: *"A way to actually DELETE keys. Revoked keys will clutter the UI. Look inside a
store (just the names of the blobs) and a way to delete items inside the store. Emptying a whole store
(with confirmation). Deleting a store (with confirmation)."*

## What the console can call TODAY (verified in `src/server/app.ts` — do not invent routes)

| Call | Result |
| --- | --- |
| `GET /stores/{store}/objects[?prefix=]` | `{objects:[{store,name,sha256,size,createdAt}]}` |
| `DELETE /stores/{store}/objects/{name}` | `204` |
| `DELETE /stores/{store}/objects?confirm=<store>` | `200 {store,deleted}` |
| `DELETE /stores/:store?confirm=<store>` | `200 {name,deletedAt}`; `409 conflict` while any key's scope names the store; `400 bad_request` on a missing/wrong token |
| `DELETE /keys/:id` | `200 {id,deletedAt}`; `409 conflict` for the LAST live admin key |

## What to build (all UI, in `web/`)

1. **Key rows: a Delete action.** Every key row (including a REVOKED one — that is the owner's actual
   complaint) gets a Delete control, visually distinct from Revoke/Edit, with a plain confirmation
   (inline two-step or `confirm()`). On success the pane refreshes and a status line says what
   happened; a `409` (last live admin key) is shown through the ONE error surface, legibly.
2. **Store rows: an "open" affordance that shows the entries.** Fetch on demand with
   `GET /stores/{store}/objects`, render the NAMES (plus size/createdAt and the sha256 in a
   compact/abbreviated form), and a prefix input that re-queries with `&prefix=` — **filter
   server-side, never by shipping the whole store and filtering in the browser.** Show the entry count.
3. **Per-entry Delete** with a plain confirmation, refreshing the list afterwards.
4. **Empty this store** — requires the store name TYPED into a field that is never pre-filled; the
   typed text is what goes into `?confirm=`. If the typed text does not match, do not send the
   request. Show the server's `400` if one arrives anyway, and show the `deleted` count on success.
5. **Delete this store** — the same typed-name rule. On `409`, render the server's message (it names
   the blocking keys) and keep the keys panel reachable: the owner clears the blocker by deleting or
   editing that key, then retries. **Do not parse the prose for ids and do not auto-delete anything.**
6. **A blocked/failed destructive action must never look like a success**: after every attempt the
   affected pane refreshes, and the outcome is stated in the console's own status/error surface.

## The console's existing promises (do NOT break them — they are pinned)

- The key lives IN MEMORY ONLY (`web/app.js` has no `localStorage`/`sessionStorage`/cookie/history
  use; `U2` scans the SERVED bytes). Do not add one, not even to remember the open store.
- **Every path the console calls must be a route the app registers** (`U3`). No new fetch targets.
- The shell stays same-origin with no inline script (`U4`); the three asset routes are unchanged
  (`U1`), and `UI_ASSETS` remains the ONE place they are named.
- Reuse the existing seams: the ONE `api()` helper, `showError`/`showStatus`, `guard()`, and the
  existing render/refresh functions. Folding duplicated markup into a helper is part of the change if
  you find yourself writing it twice.
- The page must stay usable on a phone (the CSS is already mobile-friendly) and must not fetch
  anything until a key has been accepted (the existing `GET /whoami` gate).

## Pins (a pin's NAME is part of the deliverable; use the **V** prefix)

1. `PIN V1: the console deletes a KEY, and the credential dies` — through the REAL browser: mint a
   throwaway key in the UI, click Delete, confirm; then assert through the API that the key is gone
   from `GET /keys` AND that the deleted key's own credential now answers `401`.
2. `PIN V2: the console shows a store's ENTRIES, and the prefix filter is server-side` — seed known
   entries; opening the store lists exactly them (names visible); typing a prefix narrows the list to
   the matching entries only. Assert the request carried `prefix=` (e.g. by seeding an entry that a
   client-side filter would wrongly include, or by observing the network path) — a client-side filter
   must not pass this pin.
3. `PIN V3: the console deletes ONE entry` — click the row's delete, confirm, and assert via the API
   that that entry is gone and the OTHER entry is still readable.
4. `PIN V4: emptying needs the TYPED name, and a wrong name changes nothing` — with a wrong typed
   name the request must not be sent (or must be refused) and every entry must still be there
   (assert through the API); with the right name the store is emptied (`GET …/objects` is empty).
5. `PIN V5: a BLOCKED store delete is shown, and then succeeds once the key is gone` — with a key
   scoped to the store, deleting the store must show the `409` message in the console and the store
   must SURVIVE (assert via the API); delete that key through the UI (V1's flow), retry the store
   delete, and assert the store is gone from `GET /stores`.
6. `PIN V6: the console's existing promises hold with the new controls` — no persistence API in the
   served bytes (`U2`), every path called is a registered route (`U3`), the shell is unchanged in the
   ways `U1`/`U4` assert, and no error path leaves a stale row looking like a success.
7. `PIN V7: the outcomes are legible` — the `409` (blocked), `400` (wrong token) and `403`/`429`
   paths each render the server's own message through the console's error surface rather than
   failing silently or claiming success.

Reuse the ONE fixture set (`tests/helpers/server.ts`); never a second one. The browser test already
owns the browser lifecycle (`tests/helpers/browser.ts`) — extend it, do not write a second harness.
**The browser test must stay BOUNDED and in-turn**, with a deadline on every wait that FAILS, no
`skip`, and the process-tree kill on the failure path as well as the happy one.

## Verification (yours)

1. `bash scripts/gate.sh` IN-TURN, FOREGROUND, raw log kept. `0` = VERIFIED, `2` = the suite did NOT
   run, `9` = lock busy → wait and retry. Report a full green run with its counts AND the browser
   file's new duration (the console flows add time to every gate run — say how much).
2. **Commit first**, then TWO arms aimed at DIFFERENT mechanisms: (a) make the console send the
   store-delete request WITHOUT the typed confirmation (or pre-fill the token) → **V4 (or V5) must go
   RED**; (b) make the entry list filter CLIENT-SIDE (fetch all, filter in JS) → **V2 must go RED**
   while the other pins stay green. Print each mutated file's sha256 before and after; hold the gate
   lock across BOTH arms; restore from `HEAD` in an `EXIT INT TERM` trap and assert the hashes are
   back; `error TS` = VOID; name any second pin that falls as a declared twin.
3. `git -C /home/administrator/projects/ServerStore/worktrees/console-destructive pull --rebase origin
   main`, then `git push origin HEAD:main`.
4. If you cannot finish, COMMIT the coherent partial state and report BLOCKED — and if you can PROVE
   a choice in row 81 wrong (including the two confirmation weights or the display-don't-parse rule),
   report BLOCKED with the evidence rather than implementing around it.

## Docs to amend in the SAME commit

`docs/DECISION-LEDGER.md` **row 82**; `docs/SEAM-INDEX.md` (the console's destructive flows: the two
confirmation weights, the on-demand entry fetch and the server-side prefix, the display-don't-parse
rule for the `409`, and the refresh-after-action rule); `docs/TESTING.md` (V1–V7, both arms with
hashes, the browser file's new cost, honest unknowns — e.g. a scripted click is not a layout claim, and
the `409` body is prose); `docs/BOARD.md` LANDED row; `docs/API.md` only if a console-facing sentence
is now wrong.
**Carry the `COPIES:` line** — `COPIES: n→1 — <the seam>` or `COPIES: 1 — checked (grepped: <what>)`.

## Your report (short)

`LANDED` or `BLOCKED`, then: the resolved base sha; the code sha; gate counts and the browser file's
duration; each arm with its printed hashes and exactly which pin went red; the `COPIES:` line; the
chrome-process count after the run, **scoped to our own profile directory** (a bare `^chrome$` count
measures the neighbours on this shared box — TRAP t8); every judgement call the brief left open; the
docs amended; and anything this brief got wrong.
