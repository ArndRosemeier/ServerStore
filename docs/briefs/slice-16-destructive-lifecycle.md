# Brief — slice 16 (H1): the destructive lifecycle — delete a key, empty a store, delete a store

Cut from `docs/BRIEF.md`. Self-contained. Ledger row assigned by the dispatcher: **71**.

---

You are a WRITER on **ServerStore** (Node 24 + TypeScript, pnpm, vitest, ONE gate). Read
`/home/administrator/projects/ServerStore/AGENTS.md` FIRST, then `docs/DECISION-LEDGER.md` rows 19, 21,
**46** (revoke's boundary), **52/53** (edit + the audit stamp), **61** (list/`prefix=`), **70** (this
slice's design — the authority for EVERY choice below), `docs/SEAM-INDEX.md` and `docs/API.md`.

## Where you work (READ THIS TWICE)

Worktree `/home/administrator/projects/ServerStore/worktrees/destructive`, branch
`feat/destructive`, already created and installed. EVERY read/edit/write/bash call MUST use an
ABSOLUTE path under that worktree. Never touch the main tree. You are the only writer in flight.

Your base is the tip of `origin/main` that carries THIS brief — **resolve it and record the resolved
sha in your landing row** (`git -C /home/administrator/projects/ServerStore/worktrees/destructive
rev-parse --short origin/main`). Do not trust a sha quoted from memory, including in this one.

You are a subagent: your background jobs DIE when your turn ends. Run the gate IN-TURN, foreground.

## Why this slice exists

The owner administers the store ENTIRELY through the console and asked for four things: delete a key
(revoked keys clutter the list), look inside a store and delete entries, empty a store, delete a store.
Two of those already have routes (`GET /stores/{store}/objects` and
`DELETE /stores/{store}/objects/{name}`) and are UI work — this slice is the OTHER THREE ROUTES plus
the byte reclamation they imply. **The console work is a separate slice and is NOT yours.**

## What to build

1. **`DELETE /keys/:id`** — hard delete.
   - The boundary is **revoke's, plus the row**: `Auth.requireAdmin("delete keys")`, then the SAME
     containment rules row 46 fixed — a master may delete any key; a store-scoped admin only a key
     whose scope lies inside its own set and which does NOT hold `admin`; **self-deletion is allowed**
     exactly as self-revocation is (the caller's own credential, the one deliberate exception).
   - A **REVOKED** key IS deletable — that is the owner's actual complaint.
   - **The LAST admin key cannot be deleted**: refuse `409` with a message naming why. "Last admin"
     means the last key that holds `admin`, is NOT revoked, and has not expired. `revoke` keeps its
     CURRENT behaviour (do not change it) — the inconsistency is recorded in row 70(b); say so in the
     docs rather than silently diverging.
   - The key row goes; `key_stores.key_id` is `ON DELETE CASCADE`, so its scope rows go with it. The
     credential stops authenticating on the NEXT request (no cache). Response: `200` with
     `{ id, deletedAt }` read from the clock the app already injects — or `204`; pick one and pin it.
2. **`DELETE /stores/:store/objects?confirm=<store>`** — empty a store.
   - Requires `delete` on that store (the same permission that already gates deleting one entry).
   - **Server-side confirm token**: `confirm` must equal the store name, else `400 bad_request` and
     NOTHING is deleted (pin X6 asserts the objects survive).
   - Removes EVERY object row of that store **and reclaims its bytes**: after all rows are gone, the
     store's blob tree under `<dataRoot>/stores/<store>/blobs` can be removed wholesale. Key scopes
     are untouched (a key scoped to an empty store is perfectly valid).
   - Idempotent: emptying an already-empty store is `200` with a count of 0, not an error.
3. **`DELETE /stores/:store?confirm=<store>`** — delete a store.
   - Requires a **MASTER admin** (symmetric with `POST /stores`).
   - Server-side confirm token, same rule as (2).
   - **REFUSES `409` while ANY key's scope names the store**, naming the blocking keys. Do NOT cascade
     or silently rewrite a key's scope: `key_stores.store REFERENCES stores(name)` with
     `PRAGMA foreign_keys = ON` makes the delete a foreign-key error anyway, and a silent cascade
     would mutate credentials (and could leave a key with an EMPTY scope, which the model forbids).
   - On success: the `stores` row, its object rows, and its whole directory under
     `<dataRoot>/stores/<store>` go. Response: `200` with `{ name, deletedAt }` — pick and pin.
4. **Byte reclamation for the EXISTING single-object delete** (`DELETE /stores/:store/objects/:name`),
   which today leaves the blob behind: remove the blob **only when no other row in that store still
   names the same `sha256`** (`SELECT 1 FROM objects WHERE store = ? AND sha256 = ? AND name <> ?`).
   Content-addressed storage means two entries can share one blob — a naive delete corrupts the
   survivor, which is why this was deferred (rows 19/28). `deleteBlob()` in `src/storage/fs.ts`
   exists and is currently UNUSED: this is where it starts being used.
5. **ONE seam per idea** — say what you folded. The obvious ones: the delete-key boundary must REUSE
   `Auth.holdsStores` and the revoke route's shape rather than copy it; the confirm-token check and
   the "last admin" query should each exist once; the blob-vs-row removal belongs in the storage layer
   (or the kind handler), NOT inline in a route; and the store-directory removal belongs beside the
   other path helpers in `src/storage/fs.ts`.
6. **`docs/API.md`** in the SAME commit: the three routes with their permissions, statuses and confirm
   rules; the 409s and what they mean; the byte-reclamation behaviour (and that the single-object
   delete now reclaims only unshared content); and the last-admin-key rule. **PIN A1–A3 stay green**
   (three new routes must appear in the route table — that is the doc pin's job).

## Pins (a pin's NAME is part of the deliverable; use the **X** prefix)

1. `PIN X1: DELETE /keys/:id removes the key and its scope, and the credential dies at once` — the
   deleted key answers `401` on the NEXT request; the key is gone from `GET /keys`; its `key_stores`
   rows are gone (assert in the database, not by counting).
2. `PIN X2: deleting a key is revoke's boundary` — a store-scoped admin cannot delete a key outside
   its scope, nor one holding `admin`; a master can; self-deletion is allowed; a NON-admin is `403`.
3. `PIN X3: the LAST admin key cannot be deleted` — with exactly one live admin key it is refused
   `409` and the key still works; with TWO admin keys either may be deleted, and after deleting one the
   remaining one still can. A REVOKED or EXPIRED admin key does not count as an admin for this rule.
4. `PIN X4: emptying a store removes every entry and reclaims the bytes` — objects gone from the
   listing, their blob FILES gone from disk, and the store itself and its keys' scopes untouched;
   emptying an empty store is `200` with 0.
5. `PIN X5: a store with a key scoped to it cannot be deleted` — `409` naming the blocking key, the
   store still lists, its objects still read; then delete that key and the store delete SUCCEEDS, and
   its directory is gone from disk.
6. `PIN X6: the confirm token is server-side` — a missing or mismatched `confirm` is `400 bad_request`
   and NOTHING is deleted (assert the objects/keys/stores are all still there); the correct token
   works.
7. `PIN X7: deleting one object reclaims only UNSHARED content` — two objects with IDENTICAL bytes
   share one blob: delete one, the other still READS correctly; delete the last, and the blob file is
   gone.
8. `PIN X8: authorization and the error surface are unchanged in kind` — emptying requires `delete`
   (a `read`-only key is `403`), deleting a store requires a master (a non-master admin is `403`), an
   unknown store/key is `404`, and no destructive route can be reached without a key (`401`).
9. `PIN X9: the docs match the code` — the three routes are in `docs/API.md`'s route table with their
   statuses and the confirm rule, and PIN A1–A3 stay green in the same gate.

**Name-safety matters more on these routes than anywhere else:** the store name arrives in the URL and
is used to build a directory path, so it MUST go through the existing parser before any path is built
(no new parser, no sanitising). A traversal attempt is refused by that rule — pin it as part of X8.

## Verification (yours)

1. `bash scripts/gate.sh` IN-TURN, FOREGROUND, raw log kept. `0` = VERIFIED, `2` = the suite did NOT
   run, `9` = lock busy → wait and retry. Report a FULL green run with its counts.
2. **Commit first**, then TWO arms aimed at DIFFERENT mechanisms, each watched RED against a NAMED
   pin: (a) the store-delete foreign-key refusal removed (delete the store row without checking key
   scopes) → X5 must go RED; (b) the shared-content check removed from the single-object delete (always
   delete the blob) → **X7 must go RED while the ordinary delete pin stays green**. Print each mutated
   file's sha256 before and after; hold the gate lock across BOTH arms; restore from `HEAD` in an
   `EXIT INT TERM` trap and assert each hash is back; `error TS` = VOID; an arm that reddens a pin it
   did not name is only acceptable if the pin is a DECLARED twin of the same mechanism — say which.
3. `git -C /home/administrator/projects/ServerStore/worktrees/destructive pull --rebase origin main`,
   then `git push origin HEAD:main`.
4. Tests use their OWN scratch data root and their OWN app instance — **never the live database and
   never `https://store.futuremagic.de`** (do not delete anything that is not yours, and do not
   restart the live unit). If you cannot finish, COMMIT the coherent partial state and report BLOCKED —
   and if you can PROVE a choice in row 70 wrong (the refusal rules, the confirm token, the reclamation
   semantics), report BLOCKED with the evidence rather than implementing around it.

## Docs to amend in the SAME commit

`docs/DECISION-LEDGER.md` **row 71**; `docs/SEAM-INDEX.md` (the destructive-lifecycle seam: the three
routes, the ONE confirm rule, the ONE "last admin" query, the reclamation rule and the sharing trap,
and the named inconsistency with `revoke`); `docs/TESTING.md` (X1–X9, both arms with hashes, honest
unknowns — e.g. no atomic rename-and-swap across the whole store, and what a crash mid-empty leaves);
`docs/BOARD.md` LANDED row; `docs/API.md`.
**Carry the `COPIES:` line** — `COPIES: n→1 — <the seam>` or `COPIES: 1 — checked (grepped: <what>)`.

## Your report (short)

`LANDED` or `BLOCKED`, then: the resolved base sha; the code sha; gate counts; each arm with its
printed hashes and exactly which pin went red (and which pins fell as declared twins); the `COPIES:`
line; every judgement call the brief left open; the docs amended; and anything this brief got wrong.
