#!/usr/bin/env bash
#
# The writer's OWN differential for SLICE 10 — the admin UI (C1, ledger row 49).
#
# TWO arms, each aimed at a DIFFERENT pin, because "the key is not persisted" and
# "every path is a registered route" are different claims about the same served bytes:
#   ARM A  `app.js` writes the key to a browser store (`localStorage.setItem`) — the
#          exact persistence API the memory-only rule forbids
#                       -> PIN U2 must go RED  (the "never persists the key" half)
#          file: web/app.js   — the ONE place the key variable is assigned
#   ARM B  `app.js` calls a path no route registers (`fetch("/no-such-route")`), the way
#          a rename or a typo would
#                       -> PIN U3 must go RED  (the "paths are real" half)
#          file: web/app.js   — appended, so the route literals it already had survive
#
# Each arm is SURGICAL: arm A leaves every path alone, arm B leaves the key handling
# alone. The harness asserts the pins that must SURVIVE, because an arm that reddens
# everything proves only that it broke the tree.
#
# Every arm prints its file's sha256 before and after (an unchanged hash would make the
# arm VOID), runs BOTH tiers directly, and asserts the suite went RED on its own named
# pin. The restore is `git checkout HEAD --` and runs from an EXIT INT TERM trap, so a
# crash mid-arm cannot leave the tree mutated. The slice is COMMITTED before this runs
# (that is what makes `HEAD` the pristine copy).
#
# LOCK: this harness takes the SAME lock `scripts/gate.sh` takes (derived from the git
# COMMON dir, so it is one lock across the main tree and every worktree) and holds it
# across every arm. That is why the tiers run DIRECTLY here instead of through
# `gate.sh`: calling the gate would make it refuse itself with exit 9 — VOID, not
# evidence. Per-arm logs go under .diff-harness/, so the green gate log is not clobbered.
#
# The harness runs IN THE WORKTREE (cd to its own directory's parent), so the tree it
# mutates and restores is this slice's, never the main checkout.
#
# NOTE: `web/app.js` is NOT typechecked (tsconfig covers src/** and tests/**), so the
# cheap tier proves nothing about the injected line; it is run anyway because the
# harness's own rule is "a tree that does not compile proves nothing about a pin".
#
# NEVER PRINT A REAL KEY: every line that reaches the transcript is scrubbed of
# `ssk_…`-shaped strings (ledger row 21).

set -u
cd "$(dirname "$0")/.." || exit 1
WORKTREE="$(pwd)"

GIT_COMMON="$(git rev-parse --path-format=absolute --git-common-dir)"
REPO_ROOT="$(cd "$GIT_COMMON/.." && pwd)"
LOCK_DIR="$REPO_ROOT/.gate-lock"
OUT="$WORKTREE/checkpoints/admin-ui-differential.out"
LOGS="$WORKTREE/.diff-harness"
mkdir -p "$LOGS"
: > "$OUT"

APP="web/app.js"
PIN_U1="PIN U1: the UI routes are served, and the served bytes carry no secret"
PIN_U2="PIN U2: the served app.js references no key-persistence API"
PIN_U3="PIN U3: every path the UI calls is a route the API registers"
PIN_U4="PIN U4: the HTML carries no inline key and no remote script"

# The ONE anchored line ARM A rewrites: the module's only assignment to `key`.
APP_KEY_ANCHOR='  key = value;'

LOCKED=0
restore() {
  # EVERY file the arms touch, always, idempotently: an error path must not be able
  # to skip cleanup (the row-27 lesson, recorded in deploy-differential.sh).
  git checkout HEAD -- "$APP" >/dev/null 2>&1 || true
  if [ "$LOCKED" = "1" ]; then rm -rf "$LOCK_DIR"; fi
  echo "RESTORED: $APP back at HEAD; lock released" | tee -a "$OUT"
}
trap restore EXIT INT TERM

redact() { sed -E 's/ssk_[A-Za-z0-9_-]+/ssk_<redacted>/g'; }
say() { echo "$@" | redact | tee -a "$OUT"; }
fail() { say "HARNESS FAILURE: $*"; exit 1; }
hash_of() { sha256sum "$1" | awk '{print $1}'; }

grep -qF "$APP_KEY_ANCHOR" "$APP" \
  || fail "$APP does not hold the key-assignment line this harness anchors on — refusing to guess"

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  OWNER_PID="$(sed -n 's/^pid=//p' "$LOCK_DIR/owner" 2>/dev/null)"
  fail "the gate lock is already held (pid ${OWNER_PID:-unknown}) — this run would be VOID, refused, not evidence"
fi
LOCKED=1
printf 'pid=%s\nstarted=%s\ntier=full\nrepo=%s\nharness=admin-ui-differential\n' \
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

# Assert an arm went RED on its named pin: the suite must fail and the named pin must
# appear in the log. The arm is SURGICAL, so the log MUST NOT carry a `× PIN Ux` test
# title for any OTHER pin (a broader injection would prove only that it broke the tree).
assert_red() {
  local label="$1" logdir="$2" pin="$3"
  [ -f "$logdir/full.log" ] || fail "$label: the suite never ran — read $logdir/cheap.log"
  if grep -qE 'error TS' "$logdir/cheap.log"; then
    fail "$label: the injection ALSO broke the typecheck — the arm is not attributable: $(grep -m1 -E 'error TS' "$logdir/cheap.log")"
  fi
  grep -qE 'Test Files +[0-9]+ failed' "$logdir/full.log" \
    || fail "$label: the suite did not go RED at all — read $logdir/full.log"
  local lines
  lines="$(grep -c "$pin" "$logdir/full.log" || true)"
  say "  named pin RED: $lines line(s) in $logdir/full.log"
  grep -A6 "$pin" "$logdir/full.log" | head -14 | redact | tee -a "$OUT" || true
  grep -q "$pin" "$logdir/full.log" || fail "$label went red but NOT on its named pin"
}

assert_not_red() {
  local label="$1" logdir="$2" pin="$3"
  if grep -F "× $pin" "$logdir/full.log" >/dev/null; then
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

# --- ARM A: the key is persisted (PIN U2) ------------------------------------
BEFORE="$(hash_of "$APP")"
python3 - "$APP" "$APP_KEY_ANCHOR" <<'PY'
import sys
path, anchor = sys.argv[1], sys.argv[2]
src = open(path).read()
assert src.count(anchor) == 1, "anchor is not unique"
# ARM A: the module writes the key into a browser store — the exact persistence API
# the memory-only rule forbids, and PIN U2's whole reason to exist. Every path literal
# is left alone on purpose.
arm = (
    "  key = value;\n"
    "  localStorage.setItem(\"serverstore-key\", value);  // ARM A: the key is persisted\n"
)
src = src.replace(anchor, arm)
open(path, "w").write(src)
PY
[ $? -eq 0 ] || fail "ARM A: the injection did not apply"
grep -q 'ARM A: the key is persisted' "$APP" || fail "ARM A: the injection is not in $APP"
AFTER_A="$(hash_of "$APP")"
say "=== ARM A — the key is written to a browser store (the memory-only rule is broken) ==="
say "  file:   $APP"
say "  sha256: $BEFORE  (before)"
say "  sha256: $AFTER_A  (after injection)"
[ "$BEFORE" != "$AFTER_A" ] || fail "arm A hash unchanged — VOID probe"
run_tiers "ARM A" "$LOGS/arm-a" || true
assert_red "arm A" "$LOGS/arm-a" "$PIN_U2"
# The path scan and the HTML are NOT this arm, so U1/U3/U4 must survive — that is the
# anti-vacuity direction ("arm A broke the tree" would red them too).
assert_not_red "arm A" "$LOGS/arm-a" "$PIN_U1"
assert_not_red "arm A" "$LOGS/arm-a" "$PIN_U3"
assert_not_red "arm A" "$LOGS/arm-a" "$PIN_U4"
restore
[ "$(hash_of "$APP")" = "$BEFORE" ] || fail "arm A restore failed — the file hash did not come back"

# --- ARM B: a path no route registers (PIN U3) -------------------------------
python3 - "$APP" <<'PY'
import sys
path = sys.argv[1]
src = open(path).read()
# ARM B: a call to a path the API does not register — what a renamed route or a typo
# looks like from the console. The key handling is left alone on purpose.
src += "\nfetch(\"/no-such-route\");  // ARM B: a path the API does not register\n"
open(path, "w").write(src)
PY
[ $? -eq 0 ] || fail "ARM B: the injection did not apply"
grep -q 'ARM B: a path the API does not register' "$APP" || fail "ARM B: the injection is not in $APP"
AFTER_B="$(hash_of "$APP")"
say "=== ARM B — the console calls a path no route registers ==="
say "  file:   $APP"
say "  sha256: $BEFORE  (before)"
say "  sha256: $AFTER_B  (after injection)"
[ "$BEFORE" != "$AFTER_B" ] || fail "arm B hash unchanged — VOID probe"
[ "$AFTER_A" != "$AFTER_B" ] || fail "the two arms produced the SAME hash — VOID probe"
run_tiers "ARM B" "$LOGS/arm-b" || true
assert_red "arm B" "$LOGS/arm-b" "$PIN_U3"
# Arm B is SURGICAL: the key handling and the HTML are untouched, so U1/U2/U4 survive.
assert_not_red "arm B" "$LOGS/arm-b" "$PIN_U1"
assert_not_red "arm B" "$LOGS/arm-b" "$PIN_U2"
assert_not_red "arm B" "$LOGS/arm-b" "$PIN_U4"
restore
[ "$(hash_of "$APP")" = "$BEFORE" ] || fail "arm B restore failed — the file hash did not come back"

# --- control AFTER: the restored tree must be GREEN again --------------------
say
say "=== CONTROL — the restored tree ==="
run_tiers "CONTROL 2" "$LOGS/control2" || true
grep -qE 'Test Files +[0-9]+ passed' "$LOGS/control2/full.log" \
  || fail "post-restore suite is not green — read $LOGS/control2/full.log"
say "  control GREEN: $(grep -E 'Test Files|Tests ' "$LOGS/control2/full.log" | tr '\n' ' ')"
say "  sha256: $(hash_of "$APP")  (back to its before hash)"

say
say "DIFFERENTIAL COMPLETE: arm A RED on PIN U2 (the key was persisted); arm B RED on PIN U3 (a path no route registers); both controls GREEN. No VOID probe."
say "logs: $LOGS/{control,arm-a,arm-b,control2}/{cheap,full}.log — raw transcript: $OUT"
exit 0
