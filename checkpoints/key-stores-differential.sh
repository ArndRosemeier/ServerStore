#!/usr/bin/env bash
#
# The writer's OWN differential for SLICE 8 — a key's SCOPE (a SET of stores).
#
# TWO arms in OPPOSITE directions, each aimed at a DIFFERENT half of the slice, because
# one direction cannot tell "the rule is missing" from "the migration is asserted":
#   ARM A  `authorize` IGNORES the store set (the scope check can never refuse), so a
#          key scoped to [a,b] may reach c
#                       -> PIN G1 must go RED  (the defect measure for the AUTHORIZE half)
#          file: src/server/app.ts   — the one membership test
#   ARM B  the MIGRATION skips the legacy row (the INSERT into key_stores is dropped), so
#          a key written in the OLD single-store shape loses its scope
#                       -> PIN G6 must go RED  (the defect measure for the MIGRATION half)
#          file: src/core/db.ts      — the one legacy-scope migration
#
# Each arm is SURGICAL where it can be: arm A leaves the MINTING branch (`POST /keys`)
# alone, so G2/G3 stay green; arm B touches only the legacy migration, so G1/G2/G4/G5 stay
# green. The harness asserts that, because an arm that reddens everything proves only that
# it broke the tree. Arm A DOES also redden PIN 2 (tests/auth.test.ts) and G6 — both stand
# on the same membership predicate, which is honest redundancy rather than a defect, and it
# is recorded in docs/TESTING.md rather than hidden by a looser assertion.
#
# Every arm edits ONE anchored line, prints its file's sha256 before and after (an
# unchanged hash would make the arm VOID), runs BOTH tiers directly, and asserts the
# suite went RED on its own named pin. The restore is `git checkout HEAD --` and runs from
# an EXIT INT TERM trap, so a crash mid-arm cannot leave the tree mutated. The slice is
# COMMITTED before this runs (that is what makes `HEAD` the pristine copy): the arms below
# ran at c27b61c, which the pre-push rebase replayed as e4d12b4 — the code delta between
# the two (`git diff --stat c27b61c e4d12b4 -- src tests docs/API.md`) is EMPTY, so the
# recorded hashes and reds describe the tree that lands.
#
# LOCK: this harness takes the SAME lock `scripts/gate.sh` takes (derived from the git
# COMMON dir, so it is one lock across the main tree and every worktree) and holds it
# across every arm. That is why the tiers run DIRECTLY here instead of through `gate.sh`:
# calling the gate would make it refuse itself with exit 9 — VOID, not evidence. Per-arm
# logs go under .diff-harness/, so the green gate log is not clobbered.
#
# The harness runs IN THE WORKTREE (cd to its own directory's parent), so the tree it
# mutates and restores is this slice's, never the main checkout.

set -u
cd "$(dirname "$0")/.." || exit 1
WORKTREE="$(pwd)"

GIT_COMMON="$(git rev-parse --path-format=absolute --git-common-dir)"
REPO_ROOT="$(cd "$GIT_COMMON/.." && pwd)"
LOCK_DIR="$REPO_ROOT/.gate-lock"
OUT="$WORKTREE/checkpoints/key-stores-differential.out"
LOGS="$WORKTREE/.diff-harness"
mkdir -p "$LOGS"
: > "$OUT"

APP="src/server/app.ts"
DB="src/core/db.ts"
PIN_G1="PIN G1: a key scoped to"
PIN_G2="PIN G2: a scoped ADMIN key mints only inside its own set"
PIN_G3="PIN G3: POST /keys rejects an empty list"
PIN_G4="PIN G4: GET /whoami returns the caller's id"
PIN_G5="PIN G5: a master key"
PIN_G6="PIN G6: a key row written in the OLD single-store shape"

# The ONE anchored line each arm rewrites.
APP_ANCHOR='    if (!this.spansStores && !this.key.stores.includes(store)) {'
DB_ANCHOR="  \`INSERT INTO key_stores(key_id, store) SELECT id, store FROM access_keys WHERE store IS NOT NULL AND store <> '*'\`,"

LOCKED=0
restore() {
  # EVERY file the arms touch, always, idempotently: an error path must not be able
  # to skip cleanup (the row-27 lesson, recorded in deploy-differential.sh).
  git checkout HEAD -- "$APP" "$DB" >/dev/null 2>&1 || true
  if [ "$LOCKED" = "1" ]; then rm -rf "$LOCK_DIR"; fi
  echo "RESTORED: $APP and $DB back at HEAD; lock released" | tee -a "$OUT"
}
trap restore EXIT INT TERM

# Every line that reaches the transcript is scrubbed of key-shaped strings: a raw key
# belongs only in the mint response and the Authorization header (ledger row 21), never
# in a committed evidence file. A mint-failure assertion message can carry a 201 body.
redact() { sed -E 's/ssk_[A-Za-z0-9_-]+/ssk_<redacted>/g'; }
say() { echo "$@" | redact | tee -a "$OUT"; }
fail() { say "HARNESS FAILURE: $*"; exit 1; }
hash_of() { sha256sum "$1" | awk '{print $1}'; }

grep -qF "$APP_ANCHOR" "$APP" \
  || fail "$APP does not hold the authorize membership line this harness anchors on — refusing to guess"
grep -qF "$DB_ANCHOR" "$DB" \
  || fail "$DB does not hold the legacy key_stores INSERT this harness anchors on — refusing to guess"

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  OWNER_PID="$(sed -n 's/^pid=//p' "$LOCK_DIR/owner" 2>/dev/null)"
  fail "the gate lock is already held (pid ${OWNER_PID:-unknown}) — this run would be VOID, refused, not evidence"
fi
LOCKED=1
printf 'pid=%s\nstarted=%s\ntier=full\nrepo=%s\nharness=key-stores-differential\n' \
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
# must appear in the log, and the arm must NOT have reddened the pins we require green.
assert_red() {
  local label="$1" logdir="$2" pin="$3"
  [ -f "$logdir/full.log" ] || fail "$label: the suite never ran — read $logdir/cheap.log"
  local lines
  lines="$(grep -c "$pin" "$logdir/full.log" || true)"
  say "  named pin RED: $lines line(s) in $logdir/full.log"
  grep -A6 "$pin" "$logdir/full.log" | head -14 | redact | tee -a "$OUT" || true
  grep -q 'Test Files.*failed' "$logdir/full.log" || fail "$label: the suite did not report a failure"
  grep -q "$pin" "$logdir/full.log" || fail "$label went red but NOT on its named pin"
}

assert_not_red() {
  local label="$1" logdir="$2" pin="$3"
  if grep -F "× $pin" "$logdir/full.log" >/dev/null; then
    fail "$label reddened '$pin' as well — the injection is broader than the rule it proves"
  fi
}

# --- control FIRST: the committed tree must be GREEN -------------------------
say "=== CONTROL — the committed tree ($(git rev-parse --short HEAD)) ==="
run_tiers CONTROL "$LOGS/control" || true
if ! grep -qE 'Test Files +[0-9]+ passed' "$LOGS/control/full.log"; then
  fail "the CONTROL run did not pass — read $LOGS/control/full.log; the harness cannot attribute anything"
fi
say "  control GREEN: $(grep -E 'Test Files|Tests ' "$LOGS/control/full.log" | tr '\n' ' ')"

# --- ARM A: `authorize` IGNORES the store set (PIN G1) -----------------------
BEFORE="$(hash_of "$APP")"
python3 - "$APP" "$APP_ANCHOR" <<'PY'
import sys
path, anchor = sys.argv[1], sys.argv[2]
src = open(path).read()
assert src.count(anchor) == 1, "anchor is not unique"
# ARM A: the membership test can never refuse — a key scoped to [a,b] reaches c. This is
# the AUTHORIZE half of the seam, and it leaves the MINTING branch untouched on purpose.
arm = "    if (!this.spansStores && !this.key.stores.includes(store) && false) {  // ARM A: the store set is IGNORED"
src = src.replace(anchor, arm)
open(path, "w").write(src)
PY
[ $? -eq 0 ] || fail "ARM A: the injection did not apply"
grep -q 'ARM A: the store set is IGNORED' "$APP" || fail "ARM A: the injection is not in $APP"
AFTER_A="$(hash_of "$APP")"
say "=== ARM A — authorize IGNORES the store set (a key scoped to [a,b] may reach c) ==="
say "  file:   $APP"
say "  sha256: $BEFORE  (before)"
say "  sha256: $AFTER_A  (after injection)"
[ "$BEFORE" != "$AFTER_A" ] || fail "arm A hash unchanged — VOID probe"
run_tiers "ARM A" "$LOGS/arm-a" || true
assert_red "arm A" "$LOGS/arm-a" "$PIN_G1"
# The minting branch is NOT this arm: the scoped-admin refusals must still hold, so G2 and
# G3 stay green — that is the anti-vacuity direction ("arm A broke the tree" would red them
# too). TWO other pins DO fall and are EXPECTED, not a harness failure, because both stand
# on the very predicate this arm removes: PIN 2 in tests/auth.test.ts (the single-store
# case of the same membership test) and G6 (whose behavioral half asks the migrated legacy
# key to be REFUSED a store outside its scope). The slice-2 lesson cuts both ways: mutating
# a shared predicate reddens every pin that stands on it, so the claim this arm supports is
# narrow — G1 is the pin that catches "authorize ignores the set", and it does.
assert_not_red "arm A" "$LOGS/arm-a" "$PIN_G2"
assert_not_red "arm A" "$LOGS/arm-a" "$PIN_G3"
restore
[ "$(hash_of "$APP")" = "$BEFORE" ] || fail "arm A restore failed — the file hash did not come back"

# --- ARM B: the MIGRATION skips the legacy row (PIN G6) ----------------------
BEFORE_B="$(hash_of "$DB")"
python3 - "$DB" "$DB_ANCHOR" <<'PY'
import sys
path, anchor = sys.argv[1], sys.argv[2]
src = open(path).read()
assert src.count(anchor) == 1, "anchor is not unique"
# ARM B: the old single-store value is copied into scope_all (for '*') but the NAMED
# stores are never copied into key_stores, so a pre-existing key loses its scope. The
# DROP COLUMN still runs, so the schema is the new one — only the DATA is missing.
src = src.replace(anchor, "  // ARM B: the legacy key_stores row is NOT migrated")
open(path, "w").write(src)
PY
[ $? -eq 0 ] || fail "ARM B: the injection did not apply"
grep -q 'ARM B: the legacy key_stores row is NOT migrated' "$DB" || fail "ARM B: the injection is not in $DB"
AFTER_B="$(hash_of "$DB")"
say "=== ARM B — the MIGRATION skips the legacy row (a pre-existing key loses its scope) ==="
say "  file:   $DB"
say "  sha256: $BEFORE_B  (before)"
say "  sha256: $AFTER_B  (after injection)"
[ "$BEFORE_B" != "$AFTER_B" ] || fail "arm B hash unchanged — VOID probe"
[ "$AFTER_A" != "$AFTER_B" ] || fail "arms A and B produced the SAME hash — VOID probe"
run_tiers "ARM B" "$LOGS/arm-b" || true
assert_red "arm B" "$LOGS/arm-b" "$PIN_G6"
# Arm B is SURGICAL: the authorize membership test is untouched, so G1/G2 stay green and
# only the LEGACY-shape key is affected. G4/G5 use freshly minted keys and must survive.
assert_not_red "arm B" "$LOGS/arm-b" "$PIN_G1"
assert_not_red "arm B" "$LOGS/arm-b" "$PIN_G2"
assert_not_red "arm B" "$LOGS/arm-b" "$PIN_G4"
assert_not_red "arm B" "$LOGS/arm-b" "$PIN_G5"
restore
[ "$(hash_of "$DB")" = "$BEFORE_B" ] || fail "arm B restore failed — the file hash did not come back"

# --- control AFTER: the restored tree must be GREEN again --------------------
say
say "=== CONTROL — the restored tree ==="
run_tiers "CONTROL 2" "$LOGS/control2" || true
grep -qE 'Test Files +[0-9]+ passed' "$LOGS/control2/full.log" \
  || fail "post-restore suite is not green — read $LOGS/control2/full.log"
say "  control GREEN: $(grep -E 'Test Files|Tests ' "$LOGS/control2/full.log" | tr '\n' ' ')"
say "  sha256: $(hash_of "$APP") / $(hash_of "$DB")  (back to their before hashes)"

say
say "DIFFERENTIAL COMPLETE: arm A RED on PIN G1 (authorize); arm B RED on PIN G6 (migration); both controls GREEN. No VOID probe."
say "logs: $LOGS/{control,arm-a,arm-b,control2}/{cheap,full}.log — raw transcript: $OUT"
exit 0
