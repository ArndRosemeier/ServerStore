#!/usr/bin/env bash
#
# The writer's OWN differential for SLICE 15 — the headless-browser test the console and
# CORS are owed. Ledger rows 67/68.
#
# TWO arms, each aimed at a DIFFERENT MECHANISM, because one direction cannot tell "the
# console's behaviour is broken" from "the browser refuses to hand a header over":
#   ARM A  the console's EDIT AFFORDANCE is removed — the Edit button still renders, but
#          its click handler does nothing.
#                       -> PIN B3 must go RED  (the "the EDIT flow really PATCHes" half)
#          file: web/app.js
#          The arm MUST leave every OTHER console pin GREEN (B1 the JS runs, B2 the key
#          authenticates) and every cross-origin pin GREEN (B4-B6): only the EDIT flow was
#          removed.
#   ARM B  the REAL RESPONSE stops exposing the object's hash — the
#          `access-control-expose-headers` line that the CORS step sets AFTER `next()`
#          (i.e. on the actual response, not on the preflight's 204) is removed.
#                       -> PIN B5 must go RED  (the "a browser can READ the exposed
#                          x-serverstore-sha256" half)
#          file: src/server/app.ts
#          The arm MUST leave every console pin GREEN (B1-B3) and B4/B6 GREEN: the
#          listing's body and the disallowed-origin refusal do not depend on the exposed
#          set.
#
# EXPECTED COLLATERAL, NAMED DELIBERATELY: arm B also reddens PIN O2 in
# `tests/cors.test.ts`, because O2 asserts the SAME `Access-Control-Expose-Headers`
# contract IN PROCESS (both halves: the cross-origin `GET /stores` and the object GET).
# B5 is the BROWSER half of exactly that contract, so no mutation of `src/server/app.ts`
# can redden B5 alone: the brief's global "an arm that reddens a pin it did not name is
# VOID" rule is unsatisfiable for its OWN arm (b) wording, and the honest record is to
# name the twin rather than pick a different, unrelated mutation. This is the same class
# of overlap row 54 recorded for U1/U4, and the same "expected collateral" shape row 53
# recorded for E1/E2.
#
# The slice is COMMITTED before this runs (that is what makes `HEAD` the pristine copy).
# Every arm prints its file's sha256 before and after (an unchanged hash would be VOID),
# runs BOTH tiers directly while HOLDING THE SAME LOCK `scripts/gate.sh` takes (calling
# the gate here would make it refuse itself with exit 9 — VOID, not evidence), and the
# restore is `git checkout HEAD --` in an `EXIT INT TERM` trap. Per-arm logs go under
# .diff-harness-browser/, so the green gate log is not clobbered.
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
OUT="$WORKTREE/checkpoints/browser-differential.out"
LOGS="$WORKTREE/.diff-harness-browser"
mkdir -p "$LOGS"
: > "$OUT"

APP_JS="web/app.js"
APP_TS="src/server/app.ts"

PIN_B1="PIN B1: the console's JavaScript RUNS in a real browser, with no page error"
PIN_B2="PIN B2: a master key typed into the console AUTHENTICATES through the UI"
PIN_B3="PIN B3: the console's EDIT flow really PATCHes"
PIN_B4="PIN B4: a real browser on ANOTHER ORIGIN completes an authorized fetch"
PIN_B5="PIN B5: that browser can READ the exposed x-serverstore-sha256"
PIN_B6="PIN B6: a DISALLOWED origin is blocked BY THE BROWSER"
PIN_B7="PIN B7: nothing outlives the test — the Chrome process TREE is gone"
PIN_B8="PIN B8: a missing browser FAILS loudly instead of skipping"
PIN_U1="PIN U1: the UI routes are served, and the served bytes carry no secret"
PIN_U2="PIN U2: the served app.js references no key-persistence API"
PIN_U3="PIN U3: every path the UI calls is a route the API registers"
PIN_U4="PIN U4: the HTML carries no inline key and no remote script"
PIN_O1="PIN O1: an unkeyed preflight is 2xx, allows PATCH, and names \`authorization\` as a whole word"
PIN_O2_GET="PIN O2: a cross-origin GET /stores with a valid key returns the real body plus Allow-Origin"
PIN_O2_OBJ="PIN O2: an object's \`x-serverstore-sha256\` is exposed to the cross-origin reader"
PIN_R5="PIN R5: the exemptions are real — /healthz, the three UI assets and a preflight answer while the API identity is over its limit"

LOCKED=0
restore() {
  # Always, idempotently: an error path must not be able to skip cleanup.
  git checkout HEAD -- "$APP_JS" "$APP_TS" >/dev/null 2>&1 || true
  if [ "$LOCKED" = "1" ]; then rm -rf "$LOCK_DIR"; fi
  echo "RESTORED: $APP_JS and $APP_TS back at HEAD; lock released" | tee -a "$OUT"
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
printf 'pid=%s\nstarted=%s\ntier=full\nrepo=%s\nharness=browser-differential\n' \
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
  grep -A10 -F "× $pin" "$logdir/full.log" | head -18 | redact | tee -a "$OUT" || true
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

chrome_count() { ps -eo comm= | grep -c '^chrome$'; }

# --- control FIRST: the committed tree must be GREEN -------------------------
say "=== CONTROL — the committed tree ($(git rev-parse --short HEAD)) ==="
run_tiers CONTROL "$LOGS/control" || true
if ! grep -qE 'Test Files +[0-9]+ passed' "$LOGS/control/full.log"; then
  fail "the CONTROL run did not pass — read $LOGS/control/full.log; the harness cannot attribute anything"
fi
say "  control GREEN: $(grep -E 'Test Files|Tests ' "$LOGS/control/full.log" | tr '\n' ' ')"
browser_file_summary "$LOGS/control"
[ "$(chrome_count)" = "0" ] || fail "the control run left $(chrome_count) chrome processes behind — VOID"

# --- ARM A: the console's Edit affordance removed (PIN B3) -------------------
BEFORE_A="$(hash_of "$APP_JS")"
python3 - "$APP_JS" <<'PY'
import sys

path = sys.argv[1]
src = open(path).read()
anchor = '''    edit.addEventListener("click", () => {
      openEditor(item, entry).catch(showError);
    });'''
assert src.count(anchor) == 1, "ARM A: the Edit click handler is not unique"
replacement = '    edit.addEventListener("click", () => {});  // ARM A: the Edit affordance removed'
open(path, "w").write(src.replace(anchor, replacement))
PY
[ $? -eq 0 ] || fail "ARM A: the injection did not apply"
grep -q 'ARM A: the Edit affordance removed' "$APP_JS" || fail "ARM A: the injection is not in $APP_JS"
AFTER_A="$(hash_of "$APP_JS")"
say "=== ARM A — the console's EDIT AFFORDANCE removed: the Edit button does nothing ==="
say "  file:   $APP_JS"
say "  sha256: $BEFORE_A  (before)"
say "  sha256: $AFTER_A  (after injection)"
[ "$BEFORE_A" != "$AFTER_A" ] || fail "arm A hash unchanged — VOID probe"
run_tiers "ARM A" "$LOGS/arm-a" || true
grep -A18 -F "× $PIN_B3" "$LOGS/arm-a/full.log" | head -24 | redact | tee -a "$OUT" || true
assert_red "arm A" "$LOGS/arm-a" "$PIN_B3"
browser_file_summary "$LOGS/arm-a"
[ "$(chrome_count)" = "0" ] || fail "arm A left $(chrome_count) chrome processes behind — VOID"
# Anti-vacuity: the console still RUNS and still AUTHENTICATES, and the cross-origin pins
# are untouched — so the arm isolates the EDIT flow, not "the page is broken".
assert_not_red "arm A" "$LOGS/arm-a" "$PIN_B1"
assert_not_red "arm A" "$LOGS/arm-a" "$PIN_B2"
assert_not_red "arm A" "$LOGS/arm-a" "$PIN_B4"
assert_not_red "arm A" "$LOGS/arm-a" "$PIN_B5"
assert_not_red "arm A" "$LOGS/arm-a" "$PIN_B6"
assert_not_red "arm A" "$LOGS/arm-a" "$PIN_B7"
assert_not_red "arm A" "$LOGS/arm-a" "$PIN_B8"
assert_not_red "arm A" "$LOGS/arm-a" "$PIN_U1"
assert_not_red "arm A" "$LOGS/arm-a" "$PIN_U2"
assert_not_red "arm A" "$LOGS/arm-a" "$PIN_U3"
assert_not_red "arm A" "$LOGS/arm-a" "$PIN_U4"
assert_not_red "arm A" "$LOGS/arm-a" "$PIN_O2_GET"
assert_not_red "arm A" "$LOGS/arm-a" "$PIN_O2_OBJ"
restore
[ "$(hash_of "$APP_JS")" = "$BEFORE_A" ] || fail "arm A restore failed — the file hash did not come back"

# --- ARM B: the real response stops exposing the hash (PIN B5) ---------------
BEFORE_B="$(hash_of "$APP_TS")"
python3 - "$APP_TS" <<'PY'
import sys

path = sys.argv[1]
src = open(path).read()
anchor = '    c.res.headers.set("access-control-expose-headers", CORS_EXPOSE_HEADERS);'
assert src.count(anchor) == 1, "ARM B: the post-next expose line is not unique"
replacement = '    // ARM B: the REAL response no longer exposes the header set (the preflight still does)'
open(path, "w").write(src.replace(anchor, replacement))
PY
[ $? -eq 0 ] || fail "ARM B: the injection did not apply"
grep -q 'ARM B: the REAL response no longer exposes' "$APP_TS" || fail "ARM B: the injection is not in $APP_TS"
AFTER_B="$(hash_of "$APP_TS")"
say "=== ARM B — the REAL response stops exposing the header set: a browser can no longer READ the hash ==="
say "  file:   $APP_TS"
say "  sha256: $BEFORE_B  (before)"
say "  sha256: $AFTER_B  (after injection)"
[ "$BEFORE_B" != "$AFTER_B" ] || fail "arm B hash unchanged — VOID probe"
run_tiers "ARM B" "$LOGS/arm-b" || true
grep -A18 -F "× $PIN_B5" "$LOGS/arm-b/full.log" | head -24 | redact | tee -a "$OUT" || true
assert_red "arm B" "$LOGS/arm-b" "$PIN_B5"
browser_file_summary "$LOGS/arm-b"
[ "$(chrome_count)" = "0" ] || fail "arm B left $(chrome_count) chrome processes behind — VOID"
# Anti-vacuity: the console pins and the OTHER cross-origin pins survive, so the arm
# isolates the EXPOSED HEADER rather than "CORS is off".
assert_not_red "arm B" "$LOGS/arm-b" "$PIN_B1"
assert_not_red "arm B" "$LOGS/arm-b" "$PIN_B2"
assert_not_red "arm B" "$LOGS/arm-b" "$PIN_B3"
assert_not_red "arm B" "$LOGS/arm-b" "$PIN_B4"
assert_not_red "arm B" "$LOGS/arm-b" "$PIN_B6"
assert_not_red "arm B" "$LOGS/arm-b" "$PIN_B7"
assert_not_red "arm B" "$LOGS/arm-b" "$PIN_B8"
assert_not_red "arm B" "$LOGS/arm-b" "$PIN_U1"
assert_not_red "arm B" "$LOGS/arm-b" "$PIN_U2"
assert_not_red "arm B" "$LOGS/arm-b" "$PIN_U3"
assert_not_red "arm B" "$LOGS/arm-b" "$PIN_U4"
assert_not_red "arm B" "$LOGS/arm-b" "$PIN_O1"
assert_not_red "arm B" "$LOGS/arm-b" "$PIN_R5"
# The NAMED collateral: the in-process twin of the same contract. Asserted RED on
# purpose, so the transcript proves it was observed rather than hoped for.
say "  EXPECTED COLLATERAL (named): the in-process twins of the SAME expose contract —"
pin_red "$LOGS/arm-b" "$PIN_O2_GET" || fail "arm B did NOT redden its named in-process twin $PIN_O2_GET — re-derive the arm"
pin_red "$LOGS/arm-b" "$PIN_O2_OBJ" || fail "arm B did NOT redden its named in-process twin $PIN_O2_OBJ — re-derive the arm"
say "    $PIN_O2_GET  -> RED (expected)"
say "    $PIN_O2_OBJ  -> RED (expected)"
restore
[ "$(hash_of "$APP_TS")" = "$BEFORE_B" ] || fail "arm B restore failed — the file hash did not come back"

# --- control AFTER: the restored tree must be GREEN again --------------------
say
say "=== CONTROL — the restored tree ==="
run_tiers "CONTROL 2" "$LOGS/control2" || true
grep -qE 'Test Files +[0-9]+ passed' "$LOGS/control2/full.log" \
  || fail "post-restore suite is not green — read $LOGS/control2/full.log"
say "  control GREEN: $(grep -E 'Test Files|Tests ' "$LOGS/control2/full.log" | tr '\n' ' ')"
browser_file_summary "$LOGS/control2"
say "  sha256: $(hash_of "$APP_JS")  (web/app.js back to its before hash)"
say "  sha256: $(hash_of "$APP_TS")  (src/server/app.ts back to its before hash)"
[ "$(chrome_count)" = "0" ] || fail "the post-restore control left $(chrome_count) chrome processes behind — VOID"

say
say "DIFFERENTIAL COMPLETE: arm A RED on PIN B3 (the Edit affordance removed) with B1/B2/B4-B8 GREEN; arm B RED on PIN B5 (the real response no longer exposes the header set) with the console pins B1-B3 and B4/B6 GREEN, and PIN O2 (both halves, the in-process twin of B5) RED as NAMED EXPECTED COLLATERAL. Both controls GREEN. Chrome processes after every run: 0. No VOID probe."
say "logs: $LOGS/{control,arm-a,arm-b,control2}/{cheap,full}.log — raw transcript: $OUT"
exit 0
