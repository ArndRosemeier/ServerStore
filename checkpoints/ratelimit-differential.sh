#!/usr/bin/env bash
#
# The writer's OWN differential for SLICE 14 — rate limiting on the public endpoint.
# Ledger rows 64/65.
#
# TWO arms, each aimed at a DIFFERENT MECHANISM, because one direction cannot tell
# "the window never rolls" from "the bucket table is unbounded":
#   ARM A  the WINDOW NEVER ROLLS — the reset comparison (`at >= existing.resetAt`) is
#          neutralised, so an expired bucket is treated as live forever.
#                       -> PIN R3 must go RED  (the "the window rolls" half)
#          file: src/server/ratelimit.ts
#   ARM B  the BUCKET CAP is REMOVED — the table grows without limit, while the limiter
#          itself still counts and refuses.
#                       -> PIN R6 must go RED  (the "bounded memory" half)
#          file: src/server/ratelimit.ts
#          The arm MUST leave PIN R2 GREEN: that is what isolates the BOUND rather than
#          "the limiter stopped working".
#
# The arms are SURGICAL and each asserts the pins that must SURVIVE:
#   ARM A leaves R1, R2, R4-R8 GREEN (a limiter that never rolls is still a limiter).
#   ARM B leaves R1, R2, R3, R4, R5, R7, R8 GREEN (only the cap assertion falls).
#
# The slice is COMMITTED before this runs (that is what makes `HEAD` the pristine copy).
# Every arm prints its file's sha256 before and after (an unchanged hash would be VOID),
# runs BOTH tiers directly while HOLDING THE SAME LOCK `scripts/gate.sh` takes (calling
# the gate here would make it refuse itself with exit 9 — VOID, not evidence), and the
# restore is `git checkout HEAD --` in an `EXIT INT TERM` trap. Per-arm logs go under
# .diff-harness/, so the green gate log is not clobbered.
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
OUT="$WORKTREE/checkpoints/ratelimit-differential.out"
LOGS="$WORKTREE/.diff-harness"
mkdir -p "$LOGS"
: > "$OUT"

APP="src/server/ratelimit.ts"

PIN_R1='PIN R1: under the limit, nothing changes — same status, same body, no Retry-After invented'
PIN_R2='PIN R2: the request after the limit is 429 with Retry-After and no side effect'
PIN_R2_GUARD='PIN R2: the refusal happens in FRONT of the key guard — an unkeyed call is 429, not 401'
PIN_R3='PIN R3: the window rolls — the same identity is served again and Retry-After never exceeds the window'
PIN_R4='PIN R4: identities are independent — CF-Connecting-IP, then the FIRST X-Forwarded-For hop'
PIN_R5='PIN R5: the exemptions are real — /healthz, the three UI assets and a preflight answer while the API identity is over its limit'
PIN_R6_CAP='PIN R6: many distinct identities stay at the cap while a flooding identity is STILL refused'
PIN_R6_DEFAULT='PIN R6: the DEFAULT cap bounds a flood, and an over-long identity cannot inflate the table'
PIN_R7_ZERO='PIN R7: SERVERSTORE_RATE_LIMIT=0 disables it completely'
PIN_R7_DEFAULT='PIN R7: the bare default is 600 per 60 s — the 600th passes and the 601st is refused'
PIN_R7_BOOT='PIN R7: a malformed value fails the BOOT loudly rather than defaulting'
PIN_R8_DOC='PIN R8: docs/API.md documents rate_limited/429, the env var, and the exemptions'
PIN_R8_STALE='PIN R8: the stale '"'"'no rate limit'"'"' sentences are gone'

# The anchors the arms rewrite. Both must be present EXACTLY once or the harness refuses.
ARM_A_ANCHOR='      const expired = existing !== undefined && at >= existing.resetAt;'
ARM_B_ANCHOR='      if (buckets.size >= maxBuckets) evictOldest();'

LOCKED=0
restore() {
  # Always, idempotently: an error path must not be able to skip cleanup.
  git checkout HEAD -- "$APP" >/dev/null 2>&1 || true
  if [ "$LOCKED" = "1" ]; then rm -rf "$LOCK_DIR"; fi
  echo "RESTORED: $APP back at HEAD; lock released" | tee -a "$OUT"
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
printf 'pid=%s\nstarted=%s\ntier=full\nrepo=%s\nharness=ratelimit-differential\n' \
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

# --- ARM A: the window never rolls (PIN R3) ----------------------------------
BEFORE_A="$(hash_of "$APP")"
python3 - "$APP" "$ARM_A_ANCHOR" <<'PY'
import sys

path, anchor = sys.argv[1], sys.argv[2]
src = open(path).read()
assert src.count(anchor) == 1, "ARM A: the reset comparison is not unique"
replacement = (
    "      const expired = false;"
    "  // ARM A: the reset comparison neutralised — the window never rolls"
)
open(path, "w").write(src.replace(anchor, replacement))
PY
[ $? -eq 0 ] || fail "ARM A: the injection did not apply"
grep -q 'ARM A: the reset comparison neutralised' "$APP" || fail "ARM A: the injection is not in $APP"
AFTER_A="$(hash_of "$APP")"
say "=== ARM A — the reset comparison neutralised: the WINDOW NEVER ROLLS ==="
say "  file:   $APP"
say "  sha256: $BEFORE_A  (before)"
say "  sha256: $AFTER_A  (after injection)"
[ "$BEFORE_A" != "$AFTER_A" ] || fail "arm A hash unchanged — VOID probe"
run_tiers "ARM A" "$LOGS/arm-a" || true
assert_red "arm A" "$LOGS/arm-a" "$PIN_R3"
# Anti-vacuity: the limiter still COUNTS and refuses inside the window, so this arm
# proves the window roll, not "the limiter is gone".
assert_not_red "arm A" "$LOGS/arm-a" "$PIN_R1"
assert_not_red "arm A" "$LOGS/arm-a" "$PIN_R2"
assert_not_red "arm A" "$LOGS/arm-a" "$PIN_R2_GUARD"
assert_not_red "arm A" "$LOGS/arm-a" "$PIN_R4"
assert_not_red "arm A" "$LOGS/arm-a" "$PIN_R5"
assert_not_red "arm A" "$LOGS/arm-a" "$PIN_R6_CAP"
assert_not_red "arm A" "$LOGS/arm-a" "$PIN_R6_DEFAULT"
assert_not_red "arm A" "$LOGS/arm-a" "$PIN_R7_ZERO"
assert_not_red "arm A" "$LOGS/arm-a" "$PIN_R7_DEFAULT"
assert_not_red "arm A" "$LOGS/arm-a" "$PIN_R7_BOOT"
assert_not_red "arm A" "$LOGS/arm-a" "$PIN_R8_DOC"
assert_not_red "arm A" "$LOGS/arm-a" "$PIN_R8_STALE"
restore
[ "$(hash_of "$APP")" = "$BEFORE_A" ] || fail "arm A restore failed — the file hash did not come back"

# --- ARM B: the bucket cap removed (PIN R6) ----------------------------------
BEFORE_B="$(hash_of "$APP")"
python3 - "$APP" "$ARM_B_ANCHOR" <<'PY'
import sys

path, anchor = sys.argv[1], sys.argv[2]
src = open(path).read()
assert src.count(anchor) == 1, "ARM B: the cap guard is not unique"
replacement = (
    "      if (false) evictOldest();"
    "  // ARM B: the bucket cap removed — the table grows without limit"
)
open(path, "w").write(src.replace(anchor, replacement))
PY
[ $? -eq 0 ] || fail "ARM B: the injection did not apply"
grep -q 'ARM B: the bucket cap removed' "$APP" || fail "ARM B: the injection is not in $APP"
AFTER_B="$(hash_of "$APP")"
say "=== ARM B — the bucket cap REMOVED: the table grows without limit ==="
say "  file:   $APP"
say "  sha256: $BEFORE_B  (before)"
say "  sha256: $AFTER_B  (after injection)"
[ "$BEFORE_B" != "$AFTER_B" ] || fail "arm B hash unchanged — VOID probe"
[ "$AFTER_A" != "$AFTER_B" ] || fail "the two arms produced the SAME hash — VOID probe"
run_tiers "ARM B" "$LOGS/arm-b" || true
assert_red "arm B" "$LOGS/arm-b" "$PIN_R6_CAP"
assert_red "arm B" "$LOGS/arm-b" "$PIN_R6_DEFAULT"
# Anti-vacuity: the LIMIT still works — the arm isolates the BOUND, not the limiter.
assert_not_red "arm B" "$LOGS/arm-b" "$PIN_R1"
assert_not_red "arm B" "$LOGS/arm-b" "$PIN_R2"
assert_not_red "arm B" "$LOGS/arm-b" "$PIN_R2_GUARD"
assert_not_red "arm B" "$LOGS/arm-b" "$PIN_R3"
assert_not_red "arm B" "$LOGS/arm-b" "$PIN_R4"
assert_not_red "arm B" "$LOGS/arm-b" "$PIN_R5"
assert_not_red "arm B" "$LOGS/arm-b" "$PIN_R7_ZERO"
assert_not_red "arm B" "$LOGS/arm-b" "$PIN_R7_DEFAULT"
assert_not_red "arm B" "$LOGS/arm-b" "$PIN_R7_BOOT"
assert_not_red "arm B" "$LOGS/arm-b" "$PIN_R8_DOC"
assert_not_red "arm B" "$LOGS/arm-b" "$PIN_R8_STALE"
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
say "DIFFERENTIAL COMPLETE: arm A RED on PIN R3 (the window never rolled); arm B RED on PIN R6 (the table grew past its cap) with R2 GREEN; both controls GREEN. No VOID probe."
say "NOTE both arms mutate the SAME file (src/server/ratelimit.ts) at DIFFERENT anchors, so their after-hashes differ."
say "logs: $LOGS/{control,arm-a,arm-b,control2}/{cheap,full}.log — raw transcript: $OUT"
exit 0
