#!/usr/bin/env bash
#
# The writer's OWN differential for SLICE 9 — the key LIFECYCLE.
#
# TWO arms in OPPOSITE directions, each aimed at a DIFFERENT half of the slice, because
# one direction cannot tell "the listing leaks" from "the revoke boundary is missing":
#   ARM A  `GET /keys` INCLUDES THE HASH (a `hash` field is added to every entry), so the
#          inventory carries key material
#                       -> PIN L1 must go RED  (the "no key material" half)
#          file: src/server/app.ts   — the one listing projection
#   ARM B  the REVOKE SCOPE RULES are ignored (`if (… && false)`), so a store-scoped
#          admin may revoke a key outside its own scope and may revoke a master key
#                       -> PIN L4 must go RED  (the "who may revoke what" half)
#          file: src/server/app.ts   — the one revoke boundary
#
# Each arm is SURGICAL: arm A touches only the listing projection and leaves the revoke
# boundary alone; arm B touches only the revoke boundary and leaves the listing
# projection alone. The harness asserts the pins that must SURVIVE, because an arm that
# reddens everything proves only that it broke the tree.
#
# Every arm edits ONE anchored line, prints its file's sha256 before and after (an
# unchanged hash would make the arm VOID), runs BOTH tiers directly, and asserts the
# suite went RED on its own named pin. The restore is `git checkout HEAD --` and runs
# from an EXIT INT TERM trap, so a crash mid-arm cannot leave the tree mutated. The slice
# is COMMITTED before this runs (that is what makes `HEAD` the pristine copy): the code
# tip is 534189c, and the docs commit carrying this harness and the recorded numbers is
# its child.
#
# LOCK: this harness takes the SAME lock `scripts/gate.sh` takes (derived from the git
# COMMON dir, so it is one lock across the main tree and every worktree) and holds it
# across every arm. That is why the tiers run DIRECTLY here instead of through `gate.sh`:
# calling the gate would make it refuse itself with exit 9 — VOID, not evidence. Per-arm
# logs go under .diff-harness/, so the green gate log is not clobbered.
#
# The harness runs IN THE WORKTREE (cd to its own directory's parent), so the tree it
# mutates and restores is this slice's, never the main checkout.
#
# NEVER PRINT A REAL KEY: every line that reaches the transcript is scrubbed of
# `ssk_…`-shaped strings (ledger row 21) — a failing `not.toContain(raw)` assertion
# would otherwise echo the fixture's raw key into a committed evidence file.

set -u
cd "$(dirname "$0")/.." || exit 1
WORKTREE="$(pwd)"

GIT_COMMON="$(git rev-parse --path-format=absolute --git-common-dir)"
REPO_ROOT="$(cd "$GIT_COMMON/.." && pwd)"
LOCK_DIR="$REPO_ROOT/.gate-lock"
OUT="$WORKTREE/checkpoints/key-lifecycle-differential.out"
LOGS="$WORKTREE/.diff-harness"
mkdir -p "$LOGS"
: > "$OUT"

APP="src/server/app.ts"
PIN_L1="PIN L1: GET /keys is admin-only and returns NO key material"
PIN_L2="PIN L2: a scoped admin lists only the keys inside its own stores"
PIN_L3="PIN L3: a revoked key is refused on the NEXT request"
PIN_L4="PIN L4: a scoped admin cannot revoke outside its own scope"
PIN_L5="PIN L5: revoke is idempotent"
PIN_L6="PIN L6: an unknown key id is 404"

# The ONE anchored line each arm rewrites (both live in src/server/app.ts).
APP_PREFIX_ANCHOR='        prefix: key.prefix,'
APP_REVOKE_ANCHOR='    if (target.id !== auth.key.id && !auth.spansStores) {'

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

grep -qF "$APP_PREFIX_ANCHOR" "$APP" \
  || fail "$APP does not hold the listing projection line this harness anchors on — refusing to guess"
grep -qF "$APP_REVOKE_ANCHOR" "$APP" \
  || fail "$APP does not hold the revoke scope line this harness anchors on — refusing to guess"

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  OWNER_PID="$(sed -n 's/^pid=//p' "$LOCK_DIR/owner" 2>/dev/null)"
  fail "the gate lock is already held (pid ${OWNER_PID:-unknown}) — this run would be VOID, refused, not evidence"
fi
LOCKED=1
printf 'pid=%s\nstarted=%s\ntier=full\nrepo=%s\nharness=key-lifecycle-differential\n' \
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
# appear in the log. The arm is SURGICAL, so the log MUST NOT carry a `× PIN Lx` test
# title for any OTHER pin (a broader injection would prove only that it broke the tree).
assert_red() {
  local label="$1" logdir="$2" pin="$3"
  [ -f "$logdir/full.log" ] || fail "$label: the suite never ran — read $logdir/cheap.log"
  # An arm that also fails the TYPECHECK proves "the tree is broken", not "the pin sees
  # the rule": the injection must be surgical enough to compile.
  if grep -qE 'error TS' "$logdir/cheap.log"; then
    fail "$label: the injection ALSO broke the typecheck — the arm is not attributable: $(grep -m1 -E 'error TS' "$logdir/cheap.log")"
  fi
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

# --- ARM A: the LISTING carries key material (PIN L1) ------------------------
BEFORE="$(hash_of "$APP")"
python3 - "$APP" "$APP_PREFIX_ANCHOR" <<'PY'
import sys
path, anchor = sys.argv[1], sys.argv[2]
src = open(path).read()
assert src.count(anchor) == 1, "anchor is not unique"
# ARM A: every inventory entry gains the row's stored hash — the exact leak PIN L1
# exists to refuse. This is the LISTING half of the seam, and it leaves the REVOKE
# boundary untouched on purpose.
arm = (
    "        prefix: key.prefix,\n"
    "        hash: (ctx.db.prepare(\"SELECT key_hash FROM access_keys WHERE id = ?\").get(key.id) "
    "as { key_hash: string }).key_hash,  // ARM A: the listing leaks the hash"
)
src = src.replace(anchor, arm)
open(path, "w").write(src)
PY
[ $? -eq 0 ] || fail "ARM A: the injection did not apply"
grep -q 'ARM A: the listing leaks the hash' "$APP" || fail "ARM A: the injection is not in $APP"
AFTER_A="$(hash_of "$APP")"
say "=== ARM A — GET /keys INCLUDES THE HASH (the inventory carries key material) ==="
say "  file:   $APP"
say "  sha256: $BEFORE  (before)"
say "  sha256: $AFTER_A  (after injection)"
[ "$BEFORE" != "$AFTER_A" ] || fail "arm A hash unchanged — VOID probe"
run_tiers "ARM A" "$LOGS/arm-a" || true
assert_red "arm A" "$LOGS/arm-a" "$PIN_L1"
# The revoke half is NOT this arm, so L2-L6 must survive — that is the anti-vacuity
# direction ("arm A broke the tree" would red them too).
assert_not_red "arm A" "$LOGS/arm-a" "$PIN_L2"
assert_not_red "arm A" "$LOGS/arm-a" "$PIN_L3"
assert_not_red "arm A" "$LOGS/arm-a" "$PIN_L4"
assert_not_red "arm A" "$LOGS/arm-a" "$PIN_L5"
assert_not_red "arm A" "$LOGS/arm-a" "$PIN_L6"
restore
[ "$(hash_of "$APP")" = "$BEFORE" ] || fail "arm A restore failed — the file hash did not come back"

# --- ARM B: the REVOKE scope rules are ignored (PIN L4) ----------------------
python3 - "$APP" "$APP_REVOKE_ANCHOR" <<'PY'
import sys
path, anchor = sys.argv[1], sys.argv[2]
src = open(path).read()
assert src.count(anchor) == 1, "anchor is not unique"
# ARM B: the revoke boundary can never refuse, so a store-scoped admin may revoke a key
# outside its own scope AND a master key. `false as boolean` (rather than a literal
# `&& false`) keeps the injected condition typecheck-CLEAN: a literal collapses `target`'s
# null-narrowing and turns the arm into a typecheck failure, which would prove "the tree
# is broken" rather than "L4 catches the missing boundary". The arm's FIRST draft did
# exactly that (`&& false` → TS18047 on three lines) and is recorded in docs/TESTING.md
# rather than hidden.
arm = "    if ((false as boolean)) {  // ARM B: the revoke scope rules are IGNORED"
src = src.replace(anchor, arm)
open(path, "w").write(src)
PY
[ $? -eq 0 ] || fail "ARM B: the injection did not apply"
grep -q 'ARM B: the revoke scope rules are IGNORED' "$APP" || fail "ARM B: the injection is not in $APP"
AFTER_B="$(hash_of "$APP")"
say "=== ARM B — the REVOKE scope rules are IGNORED (a scoped admin may revoke anything) ==="
say "  file:   $APP"
say "  sha256: $BEFORE  (before)"
say "  sha256: $AFTER_B  (after injection)"
[ "$BEFORE" != "$AFTER_B" ] || fail "arm B hash unchanged — VOID probe"
[ "$AFTER_A" != "$AFTER_B" ] || fail "the two arms produced the SAME hash — VOID probe"
run_tiers "ARM B" "$LOGS/arm-b" || true
assert_red "arm B" "$LOGS/arm-b" "$PIN_L4"
# Arm B is SURGICAL: the listing projection is untouched, so L1/L2 survive; the revoke
# mechanics it does not remove (idempotency, 404, self-revocation) survive too.
assert_not_red "arm B" "$LOGS/arm-b" "$PIN_L1"
assert_not_red "arm B" "$LOGS/arm-b" "$PIN_L2"
assert_not_red "arm B" "$LOGS/arm-b" "$PIN_L3"
assert_not_red "arm B" "$LOGS/arm-b" "$PIN_L5"
assert_not_red "arm B" "$LOGS/arm-b" "$PIN_L6"
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
say "DIFFERENTIAL COMPLETE: arm A RED on PIN L1 (the listing leaked the hash); arm B RED on PIN L4 (the revoke scope rules were ignored); both controls GREEN. No VOID probe."
say "logs: $LOGS/{control,arm-a,arm-b,control2}/{cheap,full}.log — raw transcript: $OUT"
exit 0
