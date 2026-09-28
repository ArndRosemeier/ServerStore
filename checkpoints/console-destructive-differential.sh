#!/usr/bin/env bash
#
# The writer's OWN differential for SLICE 18 — the console's four destructive actions.
# Ledger row 82; design authority is row 81.
#
# TWO arms, each aimed at a DIFFERENT mechanism, because a console can fail this slice in
# two opposite directions: it can DESTROY WITHOUT THE TYPED CONFIRMATION, or it can LOOK
# right while doing the filtering in the wrong place.
#
#   ARM A  the whole-store confirmation is PRE-FILLED with the store name — the token is
#          taken from the module's own variable instead of from the field the operator
#          typed. A WRONG typed name then destroys the store.
#                       -> PIN V4 must go RED ("a wrong name changes nothing")
#          file: web/app.js
#          The arm MUST leave V5 (which types the RIGHT name each time), V1/V2/V3/V6/V7
#          and every static pin GREEN: only the mismatch refusal was removed.
#
#   ARM B  the entry list filters CLIENT-SIDE — the whole store is fetched and narrowed in
#          the browser, so the request carries NO `prefix=`. The rendered names stay
#          correct, which is exactly why V2 exists.
#                       -> PIN V2 must go RED ("the prefix filter is server-side")
#          file: web/app.js
#          The arm MUST leave every other pin GREEN: the visible list is still correct.
#
# The slice is COMMITTED before this runs (that is what makes `HEAD` the pristine copy).
# Every arm prints web/app.js's sha256 before and after (an unchanged hash would be VOID),
# runs BOTH tiers directly while HOLDING THE SAME LOCK `scripts/gate.sh` takes (calling
# the gate here would make it refuse itself with exit 9 — VOID, not evidence), and the
# restore is `git checkout HEAD --` in an `EXIT INT TERM` trap with the hash asserted
# back. Per-arm logs go under .diff-harness-console/, so the green gate log is not
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
OUT="$WORKTREE/checkpoints/console-destructive-differential.out"
LOGS="$WORKTREE/.diff-harness-console"
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
printf 'pid=%s\nstarted=%s\ntier=full\nrepo=%s\nharness=console-destructive-differential\n' \
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
  grep -A12 -F "× $pin" "$logdir/full.log" | head -20 | redact | tee -a "$OUT" || true
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

# --- ARM A: the whole-store token is PRE-FILLED (PIN V4) ---------------------
BEFORE_A="$(hash_of "$APP_JS")"
python3 - "$APP_JS" <<'PY'
import sys

path = sys.argv[1]
src = open(path).read()
anchor = "    const typed = input.value.trim();\n    if (typed !== storeName) {"
assert src.count(anchor) == 1, "ARM A: the typed-name read + mismatch check is not unique"
replacement = (
    "    const typed = storeName;  // ARM A: the token is PRE-FILLED from the store name\n"
    "    if (typed !== storeName) {"
)
open(path, "w").write(src.replace(anchor, replacement))
PY
[ $? -eq 0 ] || fail "ARM A: the injection did not apply"
grep -q 'ARM A: the token is PRE-FILLED' "$APP_JS" || fail "ARM A: the injection is not in $APP_JS"
AFTER_A="$(hash_of "$APP_JS")"
say "=== ARM A — the whole-store token is PRE-FILLED: a WRONG typed name destroys the store ==="
say "  file:   $APP_JS"
say "  sha256: $BEFORE_A  (before)"
say "  sha256: $AFTER_A  (after injection)"
[ "$BEFORE_A" != "$AFTER_A" ] || fail "arm A hash unchanged — VOID probe"
run_tiers "ARM A" "$LOGS/arm-a" || true
assert_red "arm A" "$LOGS/arm-a" "$PIN_V4"
browser_file_summary "$LOGS/arm-a"
[ "$(chrome_count)" = "0" ] || fail "arm A left $(chrome_count) chrome processes behind — VOID"
# Anti-vacuity: the RIGHT-name flow and every other destructive pin survive, so the arm
# isolates the MISMATCH REFUSAL rather than "the store flows are broken".
assert_not_red "arm A" "$LOGS/arm-a" "$PIN_V1"
assert_not_red "arm A" "$LOGS/arm-a" "$PIN_V2"
assert_not_red "arm A" "$LOGS/arm-a" "$PIN_V3"
assert_not_red "arm A" "$LOGS/arm-a" "$PIN_V5"
assert_not_red "arm A" "$LOGS/arm-a" "$PIN_V6"
assert_not_red "arm A" "$LOGS/arm-a" "$PIN_V7"
assert_not_red "arm A" "$LOGS/arm-a" "$PIN_U2"
assert_not_red "arm A" "$LOGS/arm-a" "$PIN_U3"
restore
[ "$(hash_of "$APP_JS")" = "$BEFORE_A" ] || fail "arm A restore failed — the file hash did not come back"

# --- ARM B: the entry list filters CLIENT-SIDE (PIN V2) ----------------------
BEFORE_B="$(hash_of "$APP_JS")"
python3 - "$APP_JS" <<'PY'
import sys

path = sys.argv[1]
src = open(path).read()
anchor = (
    "  const payload = await api(entriesPath(storeName, openPrefix));\n"
    "  const objects = payload.objects;"
)
assert src.count(anchor) == 1, "ARM B: the entries fetch is not unique"
replacement = (
    '  const payload = await api(entriesPath(storeName, ""));  // ARM B: fetch the WHOLE store\n'
    "  const objects = payload.objects.filter((entry) => entry.name.startsWith(openPrefix));  // ARM B: filter HERE"
)
open(path, "w").write(src.replace(anchor, replacement))
PY
[ $? -eq 0 ] || fail "ARM B: the injection did not apply"
grep -q 'ARM B: filter HERE' "$APP_JS" || fail "ARM B: the injection is not in $APP_JS"
AFTER_B="$(hash_of "$APP_JS")"
say "=== ARM B — the entry list filters CLIENT-SIDE: the request carries NO prefix= ==="
say "  file:   $APP_JS"
say "  sha256: $BEFORE_B  (before)"
say "  sha256: $AFTER_B  (after injection)"
[ "$BEFORE_B" != "$AFTER_B" ] || fail "arm B hash unchanged — VOID probe"
run_tiers "ARM B" "$LOGS/arm-b" || true
assert_red "arm B" "$LOGS/arm-b" "$PIN_V2"
browser_file_summary "$LOGS/arm-b"
[ "$(chrome_count)" = "0" ] || fail "arm B left $(chrome_count) chrome processes behind — VOID"
# Anti-vacuity: the VISIBLE list is still correct, so every other pin must survive — the
# narrowed names are identical, and only the network path betrays the defect.
assert_not_red "arm B" "$LOGS/arm-b" "$PIN_V1"
assert_not_red "arm B" "$LOGS/arm-b" "$PIN_V3"
assert_not_red "arm B" "$LOGS/arm-b" "$PIN_V4"
assert_not_red "arm B" "$LOGS/arm-b" "$PIN_V5"
assert_not_red "arm B" "$LOGS/arm-b" "$PIN_V6"
assert_not_red "arm B" "$LOGS/arm-b" "$PIN_B1"
assert_not_red "arm B" "$LOGS/arm-b" "$PIN_B2"
assert_not_red "arm B" "$LOGS/arm-b" "$PIN_B3"
assert_not_red "arm B" "$LOGS/arm-b" "$PIN_B6"
assert_not_red "arm B" "$LOGS/arm-b" "$PIN_U1"
assert_not_red "arm B" "$LOGS/arm-b" "$PIN_U2"
assert_not_red "arm B" "$LOGS/arm-b" "$PIN_U3"
assert_not_red "arm B" "$LOGS/arm-b" "$PIN_U4"
# THE DECLARED TWIN, named rather than hidden: V7's 400 half drives an ILLEGAL prefix so the
# SERVER answers invalid_name, and that request IS the `prefix=` query V2 pins. A defect
# that removes the server-side query therefore removes the only UI route to a genuine 400,
# so NO mutation of `refreshEntries` can redden V2 alone. The harness ASSERTS the twin is
# red (an arm that stopped reddening it would no longer target the server-side query).
pin_red "$LOGS/arm-b" "$PIN_V7" || fail "arm B did NOT redden its declared twin $PIN_V7 — re-derive the arm"
say "  DECLARED TWIN (named): $PIN_V7 -> RED — its 400 half rides the SAME prefix= query"
restore
[ "$(hash_of "$APP_JS")" = "$BEFORE_B" ] || fail "arm B restore failed — the file hash did not come back"

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
say "DIFFERENTIAL COMPLETE: arm A RED on PIN V4 (the pre-filled whole-store token let a WRONG typed name destroy the store) with the right-name flow and every other pin GREEN; arm B RED on PIN V2 (the listing was filtered CLIENT-SIDE, so no request carried prefix=) with the visible list still correct, PIN V7 RED as the DECLARED TWIN (its 400 half rides the same prefix= query) and every other pin GREEN. Both controls GREEN. Our own chrome processes after every run: 0 (count scoped to ServerStore/*browser-scratch; the brief's literal command self-matches its own grep, measured). No VOID probe."
say "logs: $LOGS/{control,arm-a,arm-b,control2}/{cheap,full}.log — raw transcript: $OUT"
exit 0
