#!/usr/bin/env bash
#
# The writer's OWN differential for SLICE 13 (E1) — the `prefix=` filter on the object
# listing. Ledger row 61.
#
# THREE arms, each aimed at a DIFFERENT pin, because no single direction can prove both
# that the filter narrows CORRECTLY and that it narrows WITHOUT scanning the store:
#   ARM A  the range's lower bound is made EXCLUSIVE (`name >= ?` -> `name > ?`), so the
#          entry whose name IS the prefix is silently dropped.
#                       -> PIN P1 must go RED   (the boundary entry is lost)
#          file: src/storage/kinds.ts — the ONE statement the seam prepares
#   ARM B  the range is re-implemented as `substr(name, 1, length(?)) = ?`, which returns
#          the SAME rows and keeps the store-equality index probe, but the index no longer
#          carries the NAME range — the store is filtered row by row.
#                       -> PIN P7 must go RED while P1-P6 stay GREEN (rows still correct)
#          file: src/storage/kinds.ts — the same seam, the SQL + its own bind parameters
#   ARM C  the API doc's "prefix is the ONE filter" truth is replaced by the STALE
#          "a store with many objects returns them all".
#                       -> PIN P8 must go RED, and PIN A1-A3 must stay GREEN (the route
#                          set is unchanged; only the prose about the parameter rotted)
#          file: docs/API.md — the client contract
#
# The arms are SURGICAL and each asserts the pins that must SURVIVE, because an arm that
# reddens everything proves only that it broke the tree: arm A leaves P5 (no prefix) and
# P7 (still a range) green; arm B leaves the RESULT pins green, which is exactly why P7
# exists; arm C leaves the contract's ROUTE and ERROR pins green.
#
# The slice is COMMITTED before this runs (that is what makes `HEAD` the pristine copy).
# Every arm prints its file's sha256 before and after (an unchanged hash would be VOID),
# runs BOTH tiers directly while HOLDING THE SAME LOCK `scripts/gate.sh` takes (calling
# the gate here would make it refuse itself with exit 9 — VOID, not evidence), and the
# restore is `git checkout HEAD --` in an `EXIT INT TERM` trap over EVERY file an arm
# touches. Per-arm logs go under .diff-harness/, so the green gate log is not clobbered.
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
OUT="$WORKTREE/checkpoints/prefix-differential.out"
LOGS="$WORKTREE/.diff-harness"
mkdir -p "$LOGS"
: > "$OUT"

KINDS="src/storage/kinds.ts"
DOC="docs/API.md"

PIN_P1='PIN P1: ?prefix= returns exactly the matching entries'
PIN_P2='PIN P2: a prefix that matches nothing is 200 with an empty list, never 404'
PIN_P3='PIN P3: an empty or whitespace prefix is refused 400 invalid_name — NOT the whole store'
PIN_P4='PIN P4: an unmatchable prefix is refused, never silently empty'
PIN_P5='PIN P5: with NO prefix the listing is byte-for-byte what it was'
PIN_P6='PIN P6: the filter changes no authorization'
PIN_P7='PIN P7: the prefix query is a RANGE on the primary key'
PIN_P8="PIN P8: the API doc's stated \`prefix\` behaviour matches the code"
PIN_A1='PIN A1: every route the app registers is in the API doc, and every route in the doc is registered'
PIN_A2="PIN A2: every code in ERROR_CODES appears in the doc's error table"
PIN_A3="PIN A3: the doc's stated max-bytes default equals the code's"

# The anchors the arms rewrite. Each must be present EXACTLY once or the harness refuses.
ARM_A_ANCHOR='AND name >= ?'
ARM_B_SQL='AND name >= ? AND name < ?'
# The WHOLE template literal, backticks included: replacing only the `${…}` inside it
# leaves the literal string `prefix` and the arm then matches NOTHING (a harness bug the
# FIRST run found — it reddened P1 too and was correctly refused as unattributable).
ARM_B_ARGS='`${prefix}${PREFIX_RANGE_HIGH_SENTINEL}`'
ARM_C_ANCHOR='**`prefix` is the ONE filter** this route has — there is no pagination,'
ARM_C_REPLACEMENT='**a filter** this route has. No pagination: a store with many objects returns them all.'

LOCKED=0
restore() {
  # EVERY file any arm touches, always, idempotently: an error path must not be able
  # to skip cleanup (the row-27 lesson).
  git checkout HEAD -- "$KINDS" "$DOC" >/dev/null 2>&1 || true
  if [ "$LOCKED" = "1" ]; then rm -rf "$LOCK_DIR"; fi
  echo "RESTORED: $KINDS and $DOC back at HEAD; lock released" | tee -a "$OUT"
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
printf 'pid=%s\nstarted=%s\ntier=full\nrepo=%s\nharness=prefix-differential\n' \
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

# --- ARM A: the range's lower bound is EXCLUSIVE (PIN P1) --------------------
BEFORE_A="$(hash_of "$KINDS")"
python3 - "$KINDS" "$ARM_A_ANCHOR" <<'PY'
import sys

path, anchor = sys.argv[1], sys.argv[2]
src = open(path).read()
assert src.count(anchor) == 1, "ARM A: the `>=` anchor is not unique"
open(path, "w").write(src.replace(anchor, "AND name > ?", 1))
PY
[ $? -eq 0 ] || fail "ARM A: the injection did not apply"
grep -q 'AND name > ?' "$KINDS" || fail "ARM A: the injection is not in $KINDS"
AFTER_A="$(hash_of "$KINDS")"
say "=== ARM A — the range lower bound is EXCLUSIVE (name >= ? -> name > ?) ==="
say "  file:   $KINDS"
say "  sha256: $BEFORE_A  (before)"
say "  sha256: $AFTER_A  (after injection)"
[ "$BEFORE_A" != "$AFTER_A" ] || fail "arm A hash unchanged — VOID probe"
run_tiers "ARM A" "$LOGS/arm-a" || true
assert_red "arm A" "$LOGS/arm-a" "$PIN_P1"
# Anti-vacuity: the no-prefix listing never reaches the range, and the range is still a
# range — so an exclusive bound is distinguishable from "the filter is broken".
assert_not_red "arm A" "$LOGS/arm-a" "$PIN_P5"
assert_not_red "arm A" "$LOGS/arm-a" "$PIN_P7"
assert_not_red "arm A" "$LOGS/arm-a" "$PIN_P6"
restore
[ "$(hash_of "$KINDS")" = "$BEFORE_A" ] || fail "arm A restore failed — the file hash did not come back"

# --- ARM B: the filter is re-implemented with substr (PIN P7) ----------------
BEFORE_B="$(hash_of "$KINDS")"
python3 - "$KINDS" "$ARM_B_SQL" "$ARM_B_ARGS" <<'PY'
import sys

path, sql_anchor, args_anchor = sys.argv[1], sys.argv[2], sys.argv[3]
src = open(path).read()
assert src.count(sql_anchor) == 1, "ARM B: the SQL range anchor is not unique"
assert src.count(args_anchor) == 1, "ARM B: the bind-parameter anchor is not unique"
# The DEFECT: the index no longer carries the name range; the store is filtered row by
# row. The rows RETURNED stay correct — which is the whole reason PIN P7 exists.
src = src.replace(sql_anchor, "AND substr(name, 1, length(?)) = ?", 1)
src = src.replace(args_anchor, "prefix", 1)
open(path, "w").write(src)
PY
[ $? -eq 0 ] || fail "ARM B: the injection did not apply"
grep -q 'substr(name, 1, length(?)) = ?' "$KINDS" || fail "ARM B: the injection is not in $KINDS"
AFTER_B="$(hash_of "$KINDS")"
say "=== ARM B — the filter is re-implemented as substr(name, 1, length(?)) = ? ==="
say "  file:   $KINDS"
say "  sha256: $BEFORE_B  (before)"
say "  sha256: $AFTER_B  (after injection)"
[ "$BEFORE_B" != "$AFTER_B" ] || fail "arm B hash unchanged — VOID probe"
[ "$AFTER_A" != "$AFTER_B" ] || fail "the two kinds.ts arms produced the SAME hash — VOID probe"
run_tiers "ARM B" "$LOGS/arm-b" || true
assert_red "arm B" "$LOGS/arm-b" "$PIN_P7"
# The rows are STILL CORRECT — this is what makes the pin about the PLAN, not the answer.
assert_not_red "arm B" "$LOGS/arm-b" "$PIN_P1"
assert_not_red "arm B" "$LOGS/arm-b" "$PIN_P2"
assert_not_red "arm B" "$LOGS/arm-b" "$PIN_P3"
assert_not_red "arm B" "$LOGS/arm-b" "$PIN_P4"
assert_not_red "arm B" "$LOGS/arm-b" "$PIN_P5"
assert_not_red "arm B" "$LOGS/arm-b" "$PIN_P6"
restore
[ "$(hash_of "$KINDS")" = "$BEFORE_B" ] || fail "arm B restore failed — the file hash did not come back"

# --- ARM C: the API doc's prefix truth rots back to the stale sentence (PIN P8) ---
BEFORE_C="$(hash_of "$DOC")"
python3 - "$DOC" "$ARM_C_ANCHOR" "$ARM_C_REPLACEMENT" <<'PY'
import sys

path, anchor, replacement = sys.argv[1], sys.argv[2], sys.argv[3]
src = open(path).read()
assert src.count(anchor) == 1, "ARM C: the prefix-truth anchor is not unique"
open(path, "w").write(src.replace(anchor, replacement, 1))
PY
[ $? -eq 0 ] || fail "ARM C: the injection did not apply"
grep -q 'a store with many objects returns them all' "$DOC" || fail "ARM C: the injection is not in $DOC"
AFTER_C="$(hash_of "$DOC")"
say "=== ARM C — the API doc says \"a store with many objects returns them all\" again ==="
say "  file:   $DOC"
say "  sha256: $BEFORE_C  (before)"
say "  sha256: $AFTER_C  (after injection)"
[ "$BEFORE_C" != "$AFTER_C" ] || fail "arm C hash unchanged — VOID probe"
run_tiers "ARM C" "$LOGS/arm-c" || true
assert_red "arm C" "$LOGS/arm-c" "$PIN_P8"
# The ROUTE set and the ERROR vocabulary did not change, so the contract pins survive.
assert_not_red "arm C" "$LOGS/arm-c" "$PIN_A1"
assert_not_red "arm C" "$LOGS/arm-c" "$PIN_A2"
assert_not_red "arm C" "$LOGS/arm-c" "$PIN_A3"
restore
[ "$(hash_of "$DOC")" = "$BEFORE_C" ] || fail "arm C restore failed — the file hash did not come back"

# --- control AFTER: the restored tree must be GREEN again --------------------
say
say "=== CONTROL — the restored tree ==="
run_tiers "CONTROL 2" "$LOGS/control2" || true
grep -qE 'Test Files +[0-9]+ passed' "$LOGS/control2/full.log" \
  || fail "post-restore suite is not green — read $LOGS/control2/full.log"
say "  control GREEN: $(grep -E 'Test Files|Tests ' "$LOGS/control2/full.log" | tr '\n' ' ')"
say "  sha256: $(hash_of "$KINDS")  (kinds.ts, back to its before hash)"
say "  sha256: $(hash_of "$DOC")  (API.md, back to its before hash)"

say
say "DIFFERENTIAL COMPLETE: arm A RED on PIN P1 (an exclusive lower bound drops the entry whose name IS the prefix); arm B RED on PIN P7 while every RESULT pin stayed GREEN (substr keeps the store-equality probe but loses the name range); arm C RED on PIN P8 (the doc rotted back to the stale sentence) with the route/error contract pins GREEN. Both controls GREEN. No VOID probe."
say "logs: $LOGS/{control,arm-a,arm-b,arm-c,control2}/{cheap,full}.log — raw transcript: $OUT"
exit 0
