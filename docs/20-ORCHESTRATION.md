# 20 — Board (one screen, overwritten in place)

**The contract.** This file is the chief of staff's memory that outlives its own
session. Every record names something **checkable** — sha, branch, worktree, session
id, path. It is **updated in the same commit as the thing it records**, and it must be
**true before the dispatcher reports to the owner**. A record that no longer describes
the present belongs in `docs/17` or nowhere.

**Vocabulary.** `reconciled:` · `SESSION` · `PROBE` · `IN-FLIGHT` · `LANDED` ·
`QUEUE` · `QUEUE-CLOSED` · `TRAP` · `GUARD` · `RECOVERY`.

```
reconciled: <set by the commit immediately after this one> · 2026-09-27T17:45Z

SESSION | id=session-dcd6176e-b4b9-4759-b64d-4c90d3495dfa | role=dispatcher (chief of staff)
  | state=live, talking to the owner; NO writer dispatched | goal=goal-1f2f2e27-ed8d-470d-8499-c1eeed63b3b6 (paused)
  | host=12 cores · 23Gi RAM (15Gi free) · load 0.64 · / has 506GB free

(no IN-FLIGHT writers — nothing has been dispatched; the repo holds docs only)

QUEUE | row=7 | exposure method is OPEN — owner asked for the implications before choosing
  | note=blocking any ingress work; the dispatcher owes a plain-language tradeoff
QUEUE | row=8 | principals are OPEN — apps holding keys vs end users needing identity inside a store
QUEUE | row=none | FIRST SLICE = the process itself (there is no AGENTS.md, no gate, no reconciler in
  | this repo yet). Per Campaigner docs/22 §13 the process lands before feature code.
QUEUE | row=none | the first real store KIND (generic bytes vs the specific app's shared data)
QUEUE | row=none | data root location (dispatcher recommends OUTSIDE the repo so git can never eat it)
QUEUE | row=none | whether this repo gets a GitHub remote (push credentials exist host-wide: ~/.git-credentials)

TRAP | t1 | Adding a hostname to /etc/cloudflared/config.yml REQUIRES RESTARTING the tunnel — a few
  | seconds in which dsh.futuremagic.de (the owner's own GUI), opencode.futuremagic.de and
  | openclaw.futuremagic.de all drop. Never do it silently: ask at the moment. Passwordless sudo works,
  | so the only guard is this line.
TRAP | t2 | Two FOREIGN processes were mid-run during reconcile in
  | BlasterMaster/worktrees/dup-tripwire (`npm run gate`, `npm run build`). They are another project's;
  | the one-suite lock is host-shared — check before starting any expensive check.

GUARD | g1 | Never bind the store to 0.0.0.0. Every service on this box is loopback-bound with the tunnel
  | in front (apps-web.service is the precedent).
GUARD | g2 | A long check NEVER runs in the foreground in the dispatcher session (owner-ratified,
  | ~/.dsh/AGENTS.md). A WRITER runs its own gate IN-TURN — a subagent's background jobs die with its turn.

RECOVERY | a successor starts here, then: `git log --oneline`, `git worktree list`, `systemctl --user
  | list-units`, and `~/.dsh/sessions/--home-administrator-projects-ServerStore--` for the live registry.
  | The owner's decisions are rows 1-9 of docs/17; rows 7-8 are the two he has not yet made.
```

**Known debt.** There is no `scripts/board.sh` reconciler yet, so nothing above has
been checked by machine — the numbers in it were read by hand at 2026-09-27T17:45Z.
Building the reconciler is part of the first slice.
