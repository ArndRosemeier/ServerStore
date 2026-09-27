# Brief — slice 4: the deployment

Cut from `docs/BRIEF.md`. Self-contained. Ledger row assigned by the dispatcher: **27**.

---

You are a WRITER on **ServerStore** (Node 24 + TypeScript, pnpm, vitest, ONE gate). Read
`/home/administrator/projects/ServerStore/AGENTS.md` FIRST, then `docs/DECISION-LEDGER.md`
rows 3, 7, 13 and `docs/SEAM-INDEX.md` (gotchas 1 and 3 especially).

## Where you work (READ THIS TWICE)

Worktree `/home/administrator/projects/ServerStore/worktrees/deploy`, branch `feat/deploy`, base
`origin/main` = **fd87cbd**, already installed. EVERY read/edit/write/bash call MUST use an
ABSOLUTE path under that worktree (or pass a working directory) — relative paths resolve against
the MAIN repo. Never touch the main tree. You are the only writer in flight.

You are a subagent: your background jobs DIE when your turn ends. Run the gate IN-TURN, foreground.

## The owner's words and the intent

He picked **"Deploy it"**: *"systemd --user unit + the store.futuremagic.de ingress + a real
end-to-end probe through the tunnel — this is what makes it 'accessible from anywhere'."* The
service exists and is verified (`178` tests across 7 files, `pnpm run serve` boots); **nothing has
ever run as a service, and no test has ever bound a port.** `docs/TESTING.md` records that gap as
owed to THIS slice: *"No test binds a port or exercises `main.ts` … The automated version needs a
spawned server, and that is owed to the deployment slice."*

**The ONE seam:** the service's PROCESS contract — the real entrypoint (`src/server/main.ts`) as a
systemd user unit, plus a probe that can be pointed at a live URL. Not a new server, not a second
way to start one.

## What to build

1. **`tests/entrypoint.test.ts` — the real entrypoint, spawned.** Start
   `node --experimental-strip-types src/server/main.ts` as a child with
   `SERVERSTORE_PORT=<a free ephemeral port>` and `SERVERSTORE_DATA_ROOT=<a temp dir>`; poll
   `http://127.0.0.1:<port>/healthz` until 200 with a BOUNDED wait (≤5s, then fail loudly — no
   unbounded loop, and no `sleep`-and-hope), assert the body, assert an unauthenticated
   `GET /stores` is **401**, then SIGTERM and assert the child exits and is gone.
   **Also assert the bind is loopback-only:** read the listening socket for that port from
   `/proc/net/tcp` (dependency-free) or `ss -ltn`, and require `127.0.0.1:<port>` — never
   `0.0.0.0` / `[::]`. If the tool you choose is missing, FAIL LOUDLY with a clear message
   (AGENTS.md rule 1): a silent skip is forbidden.
   Every process it starts must be killed in a `trap` (see the standing rule "Reap what you
   start": a kill that can be skipped by an error path is not cleanup — and a backgrounded child
   that outlives the test is exactly the orphan that rule exists for).
2. **`deploy/serverstore.service` — a systemd USER unit.** Absolute paths throughout:
   `WorkingDirectory=/home/administrator/projects/ServerStore`,
   `Environment=SERVERSTORE_DATA_ROOT=/home/administrator/serverstore-data`,
   `Environment=SERVERSTORE_PORT=8477`,
   `ExecStart=/usr/bin/node --experimental-strip-types /home/administrator/projects/ServerStore/src/server/main.ts`,
   `Restart=on-failure`, `RestartSec=3`, `WantedBy=default.target`. It must **NOT** set a bind host
   — `src/server/config.ts` holds `DEFAULT_HOST = "127.0.0.1"` as a constant, and the unit carries
   a comment saying that is deliberate (GUARD g1: turning the host into configuration is how a
   service ends up on `0.0.0.0`). **Do NOT install, enable or start it** — a host change is the
   dispatcher's, and the tunnel restart needs the owner's go-ahead at that moment.
3. **`scripts/probe-live.sh <base-url>`** — the probe the dispatcher will run against the live
   hostname. It checks: `GET /healthz` → **200**; unauthenticated `GET /stores` → **401**. One
   line per check, the exit-code vocabulary in its header, non-zero exit if any check fails, and
   it must **never take, print or log a key** — the key-bearing round-trip is the OWNER's
   acceptance step, because the dispatcher must not hold his master key.
4. **`docs/DEPLOYMENT.md`** — the ordered runbook: install the unit (`systemctl --user
   daemon-reload && systemctl --user enable --now serverstore`), verify loopback
   (`ss -ltn`), the ONE ingress line for `store.futuremagic.de` in `/etc/cloudflared/config.yml`,
   `cloudflared tunnel route dns`, **the restart warning** (a few seconds in which
   `dsh.futuremagic.de`, `opencode.futuremagic.de` and `openclaw.futuremagic.de` all drop — ask
   first), the owner minting the master key with `pnpm run admin:key`, the probe command, and the
   rollback (`systemctl --user disable --now serverstore` + remove the ingress line + restart).
   State the data root (`~/serverstore-data`, OUTSIDE the repo — ledger row 13) and that the unit
   runs from the repo checkout on `main`.
5. `.gitignore`: add `/deploy-logs/` or nothing — your call, but say which and why.

## Pins (a pin's NAME is part of the deliverable)

1. `PIN D1: the real entrypoint boots and serves /healthz from the repo's own start command`
2. `PIN D2: the entrypoint listens on 127.0.0.1 and NOT on 0.0.0.0`
3. `PIN D3: an unauthenticated API call is refused 401 by the running service`
4. `PIN D4: SIGTERM stops the service and leaves no child behind`
5. `PIN D5: the unit file passes systemd-analyze verify`
6. `PIN D6: the unit file does not make the bind host configurable`

## Verification (yours)

1. `bash scripts/gate.sh` IN-TURN, FOREGROUND, raw log kept. `0` = VERIFIED, `2` = the suite did
   NOT run (not a pass), `9` = lock busy → wait and retry. Report a FULL green run.
2. Your own differential: **commit first**, then break ONE thing and watch a NAMED pin go RED —
   e.g. change `DEFAULT_HOST` to `"0.0.0.0"` and watch PIN D2 red, or remove the SIGTERM handler
   and watch PIN D4. Print the file's sha256 before and after, hold the lock across the arm, and
   restore from `HEAD` in an `EXIT INT TERM` trap. Identical arms = VOID.
3. `git -C <worktree> pull --rebase origin main`, then `git push origin HEAD:main`.
4. If you cannot finish, COMMIT the coherent partial state on your branch and report BLOCKED.

## Docs to amend in the SAME commit

`docs/DECISION-LEDGER.md` **row 27**; `docs/SEAM-INDEX.md` (the process seam: the unit + the
probe + the spawned-entrypoint test); `docs/TESTING.md` (D1–D6, your arm with its hashes, and
retire the "no test binds a port" unknown if D1–D4 close it); `docs/BOARD.md` LANDED row. Carry
the `COPIES:` line.

## Your report (short)

`LANDED` or `BLOCKED`, then: sha; gate counts + peak; each arm with its printed hash and what went
red; the `COPIES:` line; how it works; judgement calls; docs amended; and anything this brief got
wrong. Silence until then. If you can PROVE a rule here is wrong — including this brief's own
design — report BLOCKED with the evidence rather than implementing it.
