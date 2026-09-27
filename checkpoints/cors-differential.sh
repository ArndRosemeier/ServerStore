#!/usr/bin/env bash
#
# The writer's OWN differential for SLICE 12 (D1) — CORS for a browser on another
# origin. Ledger row 57.
#
# TWO arms, each aimed at a DIFFERENT half of the slice, because one direction cannot
# tell "the preflight never reaches the guard" from "no response may carry credentials":
#   ARM A  the CORS step is MOVED AFTER the key guard — the brief's own named defect.
#          A preflight then reaches the guard, which matches every path, and is
#          answered 401 with no allow-origin header.
#                       -> PIN O1 must go RED  (the "answered before the guard" half)
#          file: src/server/app.ts   — the ONE place the step is registered
#   ARM B  `Access-Control-Allow-Credentials: true` is sent on responses.
#                       -> PIN O4 must go RED  (the "never credentials" half)
#          file: src/server/app.ts   — the same seam, a different line
#
# The arms are SURGICAL and each asserts the pins that must SURVIVE, because an arm that
# reddens everything proves only that it broke the tree:
#   ARM A leaves O2 and O3's HEADER half GREEN (the CORS headers are still emitted for
#         normal requests, so "the preflight is not answered" is distinguishable from
#         "CORS is gone"), and its collateral is ASSERTED rather than hidden: O3's
#         PREFLIGHT half necessarily falls too, because that arm breaks every preflight.
#   ARM B leaves O1/O2/O3/O5 GREEN — the credential header is added on the way OUT and
#         cannot affect a preflight, which returns before that line.
#
# The slice is COMMITTED before this runs (that is what makes `HEAD` the pristine copy).
# Every arm prints its file's sha256 before and after (an unchanged hash would be VOID),
# runs BOTH tiers directly while HOLDING THE SAME LOCK `scripts/gate.sh` takes (calling
# the gate here would make it refuse itself with exit 9 — VOID, not evidence), and the
# restore is `git checkout HEAD --` in an `EXIT INT TERM` trap over EVERY file an arm
# touches — INCLUDING `web/`, so a future arm in this harness cannot leave the console
# mutated. Per-arm logs go under .diff-harness/, so the green gate log is not clobbered.
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
OUT="$WORKTREE/checkpoints/cors-differential.out"
LOGS="$WORKTREE/.diff-harness"
mkdir -p "$LOGS"
: > "$OUT"

APP="src/server/app.ts"

PIN_O1='PIN O1: an unkeyed preflight is 2xx, allows PATCH, and names `authorization` as a whole word'
PIN_O2='PIN O2: a cross-origin GET /stores with a valid key returns the real body plus Allow-Origin'
PIN_O3_HEADER='PIN O3: a listed origin is echoed with Vary: Origin; an unlisted one gets no allow-origin header'
PIN_O3_PREFLIGHT='PIN O3: a preflight from a listed origin is 204 echoing that origin; from an unlisted origin it is never authorised'
PIN_O4='PIN O4: no response of any kind carries Allow-Credentials or a Set-Cookie'
PIN_O5='PIN O5: a request with no Origin is unchanged and adds no allow-origin header'

# The anchors the arms rewrite. Both must be present EXACTLY once or the harness refuses.
#
# ARM A's block is delimited by its OWN first and last lines, NOT by "everything up to
# `app.get("/healthz")`": `const guard` is declared BETWEEN the CORS step and that route
# (app.ts: the step is registered before the declaration, which is before `app.use("*",
# guard)`), so an anchor on the healthz route sweeps the declaration into the moved
# block and the arm fails the TYPECHECK (`guard` used before declaration) instead of
# reddening the pin — a harness bug the FIRST run found and this fix removes.
CORS_START='  /**
   * CORS — registered BEFORE the key guard'
CORS_TAIL='    c.res.headers.set("access-control-expose-headers", CORS_EXPOSE_HEADERS);
  });'
GUARD_LINE='  app.use("*", guard);'
ARM_B_ANCHOR='    c.res.headers.set("access-control-expose-headers", CORS_EXPOSE_HEADERS);'

LOCKED=0
restore() {
  # EVERY file any arm touches, always, idempotently: an error path must not be able
  # to skip cleanup (the row-27 lesson). `web/` is included though neither current arm
  # mutates it — the console exists now, and a restore that knows only today's file is
  # the bug deploy-differential.sh already paid for.
  git checkout HEAD -- "$APP" web >/dev/null 2>&1 || true
  if [ "$LOCKED" = "1" ]; then rm -rf "$LOCK_DIR"; fi
  echo "RESTORED: $APP and web/ back at HEAD; lock released" | tee -a "$OUT"
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
printf 'pid=%s\nstarted=%s\ntier=full\nrepo=%s\nharness=cors-differential\n' \
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

# --- ARM A: the CORS step is MOVED AFTER the key guard (PIN O1) --------------
BEFORE_A="$(hash_of "$APP")"
python3 - "$APP" "$CORS_START" "$CORS_TAIL" "$GUARD_LINE" <<'PY'
import sys

path, start_anchor, tail_anchor, guard_line = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
src = open(path).read()
assert src.count(start_anchor) == 1, "ARM A: the CORS block start anchor is not unique"
assert src.count(tail_anchor) == 1, "ARM A: the CORS block tail anchor is not unique"
start = src.index(start_anchor)
tail = src.index(tail_anchor, start) + len(tail_anchor)
block = src[start:tail]
assert 'access-control-allow-methods' in block, "ARM A: the extracted block is not the CORS step"

# ARM A: remove the CORS step from BEFORE the guard and re-register it AFTER the guard.
# That is the brief's named defect verbatim: a preflight then reaches the guard, which
# matches EVERY path, and is answered 401 with no allow-origin header.
without = src[:start].rstrip("\n") + "\n\n" + src[tail:].lstrip("\n")
assert without.count(guard_line) == 1, "ARM A: the guard registration is not unique"
at = without.index(guard_line) + len(guard_line)
moved = without[:at] + "\n\n" + block + without[at:]
open(path, "w").write(moved)
PY
[ $? -eq 0 ] || fail "ARM A: the injection did not apply"
AFTER_A="$(hash_of "$APP")"
say "=== ARM A — the CORS step is registered AFTER the key guard (the preflight 401s) ==="
say "  file:   $APP"
say "  sha256: $BEFORE_A  (before)"
say "  sha256: $AFTER_A  (after injection)"
[ "$BEFORE_A" != "$AFTER_A" ] || fail "arm A hash unchanged — VOID probe"
run_tiers "ARM A" "$LOGS/arm-a" || true
assert_red "arm A" "$LOGS/arm-a" "$PIN_O1"
# Anti-vacuity: CORS is still emitted for NORMAL requests, so this arm proves the
# ORDER (preflight before the guard), not "CORS was deleted".
assert_not_red "arm A" "$LOGS/arm-a" "$PIN_O2"
assert_not_red "arm A" "$LOGS/arm-a" "$PIN_O3_HEADER"
# EXPECTED COLLATERAL, asserted rather than left implicit: moving the step after the
# guard breaks EVERY preflight, so O3's preflight half falls with O1. That is the
# defect, not a second one — the surviving O2 and O3-header pins are the direction
# that shows CORS itself is intact.
assert_red "arm A (expected collateral)" "$LOGS/arm-a" "$PIN_O3_PREFLIGHT"
restore
[ "$(hash_of "$APP")" = "$BEFORE_A" ] || fail "arm A restore failed — the file hash did not come back"

# --- ARM B: responses send Allow-Credentials: true (PIN O4) ------------------
BEFORE_B="$(hash_of "$APP")"
python3 - "$APP" "$ARM_B_ANCHOR" <<'PY'
import sys

path, anchor = sys.argv[1], sys.argv[2]
src = open(path).read()
assert src.count(anchor) == 1, "ARM B: the exposed-headers line is not unique"
arm = anchor + '\n    c.res.headers.set("access-control-allow-credentials", "true");  // ARM B: credentials ARE allowed'
open(path, "w").write(src.replace(anchor, arm))
PY
[ $? -eq 0 ] || fail "ARM B: the injection did not apply"
grep -q 'ARM B: credentials ARE allowed' "$APP" || fail "ARM B: the injection is not in $APP"
AFTER_B="$(hash_of "$APP")"
say "=== ARM B — EVERY response sends Access-Control-Allow-Credentials: true ==="
say "  file:   $APP"
say "  sha256: $BEFORE_B  (before)"
say "  sha256: $AFTER_B  (after injection)"
[ "$BEFORE_B" != "$AFTER_B" ] || fail "arm B hash unchanged — VOID probe"
[ "$AFTER_A" != "$AFTER_B" ] || fail "the two arms produced the SAME hash — VOID probe"
run_tiers "ARM B" "$LOGS/arm-b" || true
assert_red "arm B" "$LOGS/arm-b" "$PIN_O4"
# Anti-vacuity: the credential line sits on the way OUT, so the preflight (which returns
# earlier) is untouched and the allowlist behaviour is untouched.
assert_not_red "arm B" "$LOGS/arm-b" "$PIN_O1"
assert_not_red "arm B" "$LOGS/arm-b" "$PIN_O2"
assert_not_red "arm B" "$LOGS/arm-b" "$PIN_O3_HEADER"
assert_not_red "arm B" "$LOGS/arm-b" "$PIN_O3_PREFLIGHT"
assert_not_red "arm B" "$LOGS/arm-b" "$PIN_O5"
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
say "DIFFERENTIAL COMPLETE: arm A RED on PIN O1 (the CORS step sat AFTER the key guard, so the preflight 401d); arm B RED on PIN O4 (a response sent Allow-Credentials: true); both controls GREEN. No VOID probe."
say "NOTE arm A's expected collateral, asserted above: O3's PREFLIGHT half falls with O1 (any arm that breaks preflights reddens every pin about one); O2 and O3's header half SURVIVE, which is what shows CORS itself is intact."
say "NOTE both arms mutate the SAME file (src/server/app.ts) at DIFFERENT anchors, so their after-hashes differ."
say "logs: $LOGS/{control,arm-a,arm-b,control2}/{cheap,full}.log — raw transcript: $OUT"
exit 0
