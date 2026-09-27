# Brief — slice 3: the secret tripwire

Cut from `docs/BRIEF.md`. Self-contained. Ledger row assigned by the dispatcher: **23**.

---

You are a WRITER on **ServerStore** (Node 24 + TypeScript, pnpm, vitest, ONE gate). Read
`/home/administrator/projects/ServerStore/AGENTS.md` FIRST, then `docs/DECISION-LEDGER.md`
rows 2, 6, 7, 13, 20, 21 and `docs/SEAM-INDEX.md`.

## Where you work (READ THIS TWICE)

Worktree `/home/administrator/projects/ServerStore/worktrees/tripwire`, branch `feat/tripwire`,
base `origin/main` = **023e098**, already installed. EVERY read/edit/write/bash call MUST use an
ABSOLUTE path under that worktree (or pass a working directory) — relative paths resolve against
the MAIN repo. Never touch the main tree. You are the only writer in flight.

You are a subagent: your background jobs DIE when your turn ends. Run the gate IN-TURN, foreground.

## The owner's words and the intent

> *"If we use battle proved crypto for the key and wont push that, we should be fine even on a
> public repo, correct?"*

Ledger row 21 answers it: **public is fine** (Kerckhoffs — the code is not the secret), but
"we won't push the key" is an **intention**, and `.gitignore` is **not a mechanism**. This slice
builds the mechanism. It is the only thing standing between an accidental `git add -A` and a
public repo, so it must be able to go RED, and it must not cry wolf on our own fixtures.

## What to build

**The ONE seam:** a pure scanner, `tests/helpers/secrets.ts`, called by ONE test file,
`tests/secrets.test.ts`. Rejected: a new step inside `scripts/gate.sh` — the gate is the ONE way
the suite runs, and adding a second check path there multiplies the ways a check can be silently
skipped; a test runs in the suite and carries a NAME.

1. `scanTrackedTree(repoRoot)` lists the tracked tree with `git ls-files -z` (tracked = what would
   be PUBLISHED — an untracked secret is a different, smaller problem) and returns findings.
   Read files as bytes, skip anything containing a NUL in its first 8 KiB (binary), decode UTF-8.
2. Shapes to detect, each with a one-line comment saying why it is in the list:
   - GitHub tokens: `ghp_`, `gho_`, `ghu_`, `ghs_`, `ghr_` + 36+ `[A-Za-z0-9]`; `github_pat_` + 22+.
   - PEM private keys: `-----BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----`.
   - **The host credential's exact value**: read the token out of `~/.git-credentials`
     (`HOME`-relative) and fail if that string appears in ANY tracked file. **NEVER print, echo or
     log the token** — compare in memory only. If the file is absent, this arm must report
     **"cannot check"** explicitly; it must NOT pass silently (AGENTS.md rule 1).
   - **Do NOT scan for bare `ssk_`-shaped strings.** Our own tests mint key-shaped fixtures, so such
     a rule would either red on the suite or force an exclusion list covering the very files most
     likely to hide a real leak. Say this in a comment — it is the reason the obvious rule is wrong.
3. Also assert no **tracked** file has a `.db`, `.sqlite` or `.sqlite3` extension (the data root is
   outside the repo, ledger row 13; this catches the case where that ever stops being true), and add
   `*.db` / `*.sqlite` / `*.sqlite3` to the project's `.gitignore`.
4. Keep the scanner side-effect free and dependency-free (no new package).

## Pins (a pin's NAME is part of the deliverable)

1. `PIN S1: the tracked tree carries no GitHub token shape`
2. `PIN S2: the tracked tree carries no PEM private key`
3. `PIN S3: the host credential's value appears in no tracked file` (loudly "cannot check" when the
   credential file is absent — never a silent pass)
4. `PIN S4: the scanner DETECTS a planted fake token` — the tripwire's own falsifiability, on a
   fixture string (`ghp_` + 36 `A`s). This is what makes the tripwire real rather than decorative.
5. `PIN S5: a legal key-shaped fixture is NOT flagged` — the anti-cry-wolf pin. Use an existing
   `ssk_…` fixture if one is easy to reach, or a literal in the test.
6. `PIN S6: no tracked database or blob artifact`

Reuse the existing harness (`vitest`, `tests/**`); never build a second fixture set.

## Verification (yours)

1. `bash scripts/gate.sh`, IN-TURN, FOREGROUND, keep the RAW log. `0` = VERIFIED, `2` = the suite
   did NOT run (not a pass), `9` = lock busy → wait and retry. Report a FULL green run.
2. Your differential, and it is simple here because the tripwire is itself an arm: **commit first**,
   then append a fake `ghp_` + 36 `A`s to an existing tracked file, run the suite, and watch PIN S1
   go RED with the printed message; restore from `HEAD` in an `EXIT INT TERM` trap. Print the file's
   sha256 before and after; identical output = VOID. Use a token that is obviously fake.
3. `git -C <worktree> pull --rebase origin main`, then `git push origin HEAD:main`.
4. If you cannot finish, COMMIT the coherent partial state on your branch and report BLOCKED.

## Docs to amend in the SAME commit

`docs/DECISION-LEDGER.md` **row 23**; `docs/SEAM-INDEX.md` (one row: where a secret is checked);
`docs/TESTING.md` (the pins + your arm with its hashes); `docs/BOARD.md` LANDED row. Carry the
`COPIES:` line.

## Your report (short)

`LANDED` or `BLOCKED`, then: sha; gate counts + peak; each arm with its printed hash and what went
red; the `COPIES:` line; how it works; judgement calls; docs amended; and anything this brief got
wrong. Silence until then. If you can PROVE a rule here is wrong — including this brief's own design
— report BLOCKED with the evidence rather than implementing it.
