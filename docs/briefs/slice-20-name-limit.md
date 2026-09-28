# Brief — slice 20 (K2): names up to 1024 characters

Cut from `docs/BRIEF.md`. Self-contained. Ledger row assigned by the dispatcher: **88**.

---

You are a WRITER on **ServerStore** (Node 24 + TypeScript, pnpm, vitest, ONE gate; the console is
NO-BUILD static JS). Read `/home/administrator/projects/ServerStore/AGENTS.md` FIRST, then
`docs/DECISION-LEDGER.md` rows **61** (the name language is prefix-closed and `prefix=` reuses the same
rule), **84/85** (the console's destructive flows and the browser harness), **86** (why the 64 MiB item
cap stays) and **87** (this slice's design — the authority), plus `src/core/validate.ts`,
`docs/API.md`, `docs/STORAGE.md`, `docs/SEAM-INDEX.md` and `tests/browser.test.ts`.

## Where you work (READ THIS TWICE)

Worktree `/home/administrator/projects/ServerStore/worktrees/name-limit`, branch `feat/name-limit`,
already created and installed. EVERY read/edit/write/bash call MUST use an ABSOLUTE path under that
worktree. Never touch the main tree. You are the only writer in flight.

Resolve your base yourself (`git -C .../worktrees/name-limit rev-parse --short origin/main`) and record
the resolved sha in your landing row. Do not trust a sha quoted from memory, including any in this brief.

**Never touch the live service or `/home/administrator/serverstore-data`.**

You are a subagent: your background jobs DIE when your turn ends. Run the gate IN-TURN, foreground.

## Why this slice exists

The owner's other project hit the 64-character name limit. His decision (row 87): **names may be up to
1024 characters; the 64 MiB item cap stays exactly as it is.**

## What to change (and it is deliberately small)

1. **`src/core/validate.ts` — make the limit ONE piece of data, not four copies.** The owner's
   correction (ledger row 87b) supersedes the original wording here: this must NOT be done by editing
   the regex literal and the two messages. Today the number lives in the constant AND as `{0,63}` in the
   pattern AND as a retyped pattern string in the charset message AND as `65` in the tests.
   **The corrected shape:** name the alphabet and the maximum (`NAME_CHARSET`, `NAME_MAX_LENGTH` — the
   length being the ONLY number), BUILD the pattern from them (`new RegExp(...)` over
   `${NAME_MAX_LENGTH - 1}`), and have both refusal messages and any other surface read the pattern's own
   SOURCE rather than retyping it. A future change to the limit must then be ONE edit that cannot leave
   a stale pattern or a lying message behind. Tests derive their boundary from the constant
   (`NAME_MAX_LENGTH + 1`), never `65`/`1025`.
   **The widening applies to store names, entry names, the `prefix=` filter and key ids AT ONCE**,
   because `parseName()` is the one parser on purpose. State that as a consequence in the docs (a
   1024-character STORE name is legal now) rather than adding a second, shorter limit for stores — a
   second limit is exactly the drift the single parser exists to prevent.
2. **`src/server/ratelimit.ts` MUST NOT CHANGE.** Its `MAX_IDENTITY_LENGTH = 64` is a DIFFERENT 64: the
   truncation of a rate-limit bucket key for an attacker-controlled header. Leave it alone; if you
   touch it, a rate-limit pin will (rightly) fail.
3. **No schema change and no migration.** Every stored name is ≤64 and stays legal; this is a widening.
4. **Docs that state the number today, all of which must move with the code:** `docs/API.md` (the
   charset line, the name section's "1–64", the refusal sentence), `docs/STORAGE.md` (the limits
   bullet), and the current-schema comment in `tests/objects.test.ts`.
   **Do NOT rewrite HISTORY:** the older rows of `docs/DECISION-LEDGER.md` (59/60/65/86), the older
   board lines, and the earlier `docs/briefs/slice-*.md` describe the rule as it was and stay exactly as
   written. A record edited to match the present is not a record; the NEW row explains the change.
5. **The console must survive a very long name.** The entry list and the store rows were built when 64
   was the maximum; add the CSS needed (`overflow-wrap`/`word-break` or an ellipsis — your call, say
   which) so a 1024-character name cannot break the page, and prove it with the browser pin below.
6. **The seam index gains the portability note:** a future NON-SQLite backend must decide what to do
   about names longer than its own key limit (LMDB keys cap around 511 bytes), so the constraint lives
   where the next reader looks rather than only in a ledger row.

## Pins (a pin's NAME is part of the deliverable; use the **Z** prefix)

1. `PIN Z1: the boundary holds in BOTH directions` — a **1024**-character entry name round-trips
   (PUT → GET byte-identical → DELETE), and a **1025**-character name is refused `400 invalid_name`
   with nothing written. Assert the accepted length is exactly 1024 (not "long enough").
2. `PIN Z2: it is ONE rule, so the prefix filter and STORE names widen with it` — a 1024-character
   `prefix=` is accepted (and returns the empty list when nothing matches) while a 1025-character one
   is `400 invalid_name`; a 1024-character STORE name can be created and listed.
3. `PIN Z3: the refusal message tells the truth` — the `invalid_name` message states **1024** and
   quotes the SAME pattern the parser enforces (read the pattern out of the message and check a
   name built from it, or assert the message against the exported constant — but a hard-coded "1024"
   in the test is not enough: drifting the CODE to 1024 and leaving the MESSAGE at 64 must fail).
4. `PIN Z4: the docs track the CONSTANT` — `docs/API.md`'s charset line and limits sentence and
   `docs/STORAGE.md`'s limits bullet state the limit the CODE enforces, asserted by reading the
   exported constant rather than a literal, so a future change to the limit fails this pin until the
   prose moves with it (a doc pin in the spirit of PIN A2/A3; the HISTORICAL rows/board/briefs are
   exempt by design and must not be "fixed" to make this pass).
   **AND THE PIN THAT CARRIES THE OWNER'S POINT — `PIN Z6: the bound lives in exactly ONE place under
   `src/`** — a grep-level claim (in the spirit of PIN Y8): the numeric maximum must not appear a second
   time as a literal anywhere under `src/` (no `{0,1023}` literal, no retyped pattern string, no second
   constant), so "changing the limit is one constant" is a TESTED property and a future writer who
   retypes the number fails the gate. State in the docs which occurrences are legitimately exempt (if
   any) rather than weakening the pin.
5. `PIN Z5: the console renders and still works with a 1024-character name` — in the REAL browser
   (the harness from rows 68/84): seed a 1024-character entry, open the store, see the row, and delete
   it through the UI with the API read back. The page must not overflow or break (assert the row is
   reachable and the delete succeeds; a screenshot claim is out of scope — say so).

## Verification (yours)

1. `bash scripts/gate.sh` IN-TURN, FOREGROUND, raw log kept. `0` = VERIFIED, `2` = the suite did NOT
   run, `9` = lock busy → wait and retry. Report the full counts and the browser file's duration (the
   Z5 flow adds to every gate run — say how much).
2. **Commit first**, then TWO arms in OPPOSITE directions, each watched RED against a NAMED pin:
   (a) **too strict** — set `NAME_MAX_LENGTH` back to 64 (leaving the pattern alone) → **Z1 (or Z2)
   must go RED** on the accepted-1024 half;
   (b) **too loose** — remove the length check entirely (leave the pattern's `{0,1023}` out of it by
   testing only the charset) → **Z1's refusal half must go RED** while the accepted half stays green.
   Print `validate.ts`'s sha256 before and after each arm, hold the gate lock across BOTH, restore from
   `HEAD` in an `EXIT INT TERM` trap and assert the hash is back; `error TS` = VOID; name any second pin
   that falls as a declared twin.
3. `git -C /home/administrator/projects/ServerStore/worktrees/name-limit pull --rebase origin main`,
   then `git push origin HEAD:main`.
4. If you cannot finish, COMMIT the coherent partial state and report BLOCKED — and if you can PROVE a
   choice in row 87 wrong (including the one-rule widening covering store names, or a Z pin being
   unfalsifiable), report BLOCKED with the evidence rather than implementing around it.

## Docs to amend in the SAME commit

`docs/DECISION-LEDGER.md` **row 88**; `docs/SEAM-INDEX.md` (the name rule's new bound and the
portability note); `docs/TESTING.md` (Z1–Z5, both arms with hashes, the browser file's new cost, honest
unknowns — e.g. a 1024-character name in a URL is still far inside HTTP limits, and no length-related
performance claim is made); `docs/BOARD.md` LANDED row; `docs/API.md`; `docs/STORAGE.md`.
**Carry the `COPIES:` line** — `COPIES: n→1 — <the seam>` or `COPIES: 1 — checked (grepped: <what>)`.
The obvious duplication risk here is the number 1024 appearing in more than one place; if the message
and the pattern can be derived from the exported constant, derive them, and say what you grepped.

## Your report (short)

`LANDED` or `BLOCKED`, then: the resolved base sha; the code sha; gate counts and the browser file's
duration; each arm with its printed hashes and exactly which pin went red; the `COPIES:` line; the
self-match-free chrome count after the run; every judgement call the brief left open (especially the CSS
choice and how the message is derived); the docs amended; and anything this brief got wrong.
