#!/usr/bin/env bash
#
# The writer's OWN differential for SLICE 11 (C2) — EDITING a key in place.
#
# TWO arms, each aimed at a DIFFERENT half of the slice, because one direction cannot
# tell "an edit changed the credential" from "a revoked key came back to life":
#   ARM A  `PATCH /keys/:id` RE-MINTS the key instead of editing in place: the row's
#          `key_hash` is replaced with the hash of a freshly generated raw key
#                       -> PIN E6 must go RED  (the "the value never changes" half)
#          file: src/core/keys.ts   — the ONE edit seam, beside `mintKey`
#   ARM B  the REVOKED-KEY refusal is removed (`if ((false as boolean)) {`), so a key
#          that was revoked can be edited — and therefore effectively revived
#                       -> PIN E3 must go RED  (the "revocation is terminal" half)
#          file: src/server/app.ts  — the ONE route that decides it
#
# Each arm is SURGICAL: arm A touches only `editKey`'s transaction and leaves the route's
# authorization alone; arm B touches only the revoked refusal and leaves the edit seam
# alone. The harness asserts the pins that must SURVIVE, because an arm that reddens
# everything proves only that it broke the tree.
#
# ARM A's COLLATERAL IS EXPECTED AND RECORDED, not hidden: every pin that authenticates
# with the SAME raw key after an edit (E1's and E2's final behavioural assertions)
# necessarily falls too — that is precisely what "the value changed" MEANS, and the
# surviving E3/E4/E5/E7/E8 are the anti-vacuity direction. The brief's requirement is
# "E6 must go RED"; it is not "only E6".
#
# Every arm edits ONE anchored line, prints its file's sha256 before and after (an
# unchanged hash would make the arm VOID), runs BOTH tiers directly, and asserts the
# suite went RED on its own named pin. The restore is `git checkout HEAD --` over every
# file any arm touches — INCLUDING `web/`, which exists now (ledger row 49) and which a
# future arm in this harness may mutate — and it runs from an EXIT INT TERM trap, so a
# crash mid-arm cannot leave the tree mutated. The slice is COMMITTED before this runs
# (that is what makes `HEAD` the pristine copy).
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
OUT="$WORKTREE/checkpoints/key-edit-differential.out"
LOGS="$WORKTREE/.diff-harness"
mkdir -p "$LOGS"
: > "$OUT"

KEYS="src/core/keys.ts"
APP="src/server/app.ts"

PIN_E1="PIN E1: an edit changes exactly the fields given, and nothing else"
PIN_E2="PIN E2: an editor may grant only what it could have minted"
PIN_E3="PIN E3: a REVOKED key cannot be edited back to life"
PIN_E4="PIN E4: an edit is stamped and visible"
PIN_E5="PIN E5: a non-admin key cannot edit anything"
PIN_E6="PIN E6: an edit does NOT change the key's value"
PIN_E7="PIN E7: a body with no recognised field is refused and nothing changes"
PIN_E8="PIN E8: a database that predates the audit columns is migrated add-if-absent"

# The ONE anchored line each arm rewrites.
KEYS_ANCHOR='  const updatedAt = new Date(options.now()).toISOString();'
APP_ANCHOR='    if (target.revokedAt !== null) {'

LOCKED=0
restore() {
  # EVERY file any arm touches, always, idempotently: an error path must not be able
  # to skip cleanup (the row-27 lesson, recorded in deploy-differential.sh). `web/`
  # is included though neither current arm mutates it — the console is part of this
  # slice, and a restore that knows only today's files is the bug that was just fixed.
  git checkout HEAD -- "$KEYS" "$APP" web >/dev/null 2>&1 || true
  if [ "$LOCKED" = "1" ]; then rm -rf "$LOCK_DIR"; fi
  echo "RESTORED: $KEYS, $APP and web/ back at HEAD; lock released" | tee -a "$OUT"
}
trap restore EXIT INT TERM

redact() { sed -E 's/ssk_[A-Za-z0-9_-]+/ssk_<redacted>/g'; }
say() { echo "$@" | redact | tee -a "$OUT"; }
fail() { say "HARNESS FAILURE: $*"; exit 1; }
hash_of() { sha256sum "$1" | awk '{print $1}'; }

grep -qF "$KEYS_ANCHOR" "$KEYS" \
  || fail "$KEYS does not hold the edit-seam line this harness anchors on — refusing to guess"
grep -qF "$APP_ANCHOR" "$APP" \
  || fail "$APP does not hold the revoked-key line this harness anchors on — refusing to guess"

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  OWNER_PID="$(sed -n 's/^pid=//p' "$LOCK_DIR/owner" 2>/dev/null)"
  fail "the gate lock is already held (pid ${OWNER_PID:-unknown}) — this run would be VOID, refused, not evidence"
fi
LOCKED=1
printf 'pid=%s\nstarted=%s\ntier=full\nrepo=%s\nharness=key-edit-differential\n' \
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

# Did `pin` FAIL in this arm's log? TWO forms, because a pin that cannot be SEEN to fail
# is a pin that cannot be relied on: vitest prints a failing test as `× <name>` in the
# suite tree AND as `FAIL  <file> > <suite> > <name>` in the failure block. The earlier
# harnesses matched only the `×` form (which is why the metric was fixed in row 50);
# both are matched here, with `grep -F`, so no pin name is ever read as a regex.
pin_red() {
  local log="$1/full.log" pin="$2"
  grep -F "× $pin" "$log" >/dev/null && return 0
  grep -F "FAIL " "$log" | grep -F "$pin" >/dev/null && return 0
  return 1
}

# Assert an arm went RED on its named pin: the suite must fail and the named pin must
# appear in the log.
assert_red() {
  local label="$1" logdir="$2" pin="$3"
  [ -f "$logdir/full.log" ] || fail "$label: the suite never ran — read $logdir/cheap.log"
  # An arm that also fails the TYPECHECK proves "the tree is broken", not "the pin sees
  # the rule": the injection must be surgical enough to compile.
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

# The pins that no edit arm may touch: they are not about the value or the revocation.
assert_untouched_pins() {
  local label="$1" logdir="$2"
  assert_not_red "$label" "$logdir" "$PIN_E4"
  assert_not_red "$label" "$logdir" "$PIN_E5"
  assert_not_red "$label" "$logdir" "$PIN_E7"
  assert_not_red "$label" "$logdir" "$PIN_E8"
}

# --- control FIRST: the committed tree must be GREEN -------------------------
say "=== CONTROL — the committed tree ($(git rev-parse --short HEAD)) ==="
run_tiers CONTROL "$LOGS/control" || true
if ! grep -qE 'Test Files +[0-9]+ passed' "$LOGS/control/full.log"; then
  fail "the CONTROL run did not pass — read $LOGS/control/full.log; the harness cannot attribute anything"
fi
say "  control GREEN: $(grep -E 'Test Files|Tests ' "$LOGS/control/full.log" | tr '\n' ' ')"

# --- ARM A: the edit RE-MINTS the key's value (PIN E6) ----------------------
BEFORE_A="$(hash_of "$KEYS")"
python3 - "$KEYS" "$KEYS_ANCHOR" <<'PY'
import sys
path, anchor = sys.argv[1], sys.argv[2]
src = open(path).read()
assert src.count(anchor) == 1, "anchor is not unique"
# ARM A: every successful edit rotates the row's key_hash to the hash of a BRAND NEW raw
# key, i.e. "edit" behaves like re-mint. The credential the holder already has stops
# authenticating — the exact defect PIN E6 exists to refuse. This is the EDIT SEAM half
# and it leaves the route's authorization untouched on purpose.
arm = (
    "  const updatedAt = new Date(options.now()).toISOString();\n"
    "  // ARM A: the edit RE-MINTS the key's value instead of editing in place\n"
    "  db.prepare(\"UPDATE access_keys SET key_hash = ? WHERE id = ?\").run(sha256Hex(newRawKey()), options.id);"
)
src = src.replace(anchor, arm)
open(path, "w").write(src)
PY
[ $? -eq 0 ] || fail "ARM A: the injection did not apply"
grep -q 'ARM A: the edit RE-MINTS' "$KEYS" || fail "ARM A: the injection is not in $KEYS"
AFTER_A="$(hash_of "$KEYS")"
say "=== ARM A — PATCH re-mints the key's VALUE (the credential stops working) ==="
say "  file:   $KEYS"
say "  sha256: $BEFORE_A  (before)"
say "  sha256: $AFTER_A  (after injection)"
[ "$BEFORE_A" != "$AFTER_A" ] || fail "arm A hash unchanged — VOID probe"
run_tiers "ARM A" "$LOGS/arm-a" || true
assert_red "arm A" "$LOGS/arm-a" "$PIN_E6"
assert_untouched_pins "arm A" "$LOGS/arm-a"
# E3 is the OTHER half and must survive: arm A does not touch the revoked refusal.
assert_not_red "arm A" "$LOGS/arm-a" "$PIN_E3"
restore
[ "$(hash_of "$KEYS")" = "$BEFORE_A" ] || fail "arm A restore failed — the file hash did not come back"

# --- ARM B: a REVOKED key IS editable (PIN E3) ------------------------------
BEFORE_B="$(hash_of "$APP")"
python3 - "$APP" "$APP_ANCHOR" <<'PY'
import sys
path, anchor = sys.argv[1], sys.argv[2]
src = open(path).read()
assert src.count(anchor) == 1, "anchor is not unique"
# ARM B: the revoked-key refusal can never fire, so a key that was revoked can be
# edited — and an edit that restores `perms`/`stores` effectively revives it. `false as
# boolean` (rather than a literal `false`) keeps the injected condition typecheck-CLEAN:
# a constant condition can collapse TS's narrowing elsewhere and turn the arm into a
# typecheck failure, which would prove "the tree is broken" rather than "E3 catches the
# missing refusal" (the key-lifecycle harness's arm B learned this first).
arm = "    if ((false as boolean)) {  // ARM B: a REVOKED key IS editable"
src = src.replace(anchor, arm)
open(path, "w").write(src)
PY
[ $? -eq 0 ] || fail "ARM B: the injection did not apply"
grep -q 'ARM B: a REVOKED key IS editable' "$APP" || fail "ARM B: the injection is not in $APP"
AFTER_B="$(hash_of "$APP")"
say "=== ARM B — a REVOKED key is EDITABLE (revocation stops being terminal) ==="
say "  file:   $APP"
say "  sha256: $BEFORE_B  (before)"
say "  sha256: $AFTER_B  (after injection)"
[ "$BEFORE_B" != "$AFTER_B" ] || fail "arm B hash unchanged — VOID probe"
[ "$AFTER_A" != "$AFTER_B" ] || fail "the two arms produced the SAME hash — VOID probe"
run_tiers "ARM B" "$LOGS/arm-b" || true
assert_red "arm B" "$LOGS/arm-b" "$PIN_E3"
assert_untouched_pins "arm B" "$LOGS/arm-b"
# E6 is the OTHER half and must survive: arm B does not touch the edit seam.
assert_not_red "arm B" "$LOGS/arm-b" "$PIN_E6"
restore
[ "$(hash_of "$APP")" = "$BEFORE_B" ] || fail "arm B restore failed — the file hash did not come back"
[ "$(hash_of "$KEYS")" = "$BEFORE_A" ] || fail "arm B left $KEYS mutated — the restore is not total"

# --- control AFTER: the restored tree must be GREEN again --------------------
say
say "=== CONTROL — the restored tree ==="
run_tiers "CONTROL 2" "$LOGS/control2" || true
grep -qE 'Test Files +[0-9]+ passed' "$LOGS/control2/full.log" \
  || fail "post-restore suite is not green — read $LOGS/control2/full.log"
say "  control GREEN: $(grep -E 'Test Files|Tests ' "$LOGS/control2/full.log" | tr '\n' ' ')"
say "  sha256: $(hash_of "$KEYS")  (back to its before hash)"
say "  sha256: $(hash_of "$APP")  (back to its before hash)"

say
say "DIFFERENTIAL COMPLETE: arm A RED on PIN E6 (the edit re-minted the key's value); arm B RED on PIN E3 (a revoked key was editable); both controls GREEN. No VOID probe."
say "NOTE arm A's expected collateral: every pin that authenticates with the SAME raw key after an edit (E1, E2) falls with E6, because that IS the defect; E3/E4/E5/E7/E8 survive, which is the anti-vacuity direction."
say "logs: $LOGS/{control,arm-a,arm-b,control2}/{cheap,full}.log — raw transcript: $OUT"
exit 0
