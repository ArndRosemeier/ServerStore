#!/usr/bin/env bash
#
# The writer's OWN differential for SLICE 17 (I1) — the SQLite core. Ledger row 79.
#
# TWO arms, each aimed at a DIFFERENT mechanism, because the two claims this slice rests
# on are independent: that a reader is never blocked (a JOURNAL-MODE property) and that a
# concurrent mutation QUEUES rather than failing (a BUSY-TIMEOUT property).
#
#   ARM A  the journal mode is put back to `DELETE` (the rollback journal this project
#          used until slice 17), so a writer holding the lock BLOCKS readers.
#                       -> PIN Y5 must go RED   (the reader waits for the writer)
#                       -> PIN Y7 must go RED as a DECLARED TWIN: Y7 asserts
#                          `journal_mode = WAL` on the real connection, so the same
#                          mechanism reddens the config pin too. Named, not hidden.
#          file: src/core/db.ts — the ONE open path
#   ARM B  the busy timeout is SET and then DISABLED (`PRAGMA busy_timeout = 0` injected
#          after the real statement), so the configuration is still *said* but no longer
#          *in force*: a concurrent mutation fails with `database is locked` instead of
#          waiting.
#                       -> PIN Y7 must go RED   (the timeout on the real connection is 0,
#                          not BUSY_TIMEOUT_MS)
#                       -> PIN Y4 must go RED as a DECLARED TWIN: with no timeout the
#                          second PROCESS's writes fail, which is exactly Y4's claim.
#          file: src/core/db.ts — the same open path
#
# BOTH arms run the FULL suite and assert the pins that must SURVIVE, because an arm that
# reddens everything proves only that it broke the tree: arm A leaves Y4 and Y6 green (the
# other two multi-process pins, which are about QUEUEING and ATOMICITY, not readers), and
# arm B leaves Y5 green (WAL still lets a reader through) and Y6 green (a SIGKILL is not a
# contention event).
#
# The slice is COMMITTED before this runs (that is what makes `HEAD` the pristine copy):
# the code commit is 620a71b. Every arm prints its file's sha256 before and after (an
# unchanged hash would be VOID), runs BOTH tiers directly while HOLDING THE SAME LOCK
# `scripts/gate.sh` takes (calling the gate here would make it refuse itself with exit 9 —
# VOID, not evidence), and the restore is `git checkout HEAD --` in an `EXIT INT TERM`
# trap over the file both arms touch. Per-arm logs go under .diff-harness/, so the green
# gate log is not clobbered.
#
# The harness runs IN THE WORKTREE (cd to its own directory's parent), so the tree it
# mutates and restores is this slice's, never the main checkout.
#
# NEVER PRINT A REAL KEY: every line that reaches the transcript is scrubbed of
# `ssk_…`-shaped strings (ledger row 21).

set -u
cd "$(dirname "$0")/.." || exit 1
WORKTREE="$(pwd)"

GIT_COMMON="$(git rev-parse --path-format=absolute --git-common-dir)"
REPO_ROOT="$(cd "$GIT_COMMON/.." && pwd)"
LOCK_DIR="$REPO_ROOT/.gate-lock"
OUT="$WORKTREE/checkpoints/sqlite-core-differential.out"
LOGS="$WORKTREE/.diff-harness"
mkdir -p "$LOGS"
: > "$OUT"

DB="src/core/db.ts"

PIN_Y1="PIN Y1: an entry's bytes live in the database and the blob files are gone"
PIN_Y2="PIN Y2: every entry is imported with its original sha256, and the blob tree is gone"
PIN_Y3="PIN Y3: every key row, scope and timestamp is untouched, and a key still authenticates"
PIN_Y4="PIN Y4: two PROCESSES writing at once both complete, every committed row is present, and integrity_check is ok"
PIN_Y5="PIN Y5: a reader in a second process is never BLOCKED while a writer is working"
PIN_Y6="PIN Y6: a SIGKILL mid-transaction leaves an openable, uncorrupted database with the uncommitted rows ABSENT"
PIN_Y7="PIN Y7: the configuration is what the claim rests on"
PIN_Y8="PIN Y8: no item SQL and no blob/path knowledge exists outside src/storage/"

LOCKED=0
restore() {
  # The ONE file both arms touch, always, idempotently: an error path must not be able
  # to skip cleanup (the row-27 lesson).
  git checkout HEAD -- "$DB" >/dev/null 2>&1 || true
  if [ "$LOCKED" = "1" ]; then rm -rf "$LOCK_DIR"; fi
  echo "RESTORED: $DB back at HEAD; lock released" | tee -a "$OUT"
}
trap restore EXIT INT TERM

redact() { sed -E 's/ssk_[A-Za-z0-9_-]+/ssk_<redacted>/g'; }
say() { echo "$@" | redact | tee -a "$OUT"; }
fail() { say "HARNESS FAILURE: $*"; exit 1; }
hash_of() { sha256sum "$1" | awk '{print $1}'; }

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  OWNER_PID="$(sed -n 's/^pid=//p' "$LOCK_DIR/owner" 2>/dev/null)"
  fail "the gate lock is already held (pid ${OWNER_PID:-unknown}) — this run would be VOID, refused, not evidence"
fi
LOCKED=1
printf 'pid=%s\nstarted=%s\ntier=full\nrepo=%s\nharness=sqlite-core-differential\n' \
  "$$" "$(date -u +%FT%TZ)" "$REPO_ROOT" > "$LOCK_DIR/owner"
say "lock: acquired $LOCK_DIR (held across every arm; gate.sh would refuse itself here)"

run_tiers() {
  local label="$1" logdir="$2" cheap_exit full_exit
  mkdir -p "$logdir"
  ( cd "$WORKTREE" && bash -c 'pnpm run typecheck' ) >"$logdir/cheap.log" 2>&1
  cheap_exit=$?
  ( cd "$WORKTREE" && bash -c 'pnpm test' ) >"$logdir/full.log" 2>&1
  full_exit=$?
  say "  $label: cheap exit=$cheap_exit full exit=$full_exit (logs: $logdir)"
  return 0
}

# Did `pin` FAIL in this arm's log? BOTH forms a failing pin can take (`× <name>` in the
# suite tree, `FAIL … > <name>` in the failure block), matched with `grep -F` so a pin
# name is never read as a regex.
pin_red() {
  local log="$1/full.log" pin="$2"
  grep -F "× $pin" "$log" >/dev/null && return 0
  grep -F "FAIL " "$log" | grep -F "$pin" >/dev/null && return 0
  return 1
}

assert_red() {
  local label="$1" logdir="$2" pin="$3"
  [ -f "$logdir/full.log" ] || fail "$label: the suite never ran — read $logdir/cheap.log"
  if grep -qE 'error TS' "$logdir/cheap.log"; then
    fail "$label: the injection ALSO broke the typecheck — the arm is not attributable: $(grep -m1 -E 'error TS' "$logdir/cheap.log")"
  fi
  grep -A8 -F "$pin" "$logdir/full.log" | head -16 | redact | tee -a "$OUT" || true
  pin_red "$logdir" "$pin" || fail "$label went red but NOT on its named pin"
}

assert_not_red() {
  local label="$1" logdir="$2" pin="$3"
  if pin_red "$logdir" "$pin"; then
    fail "$label ALSO reddened '$pin' — the injection is broader than the rule it proves"
  fi
}

# --- control FIRST: the committed tree must be GREEN -------------------------
say "=== CONTROL — the committed tree ($(git rev-parse --short HEAD)) ==="
run_tiers CONTROL "$LOGS/control" || true
if ! grep -qE 'Test Files +[0-9]+ passed' "$LOGS/control/full.log"; then
  fail "the CONTROL run did not pass — read $LOGS/control/full.log; the harness cannot attribute anything"
fi
say "  control GREEN: $(grep -E 'Test Files|Tests ' "$LOGS/control/full.log" | tr '\n' ' ')"
BEFORE_DB="$(hash_of "$DB")"
say "  sha256: $BEFORE_DB  ($DB, the pristine hash)"

# --- ARM A: the journal mode goes back to DELETE (PIN Y5, Y7 twin) -----------
python3 - "$DB" <<'PY'
import sys

path = sys.argv[1]
src = open(path).read()
anchor = 'db.exec("PRAGMA journal_mode = WAL");'
assert src.count(anchor) == 1, "ARM A: the journal-mode anchor is not unique"
open(path, "w").write(src.replace(anchor, 'db.exec("PRAGMA journal_mode = DELETE");', 1))
PY
[ $? -eq 0 ] || fail "ARM A: the injection did not apply"
grep -q 'PRAGMA journal_mode = DELETE' "$DB" || fail "ARM A: the injection is not in $DB"
AFTER_A="$(hash_of "$DB")"
say "=== ARM A — journal_mode = DELETE (the rollback journal slice 17 replaced) ==="
say "  file:   $DB"
say "  sha256: $BEFORE_DB  (before)"
say "  sha256: $AFTER_A  (after injection)"
[ "$BEFORE_DB" != "$AFTER_A" ] || fail "arm A hash unchanged — VOID probe"
run_tiers "ARM A" "$LOGS/arm-a" || true
assert_red "arm A" "$LOGS/arm-a" "$PIN_Y5"
# DECLARED TWIN: Y7 asserts `journal_mode = WAL` on the real connection, so the journal
# mode reddens both pins. It is named here rather than asserted away.
assert_red "arm A" "$LOGS/arm-a" "$PIN_Y7"
# The other two multi-process pins are about QUEUEING and ATOMICITY, not readers: in
# rollback-journal mode two writers still serialise under busy_timeout, and a SIGKILL is
# still recovered from the journal.
assert_not_red "arm A" "$LOGS/arm-a" "$PIN_Y4"
assert_not_red "arm A" "$LOGS/arm-a" "$PIN_Y6"
assert_not_red "arm A" "$LOGS/arm-a" "$PIN_Y1"
restore
[ "$(hash_of "$DB")" = "$BEFORE_DB" ] || fail "arm A restore failed — the file hash did not come back"

# --- ARM B: the busy timeout is set and then DISABLED (PIN Y7, Y4 twin) ------
python3 - "$DB" <<'PY'
import sys

path = sys.argv[1]
src = open(path).read()
anchor = 'db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);'
assert src.count(anchor) == 1, "ARM B: the busy-timeout anchor is not unique"
injected = anchor + '\n  db.exec("PRAGMA busy_timeout = 0"); // ARM B: SET, then DISABLED'
open(path, "w").write(src.replace(anchor, injected, 1))
PY
[ $? -eq 0 ] || fail "ARM B: the injection did not apply"
grep -q 'ARM B: SET, then DISABLED' "$DB" || fail "ARM B: the injection is not in $DB"
AFTER_B="$(hash_of "$DB")"
say "=== ARM B — the busy timeout is SET and then DISABLED (timeout 0 in force) ==="
say "  file:   $DB"
say "  sha256: $BEFORE_DB  (before)"
say "  sha256: $AFTER_B  (after injection)"
[ "$BEFORE_DB" != "$AFTER_B" ] || fail "arm B hash unchanged — VOID probe"
[ "$AFTER_A" != "$AFTER_B" ] || fail "the two db.ts arms produced the SAME hash — VOID probe"
run_tiers "ARM B" "$LOGS/arm-b" || true
assert_red "arm B" "$LOGS/arm-b" "$PIN_Y7"
# DECLARED TWIN: with no timeout in force the second PROCESS's write fails, which is Y4's
# own claim — the behavioural half of the arm, since Y7's config assertions fire first.
assert_red "arm B" "$LOGS/arm-b" "$PIN_Y4"
# WAL still lets a reader through, and a SIGKILL is not a contention event.
assert_not_red "arm B" "$LOGS/arm-b" "$PIN_Y5"
assert_not_red "arm B" "$LOGS/arm-b" "$PIN_Y6"
assert_not_red "arm B" "$LOGS/arm-b" "$PIN_Y3"
restore
[ "$(hash_of "$DB")" = "$BEFORE_DB" ] || fail "arm B restore failed — the file hash did not come back"

# --- control AFTER: the restored tree must be GREEN again --------------------
say
say "=== CONTROL — the restored tree ==="
run_tiers "CONTROL 2" "$LOGS/control2" || true
grep -qE 'Test Files +[0-9]+ passed' "$LOGS/control2/full.log" \
  || fail "post-restore suite is not green — read $LOGS/control2/full.log"
say "  control GREEN: $(grep -E 'Test Files|Tests ' "$LOGS/control2/full.log" | tr '\n' ' ')"
say "  sha256: $(hash_of "$DB")  (db.ts, back to its before hash: $BEFORE_DB)"

say
say "DIFFERENTIAL COMPLETE: arm A RED on PIN Y5 (a rollback-journal reader BLOCKS on a writer's lock), with PIN Y7 falling as the DECLARED TWIN of the same journal-mode mechanism, and Y1/Y4/Y6 GREEN. Arm B RED on PIN Y7 (the timeout on the real connection is 0, not BUSY_TIMEOUT_MS) with PIN Y4 falling as the DECLARED TWIN (the second process's writes fail instead of queueing), and Y3/Y5/Y6 GREEN. Both controls GREEN. No VOID probe, no TypeScript error."
say "logs: $LOGS/{control,arm-a,arm-b,control2}/{cheap,full}.log — raw transcript: $OUT"
exit 0
