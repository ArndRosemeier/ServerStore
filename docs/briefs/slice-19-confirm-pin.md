# Brief — slice 19 (J2): make the single-item confirmation FALSIFIABLE

Cut from `docs/BRIEF.md`. Self-contained. Ledger row assigned by the dispatcher: **84**.
**TEST-ONLY slice: no product change is expected.** The guard already works (row 82); what is missing
is a pin that can FAIL if it stops working.

---

You are a WRITER on **ServerStore** (Node 24 + TypeScript, pnpm, vitest, ONE gate; the console is
NO-BUILD static JS). Read `/home/administrator/projects/ServerStore/AGENTS.md` FIRST, then
`docs/DECISION-LEDGER.md` rows **39** (why an unfalsifiable check is a trap and got DELETED), **68/69**
(the browser-test harness), **81** (the console design, including "two weights of confirmation") and
**83** (the verification that found this hole), plus `tests/browser.test.ts`, `tests/helpers/browser.ts`
and `web/app.js` (`armGuard`, and the key/entry Delete wiring).

## Where you work (READ THIS TWICE)

Worktree `/home/administrator/projects/ServerStore/worktrees/confirm-pin`, branch `feat/confirm-pin`,
already created and installed. EVERY read/edit/write/bash call MUST use an ABSOLUTE path under that
worktree. Never touch the main tree. You are the only writer in flight.

Resolve your base yourself (`git -C .../worktrees/confirm-pin rev-parse --short origin/main`) and
record the resolved sha in your landing row. Do not trust a sha quoted from memory, including any in
this brief.

**Never touch the live service or `/home/administrator/serverstore-data`.**

You are a subagent: your background jobs DIE when your turn ends. Run the gate IN-TURN, foreground.

## Why this slice exists

Row 81 designed TWO weights of confirmation: a whole store needs its name TYPED and sent as the
server's token, and ONE key or ONE entry needs a plain two-step confirmation (`armGuard` shows a
"Confirm delete" button). The whole-store gate IS falsifiable (PIN V4 fails when the token is
pre-filled). **The single-item gate is NOT:** during row 83's verification I injected exactly the
defect it is supposed to prevent — `options.onConfirm()` running on the FIRST click, so one unguarded
click destroys a key — and **nothing failed**. V1 and V3 assert the END state (the key is gone, the
credential `401`s, the entry has disappeared) and never that the first click destroys nothing.

An implemented safety control that no test can fail is the trap row 39 DELETED an unreachable subset
check for. So this slice makes it falsifiable.

## What to build

1. **A pin that fails when a single-item action runs on the first click.** Cover BOTH controls that
   share the `armGuard` seam — **deleting a KEY** and **deleting an ENTRY** — by asserting the
   intermediate state:
   - after the FIRST click on the destructive control, **nothing has changed**: the key is still in
     `GET /keys` and its credential still authenticates; the entry is still in
     `GET /stores/{store}/objects` and still readable — AND the confirmation affordance is present on
     screen (so "nothing happened because the control is broken" cannot pass);
   - after the CONFIRM click, the change has happened (the key is gone and `401`s; the entry is gone).
   Name it `PIN V8: a single-item destructive action does nothing until it is confirmed` (or extend V1
   and V3 with the intermediate assertions — your call, but the FAILING behaviour must be the same one
   my arm injected, and one pin or two must be reported clearly). If you extend V1/V3, keep their
   existing end-state assertions intact.
2. **Nothing else.** No product change is expected. If you find you must change `web/app.js` to make
   the pin expressible, STOP and report BLOCKED with the evidence — the guard is claimed to work, and
   a test that needs the product moved is a different slice.
3. **Keep the gate's cost flat.** The browser file is already ~3.6s and runs on every gate run; prefer
   extending the EXISTING flows (the fixture already mints a throwaway key and seeds entries) over
   opening new pages or spawning new services. Report the browser file's duration before and after.

## Verification (yours)

1. `bash scripts/gate.sh` IN-TURN, FOREGROUND, raw log kept. `0` = VERIFIED, `2` = the suite did NOT
   run, `9` = lock busy → wait and retry. Report the full counts and the browser file's duration.
2. **The differential is the point of this slice, and it is ONE arm:** commit first, then inject the
   ROW-83 DEFECT into `web/app.js` — make `armGuard` run `options.onConfirm()` on the first click (the
   guard's action fires immediately, so one click destroys) — and require **YOUR NEW PIN TO GO RED**.
   Hold the gate lock across control + arm + control, print `web/app.js`'s sha256 before and after,
   restore from `HEAD` in an `EXIT INT TERM` trap with the hash asserted back, and report the pin that
   fell. An arm that reddens everything (i.e. your pin is not the one that catches it) must be
   reported as such, with the pins that fell named.
   **Also state, in your report, the negative control:** the unmodified tree is GREEN, so the pin is
   not merely always-red.
3. `git -C /home/administrator/projects/ServerStore/worktrees/confirm-pin pull --rebase origin main`,
   then `git push origin HEAD:main`.
4. If you cannot finish, COMMIT the coherent partial state and report BLOCKED — including the case
   where the pin CANNOT be made to fail (that is a finding, not a failure: say what you tried and what
   the console does instead).

## Docs to amend in the SAME commit

`docs/DECISION-LEDGER.md` **row 84** (short: what the pin now asserts, the arm that proves it fails,
and the browser file's cost); `docs/TESTING.md` (the new/extended pin, the arm with its hashes, and the
negative control); `docs/BOARD.md` LANDED row.
**Carry the `COPIES:` line** — this is a test slice, so say what you grepped and whether the
intermediate-state assertion is ONE helper used by both controls or two copies of the same logic
(if you write it twice, fold it — that is the `COPIES:` rule doing its job).

## Your report (short)

`LANDED` or `BLOCKED`, then: the resolved base sha; the code sha; gate counts and the browser file's
duration before/after; the ARM with its printed hashes and the pins that fell; the negative control;
the `COPIES:` line; the scoped chrome count after the run (`ps -eo args | grep -c
'ServerStore/.*browser-scratch'` is SELF-MATCHING — use a pattern that cannot match its own argv, as
slice 18's writer did); and anything this brief got wrong.
