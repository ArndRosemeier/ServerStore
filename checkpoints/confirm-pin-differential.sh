#!/usr/bin/env bash
#
# The writer's OWN differential for SLICE 19 — make the single-item confirmation
# FALSIFIABLE. Ledger row 84; the gap it closes was found by the dispatcher's own arm W
# at row 83, which ran the guard's action on the FIRST click and went GREEN everywhere.
#
# ONE arm, because there is exactly one defect to prove the new pin catches: the
# `armGuard` seam runs `options.onConfirm()` on the FIRST click, so ONE unguarded click
# destroys a key (or an entry). The seam is shared by BOTH single-item controls, so the
# arm must redden BOTH extended pins:
#
#   ARM G  `armGuard` runs the action on the first click (the guard is bypassed).
#                       -> PIN V1 must go RED ("a KEY does nothing on the first click")
#                       -> PIN V3 must go RED ("ONE entry does nothing on the first click")
#          file: web/app.js
#          The arm MUST leave V2, V4, V6, V7, B1-B3, B6 and U1-U4 GREEN: only the
#          one-item guard was changed, so the typed-name whole-store flows, the prefix
#          query and the static scans are untouched. PIN V5 uses the SAME guard to delete
#          its blocking key, so it is DECLARED COLLATERAL and is measured, not asserted
#          either way (its own confirm click may or may not still find the row).
#
# The slice is COMMITTED before this runs (that is what makes `HEAD` the pristine copy).
# Every arm prints web/app.js's sha256 before and after (an unchanged hash would be VOID),
# runs BOTH tiers directly while HOLDING THE SAME LOCK `scripts/gate.sh` takes (calling
# the gate here would make it refuse itself with exit 9 — VOID, not evidence), and the
# restore is `git checkout HEAD --` in an `EXIT INT TERM` trap with the hash asserted
# back. Per-arm logs go under .diff-harness-confirm-pin/, so the green gate log is not
# clobbered.
#
# The harness runs IN THE WORKTREE (cd to its own directory's parent), so the tree it
# mutates and restores is this slice's, never the main checkout.
#
# CHROME COUNT, scoped to OUR OWN profile directory: the bare `ps -eo comm= | grep -c
# '^chrome$'` count of earlier slices measures the NEIGHBOURS on this shared box (TRAP
# t8). The count below is `ps -eo args | grep -c` restricted to a path under
# `ServerStore/*browser-scratch`, and the pattern's first `e` is BRACKETED so this
# script's own `grep` argv cannot match itself — the exact command the brief quotes
# self-matches (its pattern is in the grep's own command line), measured and recorded in
# the transcript.
#
# NEVER PRINT A REAL KEY: every line that reaches the transcript is scrubbed of
# `ssk_…`-shaped strings (ledger row 21).

set -u
cd "$(dirname "$0")/.." || exit 1
WORKTREE="$(pwd)"

GIT_COMMON="$(git rev-parse --path-format=absolute --git-common-dir)"
REPO_ROOT="$(cd "$GIT_COMMON/.." && pwd)"
LOCK_DIR="$REPO_ROOT/.gate-lock"
OUT="$WORKTREE/checkpoints/confirm-pin-differential.out"
LOGS="$WORKTREE/.diff-harness-confirm-pin"
mkdir -p "$LOGS"
: > "$OUT"

APP_JS="web/app.js"

PIN_V1="PIN V1: the console deletes a KEY, and the credential dies"
PIN_V2="PIN V2: the console shows a store's ENTRIES, and the prefix filter is server-side"
PIN_V3="PIN V3: the console deletes ONE entry, and the other survives"
PIN_V4="PIN V4: emptying needs the TYPED name, and a wrong name changes nothing"
PIN_V5="PIN V5: a BLOCKED store delete is shown, and then succeeds once the key is gone"
PIN_V6="PIN V6: the console's promises hold with the new controls"
PIN_V7="PIN V7: the outcomes are legible"
PIN_B1="PIN B1: the console's JavaScript RUNS in a real browser, with no page error"
PIN_B2="PIN B2: a master key typed into the console AUTHENTICATES through the UI"
PIN_B3="PIN B3: the console's EDIT flow really PATCHes"
PIN_B6="PIN B6: a DISALLOWED origin is blocked BY THE BROWSER"
PIN_U1="PIN U1: the UI routes are served, and the served bytes carry no secret"
PIN_U2="PIN U2: the served app.js references no key-persistence API"
PIN_U3="PIN U3: every path the UI calls is a route the API registers"
PIN_U4="PIN U4: the HTML carries no inline key and no remote script"

LOCKED=0
restore() {
  # Always, idempotently: an error path must not be able to skip cleanup.
  git checkout HEAD -- "$APP_JS" >/dev/null 2>&1 || true
  if [ "$LOCKED" = "1" ]; then rm -rf "$LOCK_DIR"; fi
  echo "RESTORED: $APP_JS back at HEAD; lock released" | tee -a "$OUT"
}
trap restore EXIT INT TERM

redact() { sed -E 's/ssk_[A-Za-z0-9_-]+/ssk_<redacted>/g'; }
say() { echo "$@" | redact | tee -a "$OUT"; }
fail() { say "HARNESS FAILURE: $*"; exit 1; }
hash_of() { sha256sum "$1" | awk '{print $1}'; }

# OUR chrome processes: a profile path under a ServerStore checkout's browser scratch.
# The bracketed first `e` keeps THIS grep from matching its own command line.
chrome_count() { ps -eo args | grep -c 'ServerStor[e]/.*browser-scratch'; }
# The brief's LITERAL command, kept as a measured CONTROL for the self-match (t8).
chrome_count_literal() { ps -eo args | grep -c 'ServerStore/.*browser-scratch'; }

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  OWNER_PID="$(sed -n 's/^pid=//p' "$LOCK_DIR/owner" 2>/dev/null)"
  fail "the gate lock is already held (pid ${OWNER_PID:-unknown}) — this run would be VOID, refused, not evidence"
fi
LOCKED=1
printf 'pid=%s\nstarted=%s\ntier=full\nrepo=%s\nharness=confirm-pin-differential\n' \
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
  grep -A12 -F "× $pin" "$logdir/full.log" | head -22 | redact | tee -a "$OUT" || true
  pin_red "$logdir" "$pin" || fail "$label went red but NOT on its named pin"
}

assert_not_red() {
  local label="$1" logdir="$2" pin="$3"
  if pin_red "$logdir" "$pin"; then
    fail "$label ALSO reddened '$pin' — the injection is broader than the rule it proves"
  fi
}

browser_file_summary() {
  local log="$1/full.log"
  grep -E 'tests/browser\.test\.ts' "$log" | head -2 | redact | tee -a "$OUT" || true
}

suite_summary() {
  grep -E 'Test Files|Tests ' "$1/full.log" | tr '\n' ' '
}

# --- the self-match CONTROL, measured once -----------------------------------
say "chrome-count control (t8): scoped+bracketed=$(chrome_count)  brief's-literal=$(chrome_count_literal)"
say "  the literal command counts the grep THAT IS RUNNING IT (its pattern is in that argv); the bracketed one cannot."

# --- control FIRST: the committed tree must be GREEN -------------------------
say "=== CONTROL — the committed tree ($(git rev-parse --short HEAD)) ==="
run_tiers CONTROL "$LOGS/control" || true
if ! grep -qE 'Test Files +[0-9]+ passed' "$LOGS/control/full.log"; then
  fail "the CONTROL run did not pass — read $LOGS/control/full.log; the harness cannot attribute anything"
fi
say "  control GREEN: $(suite_summary "$LOGS/control")"
browser_file_summary "$LOGS/control"
[ "$(chrome_count)" = "0" ] || fail "the control run left $(chrome_count) chrome processes behind — VOID"

# --- ARM G: the guard's action runs on the FIRST click (PIN V1 + PIN V3) -----
BEFORE_G="$(hash_of "$APP_JS")"
python3 - "$APP_JS" <<'PY'
import sys

path = sys.argv[1]
src = open(path).read()
anchor = (
    "function armGuard(button, options) {\n"
    "  button.addEventListener(\"click\", () => {\n"
    "    const holder = button.parentElement;"
)
assert src.count(anchor) == 1, "ARM G: the armGuard click listener is not unique"
replacement = (
    "function armGuard(button, options) {\n"
    "  button.addEventListener(\"click\", () => {\n"
    "    options.onConfirm().catch(showError);  // ARM G: the guard fires on the FIRST click\n"
    "    const holder = button.parentElement;"
)
open(path, "w").write(src.replace(anchor, replacement))
PY
[ $? -eq 0 ] || fail "ARM G: the injection did not apply"
grep -q 'ARM G: the guard fires on the FIRST click' "$APP_JS" || fail "ARM G: the injection is not in $APP_JS"
AFTER_G="$(hash_of "$APP_JS")"
say "=== ARM G — armGuard runs options.onConfirm() on the FIRST click: one click destroys ==="
say "  file:   $APP_JS"
say "  sha256: $BEFORE_G  (before)"
say "  sha256: $AFTER_G  (after injection)"
[ "$BEFORE_G" != "$AFTER_G" ] || fail "arm G hash unchanged — VOID probe"
run_tiers "ARM G" "$LOGS/arm-g" || true
assert_red "arm G" "$LOGS/arm-g" "$PIN_V1"
assert_red "arm G" "$LOGS/arm-g" "$PIN_V3"
browser_file_summary "$LOGS/arm-g"
[ "$(chrome_count)" = "0" ] || fail "arm G left $(chrome_count) chrome processes behind — VOID"
# Anti-vacuity: the typed-name whole-store flows, the prefix query and the static scans
# do not touch `armGuard`, so they must survive — the arm isolates the ONE-ITEM guard.
assert_not_red "arm G" "$LOGS/arm-g" "$PIN_V2"
assert_not_red "arm G" "$LOGS/arm-g" "$PIN_V4"
assert_not_red "arm G" "$LOGS/arm-g" "$PIN_V6"
assert_not_red "arm G" "$LOGS/arm-g" "$PIN_V7"
assert_not_red "arm G" "$LOGS/arm-g" "$PIN_B1"
assert_not_red "arm G" "$LOGS/arm-g" "$PIN_B2"
assert_not_red "arm G" "$LOGS/arm-g" "$PIN_B3"
assert_not_red "arm G" "$LOGS/arm-g" "$PIN_B6"
assert_not_red "arm G" "$LOGS/arm-g" "$PIN_U1"
assert_not_red "arm G" "$LOGS/arm-g" "$PIN_U2"
assert_not_red "arm G" "$LOGS/arm-g" "$PIN_U3"
assert_not_red "arm G" "$LOGS/arm-g" "$PIN_U4"
# THE DECLARED COLLATERAL, named rather than hidden: V5 deletes its BLOCKING KEY through
# the SAME armGuard, so the arm can redden it too. It is measured, not asserted (its own
# confirm click may still find the row depending on refresh timing), and reported.
if pin_red "$LOGS/arm-g" "$PIN_V5"; then
  say "  DECLARED COLLATERAL (measured, not asserted): $PIN_V5 -> RED — it deletes its blocking key through the SAME armGuard"
else
  say "  DECLARED COLLATERAL (measured, not asserted): $PIN_V5 -> green in this run — its confirm click still found the row"
fi
restore
[ "$(hash_of "$APP_JS")" = "$BEFORE_G" ] || fail "arm G restore failed — the file hash did not come back"

# --- control AFTER: the restored tree must be GREEN again --------------------
say
say "=== CONTROL — the restored tree ==="
run_tiers "CONTROL 2" "$LOGS/control2" || true
grep -qE 'Test Files +[0-9]+ passed' "$LOGS/control2/full.log" \
  || fail "post-restore suite is not green — read $LOGS/control2/full.log"
say "  control GREEN: $(suite_summary "$LOGS/control2")"
browser_file_summary "$LOGS/control2"
say "  sha256: $(hash_of "$APP_JS")  (web/app.js back to its before hash)"
[ "$(chrome_count)" = "0" ] || fail "the post-restore control left $(chrome_count) chrome processes behind — VOID"

say
say "DIFFERENTIAL COMPLETE: ARM G — armGuard running options.onConfirm() on the FIRST click — went RED on PIN V1 and PIN V3, the two controls that share the seam (a key Delete and an entry Delete), with V2, V4, V6, V7, B1-B3, B6 and U1-U4 GREEN and V5 measured as the declared collateral. Both controls GREEN, so the pin is not merely always-red. Our own chrome processes after every run: 0 (count scoped to ServerStore/*browser-scratch; the brief's literal command self-matches its own grep, measured). No VOID probe."
say "logs: $LOGS/{control,arm-g,control2}/{cheap,full}.log — raw transcript: $OUT"
exit 0
