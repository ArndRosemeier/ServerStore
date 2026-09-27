#!/usr/bin/env bash
#
# The writer's OWN differential for SLICE 4 — the process contract. Kept as
# reproducible evidence for this landing and as a worked example, NOT a general
# harness: the arm below is this slice's pin and file.
#
# ONE arm: make the entrypoint bind 0.0.0.0 instead of 127.0.0.1 (the exact defect
# GUARD g1 exists for) and watch PIN D2 go RED. The file's sha256 is printed before
# and after — an unchanged hash would make the probe VOID. The restore runs from HEAD
# in an EXIT INT TERM trap, so a crash mid-arm cannot leave the host mutated.
#
# The slice is COMMITTED before this runs: restoration is `git checkout HEAD --`.
#
# LOCK: this harness takes the SAME lock `scripts/gate.sh` takes (derived from the git
# COMMON dir, so it is one lock across the main tree and every worktree) and holds it
# across both tiers. That is why the tiers are run DIRECTLY here instead of through
# `gate.sh`: calling the gate would make it refuse itself with exit 9 — VOID, not
# evidence. GATE_LOG_DIR is redirected per arm so a green log is not clobbered.
#
# The harness runs IN THE WORKTREE (cd to its own directory's parent), so the tree it
# mutates and restores is this slice's, never the main checkout.

set -u
cd "$(dirname "$0")/.." || exit 1
WORKTREE="$(pwd)"

GIT_COMMON="$(git rev-parse --path-format=absolute --git-common-dir)"
REPO_ROOT="$(cd "$GIT_COMMON/.." && pwd)"
LOCK_DIR="$REPO_ROOT/.gate-lock"
OUT="$WORKTREE/checkpoints/deploy-differential.out"
LOGS="$WORKTREE/.diff-harness"
mkdir -p "$LOGS"
: > "$OUT"

TARGET="src/server/config.ts"
UNIT="deploy/serverstore.service"
PIN="PIN D2: the entrypoint listens on 127.0.0.1 and NOT on 0.0.0.0"

LOCKED=0
# NOT guarded by a "already restored" flag. The first version of this harness WAS, and
# the SECOND explicit `restore` (the one for the unit file) returned early and left the
# unit mutated. `git checkout HEAD --` is idempotent, so restoring is always safe and is
# always done — the whole point is that no error path can skip it.
restore() {
  # EVERY file the arms touch, not just the first.
  git checkout HEAD -- "$TARGET" "$UNIT" >/dev/null 2>&1 || true
  if [ "$LOCKED" = "1" ]; then rm -rf "$LOCK_DIR"; fi
  echo "RESTORED: $TARGET and $UNIT back at HEAD; lock released" | tee -a "$OUT"
}
trap restore EXIT INT TERM

say() { echo "$@" | tee -a "$OUT"; }
fail() { say "HARNESS FAILURE: $*"; exit 1; }
hash_of() { sha256sum "$1" | awk '{print $1}'; }

# --- the lock, exactly as gate.sh derives and takes it ------------------------
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  OWNER_PID="$(sed -n 's/^pid=//p' "$LOCK_DIR/owner" 2>/dev/null)"
  fail "the gate lock is already held (pid ${OWNER_PID:-unknown}) — this run would be VOID, refused, not evidence"
fi
LOCKED=1
printf 'pid=%s\nstarted=%s\ntier=full\nrepo=%s\nharness=deploy-differential\n' \
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

# --- the control FIRST: the committed tree must be GREEN ---------------------
say "=== CONTROL — the committed tree ($(git rev-parse --short HEAD)) ==="
run_tiers CONTROL "$LOGS/control" || true
if ! grep -qE 'Test Files +[0-9]+ passed' "$LOGS/control/full.log"; then
  fail "the CONTROL run did not pass — read $LOGS/control/full.log; the harness cannot attribute anything"
fi
say "  control GREEN: $(grep -E 'Test Files|Tests ' "$LOGS/control/full.log" | tr '\n' ' ')"

# --- arm D2: bind 0.0.0.0 (the defect GUARD g1 forbids) ----------------------
BEFORE="$(hash_of "$TARGET")"
if ! grep -q 'export const DEFAULT_HOST = "127.0.0.1";' "$TARGET"; then
  fail "$TARGET does not hold the line this arm mutates — refusing to guess"
fi
sed -i 's/export const DEFAULT_HOST = "127.0.0.1";/export const DEFAULT_HOST = "0.0.0.0";/' "$TARGET"
AFTER="$(hash_of "$TARGET")"
say "=== ARM D2 — DEFAULT_HOST 127.0.0.1 -> 0.0.0.0 ==="
say "  file:   $TARGET"
say "  sha256: $BEFORE  (before)"
say "  sha256: $AFTER  (after injection)"
[ "$BEFORE" != "$AFTER" ] || fail "arm D2 hash unchanged — VOID probe"

run_tiers "ARM D2" "$LOGS/arm" || true
[ -f "$LOGS/arm/full.log" ] || fail "the ARM suite never ran (the cheap tier failed?) — read $LOGS/arm/cheap.log"
PIN_LINES="$(grep -c "$PIN" "$LOGS/arm/full.log" || true)"
say "  named pin RED: $PIN_LINES line(s) in $LOGS/arm/full.log"
grep -A6 "$PIN" "$LOGS/arm/full.log" | head -10 | tee -a "$OUT" || true

restore
[ "$(hash_of "$TARGET")" = "$BEFORE" ] || fail "restore failed — the file hash did not come back"
grep -q "$PIN" "$LOGS/arm/full.log" || fail "arm D2 went red but NOT on the named pin"

# --- arm D6: the unit loses the comment that says the host is NOT configurable ---
# The realistic regression, not a synthetic one: a regenerated or tidied unit that
# keeps the directives but drops the reasoning leaves the next editor with no
# statement that the bind host is deliberately absent. PIN D6 asserts that statement
# is there, so it must be able to go RED on its absence.
PIN6="PIN D6: the unit file does not make the bind host configurable"
BEFORE6="$(hash_of "$UNIT")"
sed -i '/DEFAULT_HOST = "127\.0\.0\.1"/d' "$UNIT"
AFTER6="$(hash_of "$UNIT")"
say "=== ARM D6 — the unit's no-configurable-host comment removed ==="
say "  file:   $UNIT"
say "  sha256: $BEFORE6  (before)"
say "  sha256: $AFTER6  (after injection)"
[ "$BEFORE6" != "$AFTER6" ] || fail "arm D6 hash unchanged — VOID probe"

run_tiers "ARM D6" "$LOGS/arm6" || true
[ -f "$LOGS/arm6/full.log" ] || fail "the ARM D6 suite never ran — read $LOGS/arm6/cheap.log"
PIN6_LINES="$(grep -c "$PIN6" "$LOGS/arm6/full.log" || true)"
say "  named pin RED: $PIN6_LINES line(s) in $LOGS/arm6/full.log"
grep -A6 "$PIN6" "$LOGS/arm6/full.log" | head -10 | tee -a "$OUT" || true

restore
[ "$(hash_of "$UNIT")" = "$BEFORE6" ] || fail "restore failed — the unit hash did not come back"
grep -q "$PIN6" "$LOGS/arm6/full.log" || fail "arm D6 went red but NOT on the named pin"

# --- control AFTER: the restored tree must be GREEN again --------------------
say
say "=== CONTROL — the restored tree ==="
mkdir -p "$LOGS/control2"
( cd "$WORKTREE" && bash -c 'pnpm run typecheck' ) >"$LOGS/control2/cheap.log" 2>&1
C2_CHEAP=$?
( cd "$WORKTREE" && bash -c 'pnpm test' ) >"$LOGS/control2/full.log" 2>&1
C2_FULL=$?
[ "$C2_CHEAP" = "0" ] || fail "post-restore cheap tier is not green (exit $C2_CHEAP)"
[ "$C2_FULL" = "0" ] || fail "post-restore suite is not green (exit $C2_FULL) — the injection was not the only difference"
say "  control GREEN: $(grep -E 'Test Files|Tests ' "$LOGS/control2/full.log" | tr '\n' ' ')"
say "  sha256: $(hash_of "$TARGET") / $(hash_of "$UNIT")  (both back to their before hashes)"

say
say "DIFFERENTIAL COMPLETE: arm D2 and arm D6 each RED on their OWN named pin, both controls GREEN. No VOID probe."
say "logs: $LOGS/{control,arm,arm6,control2}/{cheap,full}.log — raw transcript: $OUT"
exit 0
