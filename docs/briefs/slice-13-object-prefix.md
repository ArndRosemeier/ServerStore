# Brief — slice 13 (E1): a `prefix=` filter on the object listing

Cut from `docs/BRIEF.md`. Self-contained. Ledger row assigned by the dispatcher: **61**.

---

You are a WRITER on **ServerStore** (Node 24 + TypeScript, pnpm, vitest, ONE gate). Read
`/home/administrator/projects/ServerStore/AGENTS.md` FIRST, then `docs/DECISION-LEDGER.md` rows 19,
21, 28, 30, **59**, **60**, `docs/SEAM-INDEX.md`, and `docs/API.md`.

## Where you work (READ THIS TWICE)

Worktree `/home/administrator/projects/ServerStore/worktrees/object-prefix`, branch
`feat/object-prefix`, already created and installed. EVERY read/edit/write/bash call MUST use an
ABSOLUTE path under that worktree. Never touch the main tree. You are the only writer in flight.

Your base is the tip of `origin/main` that carries THIS brief — **resolve it and record the resolved
sha in your landing row** (`git -C /home/administrator/projects/ServerStore/worktrees/object-prefix
rev-parse --short origin/main`). Do not trust a sha quoted from memory anywhere, including this brief.

You are a subagent: your background jobs DIE when your turn ends. Run the gate IN-TURN, foreground.

## Why this slice exists

The owner wants a game (and any client) to fetch a **subset** of a store's entries in ONE request
instead of pulling the whole store. Row 59 established the facts: a point read
(`GET /stores/{store}/objects/{name}`) already exists, entries are identified by their **client-chosen
name** (`PRIMARY KEY(store, name)`, charset `[a-z0-9][a-z0-9._-]{0,63}`, ≤64 chars) and NOT by a
server-assigned id, and the real gap is that `GET /stores/{store}/objects` takes **no query parameter
and returns every object in the store**. Row 60 records the owner's choice: **option (A), a `prefix=`
filter** — no schema change, no new identity kind. His game renames its own objects to lead with the
kind (`game.<id>`, `player.<id>.<tag>`, `snap.<id>.<turn>.<seq>.<tag>`), so that three access patterns
map onto three narrow requests. That rename is the GAME's business and is already free (3 test rows,
measured); **the store must not migrate, rename or interpret anything** — it filters strings.

## What to build

1. **ONE seam, in the store-kind handler.** `StoreKindHandler.list(db, store)` in
   `src/storage/kinds.ts` gains an OPTIONAL prefix filter. The filter is SQL over the objects table;
   it must remain inside the handler (that interface is the ONE place a store kind is implemented —
   do not put SQL in `app.ts`).
   **The query MUST be a RANGE on the primary key, so it stays INDEX-usable:**
   `WHERE store = ? AND name >= :p AND name < :upper`. Compute `:upper` as the prefix followed by a
   character greater than every character the name charset can contain (e.g. `"\uffff"`), and say in a
   comment WHY that is safe for `[a-z0-9._-]`. **Do NOT implement it with `LIKE`** (SQLite's default
   `LIKE` is case-INsensitive for ASCII, so the BINARY index cannot be used) **nor with
   `substr(name, 1, len)=:p`** (a full scan). This is not micro-optimisation: "avoid scanning the
   whole store" is the entire point of the slice, and PIN P7 below makes it falsifiable.
2. **ONE parse, existing vocabulary.** Add `parseObjectPrefix(raw)` to `src/core/validate.ts` that
   routes through the EXISTING `parseName` with a new `what` of `"object name prefix"` (extend the
   `NameKind` union). **The rule is deliberately "a prefix must itself be a valid object name"**: the
   legal-name language is PREFIX-CLOSED (every prefix of a legal name is legal), so that one rule
   accepts exactly the strings that can match something and refuses every string that can never match —
   empty/whitespace, uppercase, a `/`, a leading `.`, `..`, or over 64 characters — with the EXISTING
   code `invalid_name` (400). **Do not add an error code, and do not write a second charset regex.**
   A LOUD refusal is required here: silently returning an empty list for an unmatchable prefix hides a
   client bug (AGENTS.md rule 1).
3. **The route.** `GET /stores/:store/objects` reads `c.req.query("prefix")`:
   - **absent** ⇒ EXACTLY today's behaviour: the whole store, ordered by `name`;
   - **present and valid** ⇒ the matching entries only, same order, same field set;
   - **present and invalid** ⇒ `400 invalid_name` (see 2) — never the whole store;
   - **valid but matching nothing** ⇒ `200 {"objects":[]}`, and **never** a `404`.
   Authorization is UNCHANGED (`read`/`admin` on the store; unknown store still `404`), the response
   shape is UNCHANGED (`{objects:[…]}`), and the filter can only narrow WITHIN the authorized store.
4. **Explicitly NOT in this slice** (say so in the docs so the deferrals stay visible):
   `since=`, `limit=`, pagination, cursors, `ETag`/`If-Match` (row 28); server-assigned ids
   (row 59 option B); lookup by `sha256` (row 59 option C); any change to `PUT`/`GET`/`DELETE` by
   name; a `prefix` filter on `GET /stores` or `GET /keys`.
5. **`docs/API.md`**: the route-table row and the `GET /stores/{store}/objects` bullet gain the
   `prefix` parameter with its refusal rule; the "No pagination: a store with many objects returns
   them all" sentence is REPLACED by the truth ("`prefix` is the ONE filter; no pagination, no
   `since`, no limit") rather than left standing. **PIN A1–A3 must stay green** — no route is added,
   removed or renamed.

## Pins (a pin's NAME is part of the deliverable)

1. `PIN P1: ?prefix= returns exactly the matching entries` — a store holding several prefixes,
   including a SHARED PARTIAL one (`room-4` matches `room-42.` and `room-4x`, while `room-42.` does
   NOT match `room-420.x`).
2. `PIN P2: a prefix that matches nothing is 200 with an empty list, never 404`.
3. `PIN P3: an empty or whitespace prefix is refused 400 invalid_name — NOT the whole store`.
4. `PIN P4: an unmatchable prefix is refused, never silently empty` — uppercase, a `/`, a leading `.`,
   `..`, and over 64 characters each give `400 invalid_name`.
5. `PIN P5: with NO prefix the listing is byte-for-byte what it was` — every object, ordered by name.
6. `PIN P6: the filter changes no authorization` — a key without `read` on the store is `403` with and
   without a prefix; an unknown store is still `404`; and a prefix naming another store's namespace
   returns only THIS store's rows.
7. `PIN P7: the prefix query is a RANGE on the primary key` — `EXPLAIN QUERY PLAN` for the filtered
   statement contains NO `SCAN objects` (it must show a `SEARCH … USING … PRIMARY KEY`/index). This
   pin is the one that keeps the slice's promise; it must be able to FAIL (a `substr`/`LIKE`
   implementation turns it RED).
8. `PIN P8: the API doc's stated `prefix` behaviour matches the code` — plus PIN A1–A3 green.

Reuse the ONE fixture set (`tests/helpers/server.ts`); never a second one.

## Verification (yours)

1. `bash scripts/gate.sh` IN-TURN, FOREGROUND, raw log kept. `0` = VERIFIED, `2` = the suite did NOT
   run, `9` = lock busy → wait and retry. Report a FULL green run with its counts.
2. Your differential: **commit first**, then at least TWO arms — (a) the prefix comparison made
   EXCLUSIVE (`>=` → `>`) so the boundary entry is lost, or the filter ignored entirely → P1 (and/or
   P5) must go RED; (b) the filter re-implemented with `substr(name, 1, length(?)) = ?` → **P7 must go
   RED** while the result rows are still correct, which is exactly why P7 exists. Print each mutated
   file's sha256 before and after; hold the gate lock across BOTH arms; restore from `HEAD` in an
   `EXIT INT TERM` trap; identical arms = VOID; a red arm that does not name its pin = VOID.
3. `git -C /home/administrator/projects/ServerStore/worktrees/object-prefix pull --rebase origin main`,
   then `git push origin HEAD:main`.
4. If you cannot finish, COMMIT the coherent partial state on your branch and report BLOCKED — and if
   you can PROVE this brief's design wrong (including the prefix-must-be-a-valid-name rule, or the
   range formulation), report BLOCKED with the evidence rather than implementing around it. Do not
   rename or touch the live store's data.

## Docs to amend in the SAME commit

`docs/DECISION-LEDGER.md` **row 61**; `docs/SEAM-INDEX.md` (the listing seam: where the filter lives,
the prefix-closed validation rule, and the index-usable-range gotcha); `docs/TESTING.md` (P1–P8, both
arms with hashes, honest unknowns); `docs/BOARD.md` LANDED row; `docs/API.md`.
**Carry the `COPIES:` line** — `COPIES: n→1 — <the seam>` or `COPIES: 1 — checked (grepped: <what>)`.
The charset/regex and the prefix parser are the obvious duplication risk here; if you find the
filter's range logic restated in a second place, fold it and say so.

## Your report (short)

`LANDED` or `BLOCKED`, then: the resolved base sha; the code sha; gate counts; each arm with its
printed hashes and exactly which pin went red; the `COPIES:` line; every judgement call the brief left
open (say which and why); the docs amended; and anything this brief got wrong.
