# Brief — slice 11 (C2): named, editable keys with an audit stamp

Cut from `docs/BRIEF.md`. Self-contained. Ledger row assigned by the dispatcher: **53**.

---

You are a WRITER on **ServerStore** (Node 24 + TypeScript, pnpm, vitest, ONE gate). Read
`/home/administrator/projects/ServerStore/AGENTS.md` FIRST, then `docs/DECISION-LEDGER.md` rows 2, 6,
30, 39, 41, **46**, **50**, **51**, **52**, `docs/SEAM-INDEX.md`, and `docs/API.md`.

## Where you work (READ THIS TWICE)

Worktree `/home/administrator/projects/ServerStore/worktrees/key-edit`, branch `feat/key-edit`, base
`origin/main` = **a556854**, already installed. EVERY read/edit/write/bash call MUST use an ABSOLUTE
path under that worktree. Never touch the main tree. You are the only writer in flight.

You are a subagent: your background jobs DIE when your turn ends. Run the gate IN-TURN, foreground.

## The intent

Owner, verbatim: *"I want to be able to edit key permissions after the fact and i want to name the
keys (no need to show them again), so i can for example have something like \"key for tom\" and then
grant new things or remove them. I also want to be able to view current permissions."* Rows 51 and 52
fixed the design; this slice builds it. **Viewing needs no new API** — `GET /keys` already returns
label, stores and perms, and the console already lists them.

**The ONE seam: what a key HOLDS (its grant).** Editing is a SECOND WAY TO GRANT PERMISSIONS, so it
must go through the SAME boundary as minting — the ONE containment predicate (`Auth.holdsStores`) plus
`requireAdmin` — and never a second authorization path.

## What to build

1. **Schema:** add `updated_at TEXT NULL` and `updated_by TEXT NULL` to `access_keys`, by an
   idempotent add-if-absent migration of the kind B1 established. A never-edited key keeps **NULL**
   (the UI says "never changed" — never invent a timestamp from `created_at`). `updated_by` is the
   editing key's **id**; it is resolvable in the key list, and it must never be a secret.
2. **`PATCH /keys/:id`** accepts any subset of `{label, stores, perms}`:
   - **Validation identical to mint** (`parseStores`, `parsePermissions`, the label rule). Omitted
     fields are UNCHANGED. A body with **no recognised field**, or any unknown field, is refused
     (`400`) and **nothing changes**.
   - **Authorization:** only a key holding `admin` may edit; a store-scoped admin may edit only keys
     whose scope lies inside its own set, may never grant `admin`, and may not widen a key into a
     store it does not hold; a master may narrow or widen anything, and only a master may grant
     `admin` with `["*"]` (row 39's rule, reached through this new door).
   - **A REVOKED key cannot be edited** — `403 forbidden` with a message saying so (use the existing
     vocabulary; if you believe a new code is warranted, say why and keep PIN A2 green by documenting
     it). Editing a revoked key back to life would make revocation meaningless (row 45).
   - **The key's VALUE is unchanged**: `id`, `prefix`, `key_hash`, `created_at` and the raw key itself
     survive an edit, so "edit in place" is PROVED rather than assumed (row 51's whole point).
   - On success, stamp `updated_at` and `updated_by` and return the updated record.
3. **`GET /keys`** returns `updatedAt` and `updatedBy` alongside the existing fields.
4. **The UI** (`web/index.html`, `web/app.js`, `web/app.css`): an **Edit** affordance on each key row —
   rename, store checkboxes, permission toggles — with Save and Cancel; **disabled for a revoked key**;
   a visible warning when the row being edited is the key currently in use (a caller may demote or
   revoke itself, which takes effect immediately); and the list showing **"changed <when> by
   <label>"**, resolving `updatedBy` from the loaded keys. Errors from the API render in the page.
   `read`/`write` are the defaults a new key gets; `admin` only for a `["*"]` scope.
5. **`docs/API.md`** gains the `PATCH` row, the audit fields and the error cases. **PIN A1–A3 stay
   green** (a new route: the doc must list it and the pin must see it both ways).

## Pins (a pin's NAME is part of the deliverable)

1. `PIN E1: an edit changes exactly the fields given, and nothing else` — rename only leaves stores and
   perms untouched; a perms-only edit leaves the label and stores untouched.
2. `PIN E2: an editor may grant only what it could have minted` — a store-scoped admin cannot grant
   `admin`, cannot edit a key outside its own set, and cannot widen a key into a store it does not
   hold (403, and the key is unchanged afterwards).
3. `PIN E3: a REVOKED key cannot be edited back to life` — 403, `revoked_at` unchanged.
4. `PIN E4: an edit is stamped and visible` — `updatedAt` moves, `updatedBy` is the caller's key id,
   and both appear in `GET /keys`.
5. `PIN E5: a non-admin key cannot edit anything` — 403.
6. `PIN E6: an edit does NOT change the key's value` — the same raw key authenticates afterwards, and
   `id`/`prefix`/`key_hash`/`created_at` are byte-identical.
7. `PIN E7: a body with no recognised field is refused and nothing changes` — and an unknown field does
   not silently pass.

Reuse the ONE fixture set (`tests/keys.test.ts`); never a second one.

## Verification (yours)

1. `bash scripts/gate.sh` IN-TURN, FOREGROUND, raw log kept. `0` = VERIFIED, `2` = the suite did NOT
   run, `9` = lock busy → wait and retry. Report a FULL green run.
2. Your differential: **commit first**, then TWO arms — (a) make `PATCH` re-mint the key (so its value
   or hash changes) → **E6 must go RED**; (b) allow a revoked key to be edited → **E3 must go RED**.
   Print the file's sha256 before and after each arm; hold the lock across both; restore from `HEAD`
   in an `EXIT INT TERM` trap (include `web/` in the restore path — it exists now); identical arms =
   VOID.
3. `git -C <worktree> pull --rebase origin main`, then `git push origin HEAD:main`.
4. If you cannot finish, COMMIT the coherent partial state on your branch and report BLOCKED.

## Docs to amend in the SAME commit

`docs/DECISION-LEDGER.md` **row 53**; `docs/SEAM-INDEX.md` (the edit seam: the route, the reused
predicate, and the two audit columns); `docs/TESTING.md` (E1–E7, both arms with hashes, and the honest
unknown that the UI's edit flow is not exercised in a browser); `docs/BOARD.md` LANDED row;
`docs/API.md`. Carry the `COPIES:` line.

## Your report (short)

`LANDED` or `BLOCKED`, then: sha; gate counts + peak; each arm with its printed hash and what went
red; the `COPIES:` line; judgement calls; docs amended; and anything this brief got wrong.
