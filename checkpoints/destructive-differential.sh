#!/usr/bin/env bash
#
# The writer's OWN differential for SLICE 16 (H1) — the destructive lifecycle. Ledger
# row 71.
#
# TWO arms, each aimed at a DIFFERENT mechanism, because the two FACTS that make this
# slice's naive implementation wrong are independent:
#   ARM A  the STORE-DELETE refusal is neutralised: the key-scope lookup is forced empty,
#          so the route deletes the store row while a `key_stores` row still names it.
#          With `PRAGMA foreign_keys = ON` the DELETE then fails the foreign key, so the
#          request is a 500 instead of the 409 that NAMES the blocking keys.
#                       -> PIN X5 must go RED   (the refusal is load-bearing, not decorative)
#          file: src/server/app.ts — the route boundary
#   ARM B  the SHARED-CONTENT check is removed from the single-object delete: the blob is
#          deleted unconditionally. Content-addressed storage means two names can share one
#          file, so the SURVIVOR's bytes vanish and its next read fails LOUDLY.
#                       -> PIN X7 must go RED while the ORDINARY delete still works (a lone
#                          object's blob MUST go — always-deleting is correct there, which is
#                          exactly why the sharing case needs its own assertion)
#          file: src/storage/kinds.ts — the kind handler's removal decision
#
# The arms are SURGICAL and each asserts the pins that must SURVIVE, because an arm that
# reddens everything proves only that it broke the tree: arm A leaves X6 (the confirm rule)
# and X4 (emptying) green; arm B leaves X5, X6, X8 and the objects.test.ts ordinary delete
# green.
#
# The slice is COMMITTED before this runs (that is what makes `HEAD` the pristine copy).
# Every arm prints its file's sha256 before and after (an unchanged hash would be VOID),
# runs BOTH tiers directly while HOLDING THE SAME LOCK `scripts/gate.sh` takes (calling the
# gate here would make it refuse itself with exit 9 — VOID, not evidence), and the restore
# is `git checkout HEAD --` in an `EXIT INT TERM` trap over EVERY file an arm touches.
# Per-arm logs go under .diff-harness/, so the green gate log is not clobbered.
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
OUT="$WORKTREE/checkpoints/destructive-differential.out"
LOGS="$WORKTREE/.diff-harness"
mkdir -p "$LOGS"
: > "$OUT"

APP="src/server/app.ts"
KINDS="src/storage/kinds.ts"

PIN_X4='PIN X4: emptying a store removes every entry and reclaims the bytes'
PIN_X5='PIN X5: a store with a key scoped to it cannot be deleted'
PIN_X6='PIN X6: the confirm token is server-side'
PIN_X7='PIN X7: deleting one object reclaims only UNSHARED content'
PIN_X8='PIN X8: authorization and the error surface are unchanged in kind'
ORDINARY='DELETE removes the row and reclaims the UNSHARED blob'

# The anchors the arms rewrite. Each must be present EXACTLY once or the harness refuses.
ARM_A_ANCHOR='const blockers = keysHoldingStore(ctx.db, store.name);'
ARM_A_REPLACEMENT='const blockers = keysHoldingStore(ctx.db, store.name).filter(() => false);'
ARM_B_ANCHOR='if (shared === undefined) await deleteBlob(dataRoot, store, row.sha256);'
ARM_B_REPLACEMENT='void shared; await deleteBlob(dataRoot, store, row.sha256);'

LOCKED=0
restore() {
  # EVERY file any arm touches, always, idempotently: an error path must not be able
  # to skip cleanup (the row-27 lesson).
  git checkout HEAD -- "$APP" "$KINDS" >/dev/null 2>&1 || true
  if [ "$LOCKED" = "1" ]; then rm -rf "$LOCK_DIR"; fi
  echo "RESTORED: $APP and $KINDS back at HEAD; lock released" | tee -a "$OUT"
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
printf 'pid=%s\nstarted=%s\ntier=full\nrepo=%s\nharness=destructive-differential\n' \
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
  grep -A10 -F "$pin" "$logdir/full.log" | head -18 | redact | tee -a "$OUT" || true
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

# --- ARM A: the store-delete key-scope refusal is neutralised (PIN X5) --------
BEFORE_A="$(hash_of "$APP")"
python3 - "$APP" "$ARM_A_ANCHOR" "$ARM_A_REPLACEMENT" <<'PY'
import sys

path, anchor, replacement = sys.argv[1], sys.argv[2], sys.argv[3]
src = open(path).read()
assert src.count(anchor) == 1, "ARM A: the blockers anchor is not unique"
open(path, "w").write(src.replace(anchor, replacement, 1))
PY
[ $? -eq 0 ] || fail "ARM A: the injection did not apply"
grep -q 'filter(() => false)' "$APP" || fail "ARM A: the injection is not in $APP"
AFTER_A="$(hash_of "$APP")"
say "=== ARM A — the store-delete key-scope refusal is neutralised (blockers forced empty) ==="
say "  file:   $APP"
say "  sha256: $BEFORE_A  (before)"
say "  sha256: $AFTER_A  (after injection)"
[ "$BEFORE_A" != "$AFTER_A" ] || fail "arm A hash unchanged — VOID probe"
run_tiers "ARM A" "$LOGS/arm-a" || true
assert_red "arm A" "$LOGS/arm-a" "$PIN_X5"
# The confirm rule and the empty-store path are DIFFERENT mechanisms and must survive.
assert_not_red "arm A" "$LOGS/arm-a" "$PIN_X6"
assert_not_red "arm A" "$LOGS/arm-a" "$PIN_X4"
assert_not_red "arm A" "$LOGS/arm-a" "$PIN_X8"
restore
[ "$(hash_of "$APP")" = "$BEFORE_A" ] || fail "arm A restore failed — the file hash did not come back"

# --- ARM B: the shared-content check is removed (PIN X7) ---------------------
BEFORE_B="$(hash_of "$KINDS")"
python3 - "$KINDS" "$ARM_B_ANCHOR" "$ARM_B_REPLACEMENT" <<'PY'
import sys

path, anchor, replacement = sys.argv[1], sys.argv[2], sys.argv[3]
src = open(path).read()
assert src.count(anchor) == 1, "ARM B: the shared-content anchor is not unique"
# The DEFECT: the row is deleted and the blob is ALWAYS removed, so a second row naming
# the same content address is left pointing at a file that no longer exists.
open(path, "w").write(src.replace(anchor, replacement, 1))
PY
[ $? -eq 0 ] || fail "ARM B: the injection did not apply"
grep -q 'void shared; await deleteBlob' "$KINDS" || fail "ARM B: the injection is not in $KINDS"
AFTER_B="$(hash_of "$KINDS")"
say "=== ARM B — the single-object delete always removes the blob (no sharing check) ==="
say "  file:   $KINDS"
say "  sha256: $BEFORE_B  (before)"
say "  sha256: $AFTER_B  (after injection)"
[ "$BEFORE_B" != "$AFTER_B" ] || fail "arm B hash unchanged — VOID probe"
run_tiers "ARM B" "$LOGS/arm-b" || true
assert_red "arm B" "$LOGS/arm-b" "$PIN_X7"
# The ORDINARY delete is a LONE object, so always deleting IS correct there: that test
# (and every route-level pin that does not share content) must stay GREEN. This is what
# separates "the sharing check is gone" from "delete is broken".
assert_not_red "arm B" "$LOGS/arm-b" "$ORDINARY"
assert_not_red "arm B" "$LOGS/arm-b" "$PIN_X5"
assert_not_red "arm B" "$LOGS/arm-b" "$PIN_X6"
assert_not_red "arm B" "$LOGS/arm-b" "$PIN_X8"
restore
[ "$(hash_of "$KINDS")" = "$BEFORE_B" ] || fail "arm B restore failed — the file hash did not come back"

# --- control AFTER: the restored tree must be GREEN again --------------------
say
say "=== CONTROL — the restored tree ==="
run_tiers "CONTROL 2" "$LOGS/control2" || true
grep -qE 'Test Files +[0-9]+ passed' "$LOGS/control2/full.log" \
  || fail "post-restore suite is not green — read $LOGS/control2/full.log"
say "  control GREEN: $(grep -E 'Test Files|Tests ' "$LOGS/control2/full.log" | tr '\n' ' ')"
say "  sha256: $(hash_of "$APP")  (app.ts, back to its before hash)"
say "  sha256: $(hash_of "$KINDS")  (kinds.ts, back to its before hash)"

say
say "DIFFERENTIAL COMPLETE: arm A RED on PIN X5 (the store-delete refusal removed, so the foreign key answers instead of a named 409) with the confirm rule, the empty-store path and the error surface GREEN; arm B RED on PIN X7 while the ORDINARY single-object delete stayed GREEN (always deleting a blob is correct for a lone object, which is exactly why the sharing case needs its own pin). Both controls GREEN. No VOID probe."
say "logs: $LOGS/{control,arm-a,arm-b,control2}/{cheap,full}.log — raw transcript: $OUT"
exit 0
