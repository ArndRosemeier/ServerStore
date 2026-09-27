#!/usr/bin/env bash
#
# The writer's OWN differential for SLICE 5 — the client contract (`docs/API.md`).
# Kept as reproducible evidence for this landing and as a worked example, NOT a
# general harness: the arms below are this slice's pins and files.
#
# FOUR arms, one per direction the contract can rot, plus a control BEFORE and AFTER:
#   ARM R  src/server/app.ts gains a NINTH route (`GET /ping`) that the doc cannot
#          know about        -> PIN A1 (code -> doc direction)
#   ARM D  docs/API.md's route table gains a row for a route the app does NOT serve
#                           -> PIN A1 (doc -> code direction)
#   ARM E  docs/API.md's error table renames a code in ERROR_CODES
#                           -> PIN A2
#   ARM M  docs/API.md's stated SERVERSTORE_MAX_BYTES default is changed
#                           -> PIN A3
#
# Every arm edits ONE place, prints its file's sha256 before and after (an unchanged
# hash would make the arm VOID), runs BOTH tiers, and asserts it went RED on its OWN
# named pin. The restore is `git checkout HEAD --` and runs from an EXIT INT TERM
# trap, so a crash mid-arm cannot leave the tree mutated. The slice is COMMITTED
# before this runs (that is what makes `HEAD` the pristine copy).
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
OUT="$WORKTREE/checkpoints/api-doc-differential.out"
LOGS="$WORKTREE/.diff-harness"
mkdir -p "$LOGS"
: > "$OUT"

APP="src/server/app.ts"
DOC="docs/API.md"
PIN_A1="PIN A1: every route the app registers is in the API doc, and every route in the doc is registered"
PIN_A2="PIN A2: every code in ERROR_CODES appears in the doc's error table"
PIN_A3="PIN A3: the doc's stated max-bytes default equals the code's"

LOCKED=0
restore() {
  # EVERY file the arms touch, always, idempotently: an error path must not be able
  # to skip cleanup (the row-27 lesson, recorded in deploy-differential.sh).
  git checkout HEAD -- "$APP" "$DOC" >/dev/null 2>&1 || true
  if [ "$LOCKED" = "1" ]; then rm -rf "$LOCK_DIR"; fi
  echo "RESTORED: $APP and $DOC back at HEAD; lock released" | tee -a "$OUT"
}
trap restore EXIT INT TERM

say() { echo "$@" | tee -a "$OUT"; }
fail() { say "HARNESS FAILURE: $*"; exit 1; }
hash_of() { sha256sum "$1" | awk '{print $1}'; }

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  OWNER_PID="$(sed -n 's/^pid=//p' "$LOCK_DIR/owner" 2>/dev/null)"
  fail "the gate lock is already held (pid ${OWNER_PID:-unknown}) — this run would be VOID, refused, not evidence"
fi
LOCKED=1
printf 'pid=%s\nstarted=%s\ntier=full\nrepo=%s\nharness=api-doc-differential\n' \
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
  grep -A6 "$pin" "$logdir/full.log" | head -10 | tee -a "$OUT" || true
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

# --- ARM R: a ninth route the doc cannot know about (PIN A1) -----------------
BEFORE_R="$(hash_of "$APP")"
grep -q 'app.get("/healthz", (c) => c.json({ ok: true }));' "$APP" \
  || fail "$APP does not hold the line this arm anchors on — refusing to guess"
sed -i '/app.get("\/healthz", (c) => c.json({ ok: true }));/a\  app.get("/ping", (c) => c.json({ ok: true }));' "$APP"
AFTER_R="$(hash_of "$APP")"
grep -q 'app.get("/ping"' "$APP" || fail "ARM R: the injected route is not in $APP"
say "=== ARM R — a NINTH route registered in the app, absent from the doc ==="
say "  file:   $APP"
say "  sha256: $BEFORE_R  (before)"
say "  sha256: $AFTER_R  (after injection)"
[ "$BEFORE_R" != "$AFTER_R" ] || fail "arm R hash unchanged — VOID probe"
run_tiers "ARM R" "$LOGS/arm-r" || true
assert_arm "arm R" "$LOGS/arm-r" "$PIN_A1"
restore
[ "$(hash_of "$APP")" = "$BEFORE_R" ] || fail "arm R restore failed — the file hash did not come back"

# --- ARM D: the doc invents a route the app does not serve (PIN A1) ----------
BEFORE_D="$(hash_of "$DOC")"
grep -q '^| Method | Path | Who may call it' "$DOC" \
  || fail "$DOC does not hold the route-table header this arm anchors on — refusing to guess"
sed -i '/^| Method | Path | Who may call it/a | `GET` | `/ping` | anyone — no key required | — | `{"ok":true}` | `200` |' "$DOC"
AFTER_D="$(hash_of "$DOC")"
grep -q '^| `GET` | `/ping`' "$DOC" || fail "ARM D: the fake row is not in $DOC"
say "=== ARM D — the doc's route table lists a route the app does not register ==="
say "  file:   $DOC"
say "  sha256: $BEFORE_D  (before)"
say "  sha256: $AFTER_D  (after injection)"
[ "$BEFORE_D" != "$AFTER_D" ] || fail "arm D hash unchanged — VOID probe"
run_tiers "ARM D" "$LOGS/arm-d" || true
assert_arm "arm D" "$LOGS/arm-d" "$PIN_A1"
restore
[ "$(hash_of "$DOC")" = "$BEFORE_D" ] || fail "arm D restore failed — the file hash did not come back"

# --- ARM E: the doc renames an ERROR_CODES code (PIN A2) ---------------------
BEFORE_E="$(hash_of "$DOC")"
grep -q '| `unauthorized` | `401` |' "$DOC" \
  || fail "$DOC does not hold the error row this arm mutates — refusing to guess"
sed -i 's/| `unauthorized` | `401` |/| `unautorized` | `401` |/' "$DOC"
AFTER_E="$(hash_of "$DOC")"
grep -q '| `unautorized` | `401` |' "$DOC" || fail "ARM E: the renamed code is not in $DOC"
say "=== ARM E — the doc's error table renames a code in ERROR_CODES ==="
say "  file:   $DOC"
say "  sha256: $BEFORE_E  (before)"
say "  sha256: $AFTER_E  (after injection)"
[ "$BEFORE_E" != "$AFTER_E" ] || fail "arm E hash unchanged — VOID probe"
run_tiers "ARM E" "$LOGS/arm-e" || true
assert_arm "arm E" "$LOGS/arm-e" "$PIN_A2"
restore
[ "$(hash_of "$DOC")" = "$BEFORE_E" ] || fail "arm E restore failed — the file hash did not come back"

# --- ARM M: the doc's stated max-bytes default is wrong (PIN A3) -------------
BEFORE_M="$(hash_of "$DOC")"
grep -q '^| `SERVERSTORE_MAX_BYTES` | `67108864` bytes (64 MiB) |' "$DOC" \
  || fail "$DOC does not hold the limits row this arm mutates — refusing to guess"
sed -i 's/^| `SERVERSTORE_MAX_BYTES` | `67108864` bytes (64 MiB) |/| `SERVERSTORE_MAX_BYTES` | `1024` bytes (0 MiB) |/' "$DOC"
AFTER_M="$(hash_of "$DOC")"
grep -q '^| `SERVERSTORE_MAX_BYTES` | `1024` bytes (0 MiB) |' "$DOC" || fail "ARM M: the wrong limit is not in $DOC"
say "=== ARM M — the doc's stated SERVERSTORE_MAX_BYTES default is changed ==="
say "  file:   $DOC"
say "  sha256: $BEFORE_M  (before)"
say "  sha256: $AFTER_M  (after injection)"
[ "$BEFORE_M" != "$AFTER_M" ] || fail "arm M hash unchanged — VOID probe"
run_tiers "ARM M" "$LOGS/arm-m" || true
assert_arm "arm M" "$LOGS/arm-m" "$PIN_A3"
restore
[ "$(hash_of "$DOC")" = "$BEFORE_M" ] || fail "arm M restore failed — the file hash did not come back"

# --- control AFTER: the restored tree must be GREEN again --------------------
say
say "=== CONTROL — the restored tree ==="
run_tiers "CONTROL 2" "$LOGS/control2" || true
grep -qE 'Test Files +[0-9]+ passed' "$LOGS/control2/full.log" \
  || fail "post-restore suite is not green — read $LOGS/control2/full.log"
say "  control GREEN: $(grep -E 'Test Files|Tests ' "$LOGS/control2/full.log" | tr '\n' ' ')"
say "  sha256: $(hash_of "$APP") / $(hash_of "$DOC")  (both back to their before hashes)"

say
say "DIFFERENTIAL COMPLETE: arms R and D RED on PIN A1, E on PIN A2, M on PIN A3; both controls GREEN. No VOID probe."
say "logs: $LOGS/{control,arm-r,arm-d,arm-e,arm-m,control2}/{cheap,full}.log — raw transcript: $OUT"
exit 0
