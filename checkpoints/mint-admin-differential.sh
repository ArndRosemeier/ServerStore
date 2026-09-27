#!/usr/bin/env bash
#
# The writer's OWN differential for SLICE 7 — WHO MAY MINT on `POST /keys`
# (`src/server/app.ts`). Kept as reproducible evidence for this landing and as a worked
# example, NOT a general harness: the arms below are this slice's pins and file.
#
# TWO arms in OPPOSITE directions, because one direction cannot tell "the rule is
# missing" from "the rule is too strict":
#   ARM A  the admin requirement is DELETED (any key may mint again)
#                       -> PIN M1 must go RED  (the defect measure)
#   ARM B  the rule is STRICTER than correct — an admin minter must ALSO be a MASTER
#          (scope `*`), so a STORE-SCOPED admin key is refused
#                       -> PIN M2 must go RED while M1/M3/M4/M5 stay GREEN
#          (that is what proves the pin distinguishes a store-scoped admin from a
#          master admin, and that the slice did not simply break the flow). The
#          non-admin branch is left carrying the CORRECT refusal ON PURPOSE, so the
#          arm moves ONLY the store-scoped-admin case — the one M2 pins.
#
# Every arm edits the ONE anchored line, prints its file's sha256 before and after (an
# unchanged hash would make the arm VOID), runs BOTH tiers directly, and asserts the
# suite went RED on its own named pin. The restore is `git checkout HEAD --` and runs
# from an EXIT INT TERM trap, so a crash mid-arm cannot leave the tree mutated. The
# slice is COMMITTED before this runs (that is what makes `HEAD` the pristine copy).
#
# LOCK: this harness takes the SAME lock `scripts/gate.sh` takes (derived from the git
# COMMON dir, so it is one lock across the main tree and every worktree) and holds it
# across every arm. That is why the tiers run DIRECTLY here instead of through
# `gate.sh`: calling the gate would make it refuse itself with exit 9 — VOID, not
# evidence. Per-arm logs go under .diff-harness/, so the green gate log is not
# clobbered.
#
# The harness runs IN THE WORKTREE (cd to its own directory's parent), so the tree it
# mutates and restores is this slice's, never the main checkout.

set -u
cd "$(dirname "$0")/.." || exit 1
WORKTREE="$(pwd)"

GIT_COMMON="$(git rev-parse --path-format=absolute --git-common-dir)"
REPO_ROOT="$(cd "$GIT_COMMON/.." && pwd)"
LOCK_DIR="$REPO_ROOT/.gate-lock"
OUT="$WORKTREE/checkpoints/mint-admin-differential.out"
LOGS="$WORKTREE/.diff-harness"
mkdir -p "$LOGS"
: > "$OUT"

APP="src/server/app.ts"
PIN_M1="PIN M1: a non-admin key cannot mint ANY key"
PIN_M2="PIN M2: a store-scoped ADMIN key mints within its store"
PIN_M5="PIN M5: a master admin key still mints any non-admin permission"

# The ONE anchored line each arm rewrites (the who-may-mint decision).
ANCHOR='    auth.requireAdmin();'

LOCKED=0
restore() {
  # EVERY file the arms touch, always, idempotently: an error path must not be able
  # to skip cleanup (the row-27 lesson, recorded in deploy-differential.sh).
  git checkout HEAD -- "$APP" >/dev/null 2>&1 || true
  if [ "$LOCKED" = "1" ]; then rm -rf "$LOCK_DIR"; fi
  echo "RESTORED: $APP back at HEAD; lock released" | tee -a "$OUT"
}
trap restore EXIT INT TERM

# Every line that reaches the transcript is scrubbed of key-shaped strings: a raw key
# belongs only in the mint response and the Authorization header (ledger row 21), never
# in a committed evidence file. A mint-failure assertion message can carry a 201 body.
redact() { sed -E 's/ssk_[A-Za-z0-9_-]+/ssk_<redacted>/g'; }
say() { echo "$@" | redact | tee -a "$OUT"; }
fail() { say "HARNESS FAILURE: $*"; exit 1; }
hash_of() { sha256sum "$1" | awk '{print $1}'; }

grep -qF "$ANCHOR" "$APP" \
  || fail "$APP does not hold the who-may-mint line this harness anchors on — refusing to guess"

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  OWNER_PID="$(sed -n 's/^pid=//p' "$LOCK_DIR/owner" 2>/dev/null)"
  fail "the gate lock is already held (pid ${OWNER_PID:-unknown}) — this run would be VOID, refused, not evidence"
fi
LOCKED=1
printf 'pid=%s\nstarted=%s\ntier=full\nrepo=%s\nharness=mint-admin-differential\n' \
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

# Assert an arm went RED on exactly its named pin: the suite must fail, the named pin
# must appear in the log, and the arm must NOT have reddened the pins we require green.
assert_red() {
  local label="$1" logdir="$2" pin="$3"
  [ -f "$logdir/full.log" ] || fail "$label: the suite never ran — read $logdir/cheap.log"
  local lines
  lines="$(grep -c "$pin" "$logdir/full.log" || true)"
  say "  named pin RED: $lines line(s) in $logdir/full.log"
  grep -A6 "$pin" "$logdir/full.log" | head -14 | redact | tee -a "$OUT" || true
  grep -q 'Test Files.*failed' "$logdir/full.log" || fail "$label: the suite did not report a failure"
  grep -q "$pin" "$logdir/full.log" || fail "$label went red but NOT on its named pin"
}

assert_not_red() {
  local label="$1" logdir="$2" pin="$3"
  if grep -F "× $pin" "$logdir/full.log" >/dev/null; then
    fail "$label reddened '$pin' as well — the injection is broader than the rule it proves"
  fi
}

# --- control FIRST: the committed tree must be GREEN -------------------------
say "=== CONTROL — the committed tree ($(git rev-parse --short HEAD)) ==="
run_tiers CONTROL "$LOGS/control" || true
if ! grep -qE 'Test Files +[0-9]+ passed' "$LOGS/control/full.log"; then
  fail "the CONTROL run did not pass — read $LOGS/control/full.log; the harness cannot attribute anything"
fi
say "  control GREEN: $(grep -E 'Test Files|Tests ' "$LOGS/control/full.log" | tr '\n' ' ')"

# --- ARM A: the admin requirement is DELETED (PIN M1) ------------------------
BEFORE="$(hash_of "$APP")"
python3 - "$APP" "$ANCHOR" <<'PY'
import sys
path, anchor = sys.argv[1], sys.argv[2]
src = open(path).read()
assert src.count(anchor) == 1, "anchor is not unique"
src = src.replace(anchor, "    // ARM A: the admin requirement is GONE")
open(path, "w").write(src)
PY
[ $? -eq 0 ] || fail "ARM A: the injection did not apply"
grep -q 'ARM A: the admin requirement is GONE' "$APP" || fail "ARM A: the injection is not in $APP"
AFTER_A="$(hash_of "$APP")"
say "=== ARM A — the admin requirement is DELETED (a read-only key may mint again) ==="
say "  file:   $APP"
say "  sha256: $BEFORE  (before)"
say "  sha256: $AFTER_A  (after injection)"
[ "$BEFORE" != "$AFTER_A" ] || fail "arm A hash unchanged — VOID probe"
run_tiers "ARM A" "$LOGS/arm-a" || true
assert_red "arm A" "$LOGS/arm-a" "$PIN_M1"
# The store-scoped admin flow must still work in arm A: only M1 may fall.
assert_not_red "arm A" "$LOGS/arm-a" "$PIN_M2"
assert_not_red "arm A" "$LOGS/arm-a" "$PIN_M5"
restore
[ "$(hash_of "$APP")" = "$BEFORE" ] || fail "arm A restore failed — the file hash did not come back"

# --- ARM B: STRICTER than correct — an admin minter must be MASTER (PIN M2) --
BEFORE_B="$(hash_of "$APP")"
python3 - "$APP" "$ANCHOR" <<'PY'
import sys
path, anchor = sys.argv[1], sys.argv[2]
src = open(path).read()
assert src.count(anchor) == 1, "anchor is not unique"
# ARM B: correct = any admin may mint; this arm additionally requires a MASTER admin,
# so a store-scoped admin key is refused. The non-admin branch keeps the CORRECT
# refusal (and its message) ON PURPOSE: a mutation that also changed that would red M1
# too, and would then prove "arm B breaks many things" instead of "M2 catches
# over-strictness for a store-scoped admin".
arm = (
    "    if (auth.key.perms.includes(\"admin\")) { auth.requireMasterAdmin(); } "
    "else { auth.requireAdmin(); }  // ARM B: an admin minter must also be MASTER"
)
src = src.replace(anchor, arm)
open(path, "w").write(src)
PY
[ $? -eq 0 ] || fail "ARM B: the injection did not apply"
grep -q 'ARM B: an admin minter must also be MASTER' "$APP" || fail "ARM B: the injection is not in $APP"
AFTER_B="$(hash_of "$APP")"
say "=== ARM B — STRICTER than correct: an admin minter must also be a MASTER ==="
say "  file:   $APP"
say "  sha256: $BEFORE_B  (before)"
say "  sha256: $AFTER_B  (after injection)"
[ "$BEFORE_B" != "$AFTER_B" ] || fail "arm B hash unchanged — VOID probe"
[ "$AFTER_A" != "$AFTER_B" ] || fail "arms A and B produced the SAME hash — VOID probe"
run_tiers "ARM B" "$LOGS/arm-b" || true
assert_red "arm B" "$LOGS/arm-b" "$PIN_M2"
# Arm B is SURGICAL: a store-scoped admin is refused, so ONLY M2 may fall; M1 (a
# non-admin is still refused) and M5 (a master admin still mints) MUST stay green —
# that is what proves the pin tells the two kinds of admin apart.
assert_not_red "arm B" "$LOGS/arm-b" "$PIN_M1"
assert_not_red "arm B" "$LOGS/arm-b" "$PIN_M5"
restore
[ "$(hash_of "$APP")" = "$BEFORE_B" ] || fail "arm B restore failed — the file hash did not come back"

# --- control AFTER: the restored tree must be GREEN again --------------------
say
say "=== CONTROL — the restored tree ==="
run_tiers "CONTROL 2" "$LOGS/control2" || true
grep -qE 'Test Files +[0-9]+ passed' "$LOGS/control2/full.log" \
  || fail "post-restore suite is not green — read $LOGS/control2/full.log"
say "  control GREEN: $(grep -E 'Test Files|Tests ' "$LOGS/control2/full.log" | tr '\n' ' ')"
say "  sha256: $(hash_of "$APP")  (back to its before hash)"

say
say "DIFFERENTIAL COMPLETE: arm A RED on PIN M1; arm B RED on PIN M2 with M1/M5 GREEN; both controls GREEN. No VOID probe."
say "logs: $LOGS/{control,arm-a,arm-b,control2}/{cheap,full}.log — raw transcript: $OUT"
exit 0
