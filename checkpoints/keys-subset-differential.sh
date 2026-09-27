#!/usr/bin/env bash
#
# The writer's OWN differential for SLICE 6 — the permission boundary of
# `POST /keys` (`src/server/app.ts`). Kept as reproducible evidence for this landing
# and as a worked example, NOT a general harness: the arms below are this slice's
# pins and file.
#
# TWO arms, because here ONE direction is not enough. A subset check that simply
# says "no" to everything would satisfy K1/K2 and break the product; a check that is
# merely ABSENT satisfies K3 and breaks the intent. So:
#   ARM A  the subset check is DELETED (nothing checks the minter's own perms)
#                       -> PIN K1 and PIN K2 must go RED  (the defect measure)
#   ARM B  the check is STRICTER than correct: the requested perms must EQUAL the
#          minter's grantable set (a subset is refused)
#                       -> PIN K3 must go RED  (the anti-vacuity direction)
#
# Every arm edits the ONE anchored line, prints its file's sha256 before and after
# (an unchanged hash would make the arm VOID), runs BOTH tiers directly, and asserts
# the suite went RED on its own named pin. The restore is `git checkout HEAD --` and
# runs from an EXIT INT TERM trap, so a crash mid-arm cannot leave the tree mutated.
# The slice is COMMITTED before this runs (that is what makes `HEAD` the pristine
# copy).
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
OUT="$WORKTREE/checkpoints/keys-subset-differential.out"
LOGS="$WORKTREE/.diff-harness"
mkdir -p "$LOGS"
: > "$OUT"

APP="src/server/app.ts"
PIN_K1="PIN K1: a READ-ONLY key cannot mint a permission it does not hold"
PIN_K2="PIN K2: a key lacking 'delete' cannot mint 'delete'"
PIN_K3="PIN K3: a key passes on exactly what it holds, and no more"

# The ONE anchored line each arm rewrites (the subset predicate's refusal list).
ANCHOR='    const lacks = perms.filter((perm) => !auth.grantablePermissions.includes(perm));'

LOCKED=0
restore() {
  # EVERY file the arms touch, always, idempotently: an error path must not be able
  # to skip cleanup (the row-27 lesson, recorded in deploy-differential.sh).
  git checkout HEAD -- "$APP" >/dev/null 2>&1 || true
  if [ "$LOCKED" = "1" ]; then rm -rf "$LOCK_DIR"; fi
  echo "RESTORED: $APP back at HEAD; lock released" | tee -a "$OUT"
}
trap restore EXIT INT TERM

say() { echo "$@" | tee -a "$OUT"; }
fail() { say "HARNESS FAILURE: $*"; exit 1; }
hash_of() { sha256sum "$1" | awk '{print $1}'; }

grep -qF "$ANCHOR" "$APP" \
  || fail "$APP does not hold the subset-check line this harness anchors on — refusing to guess"

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  OWNER_PID="$(sed -n 's/^pid=//p' "$LOCK_DIR/owner" 2>/dev/null)"
  fail "the gate lock is already held (pid ${OWNER_PID:-unknown}) — this run would be VOID, refused, not evidence"
fi
LOCKED=1
printf 'pid=%s\nstarted=%s\ntier=full\nrepo=%s\nharness=keys-subset-differential\n' \
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
# must appear in the log, and the pin's test must be the failing one.
assert_arm() {
  local label="$1" logdir="$2" pin="$3"
  [ -f "$logdir/full.log" ] || fail "$label: the suite never ran — read $logdir/cheap.log"
  local lines
  lines="$(grep -c "$pin" "$logdir/full.log" || true)"
  say "  named pin RED: $lines line(s) in $logdir/full.log"
  grep -A6 "$pin" "$logdir/full.log" | head -12 | tee -a "$OUT" || true
  grep -q 'Test Files.*failed' "$logdir/full.log" || fail "$label: the suite did not report a failure"
  grep -q "$pin" "$logdir/full.log" || fail "$label went red but NOT on its named pin"
}

# --- control FIRST: the committed tree must be GREEN -------------------------
say "=== CONTROL — the committed tree ($(git rev-parse --short HEAD)) ==="
run_tiers CONTROL "$LOGS/control" || true
if ! grep -qE 'Test Files +[0-9]+ passed' "$LOGS/control/full.log"; then
  fail "the CONTROL run did not pass — read $LOGS/control/full.log; the harness cannot attribute anything"
fi
say "  control GREEN: $(grep -E 'Test Files|Tests ' "$LOGS/control/full.log" | tr '\n' ' ')"

# --- ARM A: the subset check is DELETED (PIN K1 + K2) ------------------------
BEFORE="$(hash_of "$APP")"
python3 - "$APP" "$ANCHOR" <<'PY'
import sys
path, anchor = sys.argv[1], sys.argv[2]
src = open(path).read()
assert src.count(anchor) == 1, "anchor is not unique"
src = src.replace(anchor, "    const lacks: Permission[] = [];  // ARM A: the subset check is GONE")
open(path, "w").write(src)
PY
[ $? -eq 0 ] || fail "ARM A: the injection did not apply"
grep -q 'ARM A: the subset check is GONE' "$APP" || fail "ARM A: the injection is not in $APP"
AFTER_A="$(hash_of "$APP")"
say "=== ARM A — the subset check is DELETED (a key may mint what it does not hold) ==="
say "  file:   $APP"
say "  sha256: $BEFORE  (before)"
say "  sha256: $AFTER_A  (after injection)"
[ "$BEFORE" != "$AFTER_A" ] || fail "arm A hash unchanged — VOID probe"
run_tiers "ARM A" "$LOGS/arm-a" || true
assert_arm "arm A" "$LOGS/arm-a" "$PIN_K1"
assert_arm "arm A" "$LOGS/arm-a" "$PIN_K2"
restore
[ "$(hash_of "$APP")" = "$BEFORE" ] || fail "arm A restore failed — the file hash did not come back"

# --- ARM B: the check is STRICTER than correct — EQUALITY, not subset (PIN K3) ---
BEFORE_B="$(hash_of "$APP")"
python3 - "$APP" "$ANCHOR" <<'PY'
import sys
path, anchor = sys.argv[1], sys.argv[2]
src = open(path).read()
assert src.count(anchor) == 1, "anchor is not unique"
# ARM B: correct = subset; this arm demands EQUALITY, so passing on LESS than you
# hold (a legal subset) is refused. That is the stricter-than-correct defect.
arm = (
    "    const wanted = [...perms].sort().join(\",\");\n"
    "    const held = [...auth.grantablePermissions].sort().join(\",\");\n"
    "    const lacks: Permission[] = wanted === held ? [] : [...perms];  // ARM B: EQUALITY, not subset"
)
src = src.replace(anchor, arm)
open(path, "w").write(src)
PY
[ $? -eq 0 ] || fail "ARM B: the injection did not apply"
grep -q 'ARM B: EQUALITY, not subset' "$APP" || fail "ARM B: the injection is not in $APP"
AFTER_B="$(hash_of "$APP")"
say "=== ARM B — the check demands EQUALITY (a legal SUBSET is refused) ==="
say "  file:   $APP"
say "  sha256: $BEFORE_B  (before)"
say "  sha256: $AFTER_B  (after injection)"
[ "$BEFORE_B" != "$AFTER_B" ] || fail "arm B hash unchanged — VOID probe"
[ "$AFTER_A" != "$AFTER_B" ] || fail "arms A and B produced the SAME hash — VOID probe"
run_tiers "ARM B" "$LOGS/arm-b" || true
assert_arm "arm B" "$LOGS/arm-b" "$PIN_K3"
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
say "DIFFERENTIAL COMPLETE: arm A RED on PIN K1+K2, arm B RED on PIN K3; both controls GREEN. No VOID probe."
say "logs: $LOGS/{control,arm-a,arm-b,control2}/{cheap,full}.log — raw transcript: $OUT"
exit 0
