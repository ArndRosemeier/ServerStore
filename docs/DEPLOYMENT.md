# Deployment — the ordered runbook

ServerStore runs as a **`systemctl --user` service bound to loopback**, behind the
existing cloudflared tunnel at **`store.futuremagic.de`**. There is no second way to
start it: the unit runs the repo's own entrypoint, `src/server/main.ts`, which is what
`pnpm run serve` runs too.

Why it is shaped this way (the decisions, not the steps):

- **`systemctl --user`, loopback, behind the tunnel** — ledger row 3; every service on
  this box is exposed this way (`apps-web.service`, `dsh-web.service` are the
  precedents).
- **The bind host is a CONSTANT, not configuration** — `src/server/config.ts` holds
  `DEFAULT_HOST = "127.0.0.1"` and `resolveConfig()` has no branch that could read a
  host from the environment. That is deliberate (GUARD g1), pinned by **PIN D6**, and
  the unit carries the comment that says so. Do not add `SERVERSTORE_HOST`, a
  `--host` flag, or `Environment=HOST=…`: turning the host into configuration is how a
  service ends up on `0.0.0.0`.
- **The data root is OUTSIDE the repo** — `~/serverstore-data`, i.e.
  `/home/administrator/serverstore-data` (ledger row 13). The repo stays clonable and
  disposable; the bytes are neither.
- **The unit runs from the repo checkout on `main`** —
  `WorkingDirectory=/home/administrator/projects/ServerStore`. Never point it at a
  worktree: `main` is what deploys, and a worktree can be retired at any time.
- **The master key is the OWNER's.** Nothing in this runbook takes, prints or stores
  it. The key-bearing round-trip is his acceptance step.

Pins this runbook is verified by: **D1–D4** (`tests/entrypoint.test.ts`, the real
entrypoint spawned over a real loopback socket), **D5–D6** (`tests/deploy.test.ts`, the
unit file). The one command for all of it is `bash scripts/gate.sh`.

---

## 0. Preconditions (check, do not assume)

```bash
node --version                 # v24.x — the unit pins /usr/bin/node
ls -l /usr/bin/node            # must exist: the unit names it absolutely
systemctl --user is-active apps-web.service   # the precedent: this box's pattern
ss -ltn 'sport = :8477'        # MUST be empty before you start
```

`ss -ltn 'sport = :8477'` must print nothing. If something already holds 8477, STOP:
the unit will crash-loop and `Restart=on-failure` will keep doing it every 3 seconds.

## 1. Install and start the unit

```bash
cp /home/administrator/projects/ServerStore/deploy/serverstore.service \
   /home/administrator/.config/systemd/user/serverstore.service
systemctl --user daemon-reload
systemctl --user enable --now serverstore
systemctl --user status serverstore --no-pager
```

`enable --now` starts it as well as arming it at login. The status must say `active
(running)`. If it says `activating (auto-restart)`, read `journalctl --user -u
serverstore -n 50` — the unit is crashing and restarting, and a clean status is the
only evidence that it is up.

## 2. Verify loopback — and only loopback

```bash
ss -ltn 'sport = :8477'
bash /home/administrator/projects/ServerStore/scripts/probe-live.sh http://127.0.0.1:8477
```

`ss` must show exactly `127.0.0.1:8477`. If it shows `0.0.0.0:8477` or `[::]:8477`,
STOP and roll back (step 7): the service is on every interface of this box and the
tunnel is no longer the only way in.

The probe must end `RESULT: PASS ... (exit 0)`. It checks the two things the ingress is
about to expose — `GET /healthz` is `200`, an unauthenticated `GET /stores` is `401` —
and it holds no key, so it is safe to run anywhere.

## 3. Add the ONE ingress line

`/etc/cloudflared/config.yml` (root-owned; passwordless sudo works on this box):

```yaml
ingress:
  - hostname: openclaw.futuremagic.de
    service: http://127.0.0.1:18789
  # … the existing hostnames, unchanged …
  - hostname: store.futuremagic.de          # <-- THE ONE NEW LINE (plus its service line)
    service: http://127.0.0.1:8477
  - service: http_status:404                # the catch-all MUST stay last
```

Two properties matter:

- **Insert before the catch-all.** cloudflared evaluates `ingress` top to bottom; a
  rule below `http_status:404` is dead configuration that looks correct.
- **Add nothing else.** One hostname is the decision (ledger row 7: one subdomain, one
  master key). A second hostname is a second perimeter nobody has been asked to accept.
- **The store is the SIXTH hostname rule in the live file**, not the fifth:
  `apps.futuremagic.de` was added ABOVE it (checked in `/etc/cloudflared/config.yml`,
  ledger row 64 — worth stating because "rule #5" was repeated in the board and here long
  after it had stopped being true). What matters is the ORDER relative to
  `http_status:404`, never the ordinal; the ordinal is only a way to point at the line.

## 4. Point DNS at the tunnel

```bash
cloudflared tunnel route dns f4dec46d-fd5e-4870-894b-a5c8635c2b82 store.futuremagic.de
dig +short store.futuremagic.de       # must now answer Cloudflare's anycast addresses
```

The tunnel id is the one already in `/etc/cloudflared/config.yml`. Until this step the
hostname does not resolve at all, and the ingress line above is untestable.

## 5. Restart the tunnel — ASK THE OWNER FIRST

> **`TRAP t1`.** This restart takes **`dsh.futuremagic.de` (the owner's own GUI),
> `opencode.futuremagic.de` and `openclaw.futuremagic.de` all down for a few seconds.**
> Passwordless sudo works, so this warning is the only guard. Do not run it on your own
> initiative; ask at the moment you are about to, and say what will drop.

```bash
sudo systemctl restart cloudflared
systemctl is-active cloudflared        # must be "active" again
```

Then verify the hostnames came back, including the owner's own:

```bash
bash /home/administrator/projects/ServerStore/scripts/probe-live.sh https://store.futuremagic.de
curl -s -o /dev/null -w '%{http_code}\n' https://dsh.futuremagic.de    # 200/302/401 = up
```

A `502` from the probe means the tunnel is up but the service is not — go back to step
1. A DNS failure means step 4 did not land.

## 6. The owner mints the master key

**His step, with his shell.** The key is printed exactly once and nothing can read it
back (SEAM-INDEX gotcha 2):

```bash
cd /home/administrator/projects/ServerStore && pnpm run admin:key
```

Then his acceptance round-trip against the LIVE hostname — the part this runbook
deliberately cannot do, because it holds no key:

```bash
KEY=ssk_…                                  # his key, his shell
curl -sS -H "Authorization: Bearer $KEY" https://store.futuremagic.de/stores
```

If a key ever leaks into a transcript, a shell history or a file, treat it as burned:
mint a replacement and revoke the old one. Nothing here does that for him.

## 7. Rollback

```bash
systemctl --user disable --now serverstore
rm /home/administrator/.config/systemd/user/serverstore.service
systemctl --user daemon-reload
```

then remove the two `store.futuremagic.de` lines from `/etc/cloudflared/config.yml` and
**restart the tunnel again** (step 5's warning applies, so ask again). Optionally delete
the DNS record Cloudflare created in step 4 — leaving it is harmless, but it points a
public name at a now-dead ingress.

```bash
sudo systemctl restart cloudflared
ss -ltn 'sport = :8477'        # must print nothing again
```

The data root is **NOT** part of the rollback: `~/serverstore-data` is user data and
survives every step above. Deleting it destroys every store and every key.

---

## Where things are

| What | Where |
| --- | --- |
| The unit (in the repo, versioned) | `deploy/serverstore.service` |
| The installed unit | `~/.config/systemd/user/serverstore.service` |
| The entrypoint it runs | `/home/administrator/projects/ServerStore/src/server/main.ts` |
| The working directory | `/home/administrator/projects/ServerStore` (the `main` checkout) |
| The data root | `/home/administrator/serverstore-data` (OUTSIDE the repo) |
| The database | `<data root>/serverstore.db` — stores, entries AND their bytes, keys, scopes |
| The database sidecars | `<data root>/serverstore.db-wal` and `<data root>/serverstore.db-shm` (WAL mode is always on; the newest commits live in the `-wal` until a checkpoint) |
| The probe | `scripts/probe-live.sh <base-url>` |
| The tunnel config | `/etc/cloudflared/config.yml` (root-owned) |
| The service logs | `journalctl --user -u serverstore -f` |
| The port | `8477` (`SERVERSTORE_PORT` in the unit) |

### Backup — copy all three files, or let SQLite make the copy

Since slice 17 the item bytes live IN the database (ledger rows 78/79), so the database **is** the
data. It runs in WAL mode, which means the newest committed writes are in `serverstore.db-wal` until
SQLite checkpoints them — **a plain copy of `serverstore.db` alone can silently lose them.**

```bash
# Either: stop the service and copy all three files together.
systemctl --user stop serverstore
cp -p /home/administrator/serverstore-data/serverstore.db     /path/to/backup/
cp -p /home/administrator/serverstore-data/serverstore.db-wal /path/to/backup/ 2>/dev/null || true
cp -p /home/administrator/serverstore-data/serverstore.db-shm /path/to/backup/ 2>/dev/null || true
systemctl --user start serverstore

# Or: a consistent single-file snapshot, with or without the service running.
sqlite3 /home/administrator/serverstore-data/serverstore.db \
  "VACUUM INTO '/path/to/serverstore-backup.db'"
```

The `VACUUM INTO` file is self-contained (the WAL is folded in) and is the right thing to move
off-box. **Take a backup before any boot that runs a migration** — see step 8.

### Environment variables (what the unit may set)

The unit sets `SERVERSTORE_DATA_ROOT` and `SERVERSTORE_PORT`. Everything else is
OPTIONAL and unset on this host, so the defaults below are what the live service runs —
all of them are parsed AND validated at boot by `src/server/config.ts`, and a malformed
value fails the start loudly rather than falling back (`journalctl --user -u serverstore`).

| Variable | Unset means | Notes |
| --- | --- | --- |
| `SERVERSTORE_MAX_BYTES` | `67108864` (64 MiB) | Request body cap, enforced on the stream. |
| `SERVERSTORE_CORS_ORIGINS` | `*` (every origin) | Comma-separated bare origins; safe here because the API carries no cookies. |
| `SERVERSTORE_RATE_LIMIT` | `600` | Requests per CLIENT identity per 60-second window. `0` disables rate limiting entirely (the operator kill-switch); a non-integer or negative value fails the boot. The window is not configurable. |
| `SERVERSTORE_HOST` | — | **Deliberately absent**: the bind host is a constant (`127.0.0.1`), never configuration (GUARD g1, PIN D6). |

The limiter is in-memory, so **restarting the service clears the counters**; that is the
one operational consequence of this variable and it is stated in `docs/API.md`.

## Exit codes are the vocabulary

`scripts/probe-live.sh` — quote them exactly, never inflate them:

| Code | Means |
| ---: | --- |
| `0` | PASS — every check answered exactly what the pin requires |
| `1` | FAIL — at least one check did not; the failing line names it |
| `2` | UNKNOWN — the probe could not run (bad usage, no curl): **not** a pass |

`bash scripts/gate.sh` — the ONE way the suite runs: `0` GREEN · `1` RED · `2` cheap
tier only (not a pass) · `9` refused, VOID.

---

## 8. After any landing that touches `src/` — RESTART, then re-probe

**The running service is NOT the repo.** `ExecStart` loads `src/server/main.ts` once, at
boot. Commits on disk change nothing until the unit is restarted, so "the gate is green"
and "the live service behaves that way" are two different facts.

This matters most when a landing changes the **database schema** (as slice B1 does): the
migration runs when a process **opens** the database — the service at boot, or
`pnpm run admin:key` in the owner's shell. Minting a key between the landing and the
restart would migrate the live database while the running process still held the old code,
and the live API would fail until restarted.

**Slice 17 raised the stakes, and this is the one landing where the backup is not optional.**
Opening the database now also runs the **boot import** (`src/storage/migrate.ts`): it reads every
pre-slice-17 blob file, **re-verifies its hash against the row**, writes the bytes into the row, and
only then removes the `stores/` tree. A missing, wrong-sized or mismatched file makes the boot FAIL
loudly — the process does not serve, and no file is deleted — but the import is a one-way move of the
only copy of the bytes, so:

1. take the **three-file backup (or `VACUUM INTO`)** from the Backup section FIRST;
2. restart the unit and watch `journalctl --user -u serverstore -n 50` for the boot; a failure exits
   non-zero and leaves the old layout intact, which is the signal to restore the backup;
3. only after the service is `active` and the probe passes, delete the backup — and remember the old
   `stores/` directory is gone by then, so a rollback of the CODE alone cannot bring it back; the
   backup is the rollback.

```bash
systemctl --user restart serverstore
systemctl --user is-active serverstore          # must be "active"
ss -ltn 'sport = :8477'                          # must show 127.0.0.1:8477 ONLY
bash /home/administrator/projects/ServerStore/scripts/probe-live.sh https://store.futuremagic.de
```

**The rule.** After any landing that touches `src/` or the schema:

1. the **dispatcher** restarts the unit (it owns the landing),
2. re-runs the live probe, and only then
3. tells the owner he may mint or test against it.

A restart is also the rollback for a bad landing: check out the previous commit
(`git -C /home/administrator/projects/ServerStore checkout <sha>`), restart, re-probe, and
record it. The data root is never part of that: `~/serverstore-data` survives every step.
