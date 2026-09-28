#!/usr/bin/env bash
#
# The writer's OWN differential for SLICE 20 — the ONE name rule's bound (ledger rows
# 87/87b, landing row 88). Two arms in OPPOSITE directions, plus one measured probe of
# the brief's own literal wording, which the owner's correction (row 87b) invalidated.
#
# What the pins claim, and what each arm therefore has to be able to redden:
#
#   ARM A  TOO STRICT — the LENGTH CHECK hard-codes a smaller bound (64) while
#          `NAME_MAX_LENGTH` and the built pattern stay at the real bound.
#          file: src/core/validate.ts
#                       -> PIN Z1 must go RED on the ACCEPTED half
#                          ("the name at the bound was refused")
#                       -> PIN Z2 and PIN Z3 fall as DECLARED TWINS (one rule, and the
#                          same smaller number reaches the message)
#          The browser file's `beforeAll` ALSO fails: its Z5 fixture PUTs an entry AT the
#          bound, which this arm refuses at setup. That is honest collateral and is named.
#
#   ARM B  TOO LOOSE — the length check is REMOVED and the pattern keeps only the charset
#          (unbounded), so nothing enforces a maximum.
#          file: src/core/validate.ts
#                       -> PIN Z1 must go RED on the REFUSAL half
#                          ("a name one character past the bound was accepted") while its
#                          ACCEPTED half stays green (asserted from the failing message)
#                       -> PIN Z3 and PIN Z6 fall as DECLARED TWINS (no maximum is stated
#                          any more, and the pattern no longer derives from the constant)
#
#   ARM C  THE BRIEF'S LITERAL ARM, measured rather than argued: set `NAME_MAX_LENGTH` to
#          64 and nothing else. Under the owner's correction the tests DERIVE their
#          boundary from the constant, so this cannot redden Z1 — the test's boundary moves
#          with the constant. The pin that DOES catch it is Z4 (the docs still state the
#          bound the constant used to be), with Z6 as collateral (the value 64 occurs
#          incidentally all over `src/`'s comments, which is exactly what that pin reports).
#          This arm is a TARGETED non-browser probe, not a full gate run: Z1/Z4/Z6 all live
#          in `tests/name-limit.test.ts` and `tests/api-doc.test.ts`.
#
# The slice is COMMITTED before this runs (that is what makes `HEAD` the pristine copy).
# Every arm prints src/core/validate.ts's sha256 before and after (an unchanged hash would
# be VOID), runs the tiers while HOLDING THE SAME LOCK `scripts/gate.sh` takes (calling the
# gate here would make it refuse itself with exit 9 — VOID, not evidence), and the restore
# is `git checkout HEAD --` in an `EXIT INT TERM` trap with the hash asserted back.
# Per-arm logs go under .diff-harness-name-limit/, so the green gate log is not clobbered.
#
# The harness runs IN THE WORKTREE (cd to its own directory's parent), so the tree it
# mutates and restores is this slice's, never the main checkout.
#
# CHROME COUNT, scoped to OUR OWN profile directory and BRACKETED so the counting grep
# cannot match its own argv; the brief's literal form is kept beside it as the measured
# control for the self-match (TRAP t8).
#
# NEVER PRINT A REAL KEY: every line that reaches the transcript is scrubbed of
# `ssk_…`-shaped strings (ledger row 21).

set -u
cd "$(dirname "$0")/.." || exit 1
WORKTREE="$(pwd)"

GIT_COMMON="$(git rev-parse --path-format=absolute --git-common-dir)"
REPO_ROOT="$(cd "$GIT_COMMON/.." && pwd)"
LOCK_DIR="$REPO_ROOT/.gate-lock"
OUT="$WORKTREE/checkpoints/name-limit-differential.out"
LOGS="$WORKTREE/.diff-harness-name-limit"
mkdir -p "$LOGS"
: > "$OUT"

VALIDATE="src/core/validate.ts"

PIN_Z1="PIN Z1: the boundary holds in BOTH directions"
PIN_Z2="PIN Z2: it is ONE rule, so the prefix filter and STORE names widen with it"
PIN_Z3="PIN Z3: the refusal message tells the truth"
PIN_Z4="PIN Z4: the docs state the NAME limit the code enforces"
PIN_Z6="PIN Z6: the numeric maximum is not retyped anywhere under src/"

LOCKED=0
restore() {
  # Always, idempotently: an error path must not be able to skip cleanup.
  git checkout HEAD -- "$VALIDATE" >/dev/null 2>&1 || true
  if [ "$LOCKED" = "1" ]; then rm -rf "$LOCK_DIR"; fi
  echo "RESTORED: $VALIDATE back at HEAD; lock released" | tee -a "$OUT"
}
trap restore EXIT INT TERM

redact() { sed -E 's/ssk_[A-Za-z0-9_-]+/ssk_<redacted>/g'; }
say() { echo "$@" | redact | tee -a "$OUT"; }
fail() { say "HARNESS FAILURE: $*"; exit 1; }
hash_of() { sha256sum "$1" | awk '{print $1}'; }

# OUR chrome processes: a profile path under a ServerStore checkout's browser scratch.
# The bracketed first `e` keeps THIS grep from matching its own command line.
chrome_count() { ps -eo args | grep -c 'ServerStor[e]/.*browser-scratch'; }
# The brief's LITERAL command, kept as a measured CONTROL for the self-match (t8).
chrome_count_literal() { ps -eo args | grep -c 'ServerStore/.*browser-scratch'; }

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  OWNER_PID="$(sed -n 's/^pid=//p' "$LOCK_DIR/owner" 2>/dev/null)"
  fail "the gate lock is already held (pid ${OWNER_PID:-unknown}) — this run would be VOID, refused, not evidence"
fi
LOCKED=1
printf 'pid=%s\nstarted=%s\ntier=full\nrepo=%s\nharness=name-limit-differential\n' \
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

# ARM C's targeted probe: the Z pins' own files, no browser.
run_targeted() {
  local label="$1" logdir="$2" exit_code
  mkdir -p "$logdir"
  ( cd "$WORKTREE" && bash -c 'pnpm exec vitest run tests/name-limit.test.ts tests/api-doc.test.ts tests/objects.test.ts' ) >"$logdir/targeted.log" 2>&1
  exit_code=$?
  say "  $label: targeted exit=$exit_code (log: $logdir/targeted.log)"
  return 0
}

# Did `pin` FAIL in this arm's log? BOTH forms a failing pin can take (`× <name>` in the
# suite tree, `FAIL … > <name>` in the failure block), matched with `grep -F` so a pin
# name is never read as a regex.
pin_red() {
  local log="$1" pin="$2"
  grep -F "× $pin" "$log" >/dev/null && return 0
  grep -F "FAIL " "$log" | grep -F "$pin" >/dev/null && return 0
  return 1
}

assert_red() {
  local label="$1" log="$2" pin="$3"
  [ -f "$log" ] || fail "$label: the suite never ran"
  if grep -qE 'error TS' "$(dirname "$log")/cheap.log" 2>/dev/null; then
    fail "$label: the injection ALSO broke the typecheck — the arm is not attributable: $(grep -m1 -E 'error TS' "$(dirname "$log")/cheap.log")"
  fi
  grep -A12 -F "× $pin" "$log" | head -22 | redact | tee -a "$OUT" || true
  pin_red "$log" "$pin" || fail "$label went red but NOT on its named pin"
}

assert_not_red() {
  local label="$1" log="$2" pin="$3"
  if pin_red "$log" "$pin"; then
    fail "$label ALSO reddened '$pin' — the injection is broader than the rule it proves"
  fi
}

browser_file_summary() {
  grep -E 'tests/browser\.test\.ts' "$1" | head -3 | redact | tee -a "$OUT" || true
}

suite_summary() {
  grep -E 'Test Files|Tests ' "$1" | tr '\n' ' '
}

say "validate.ts before anything: $(hash_of "$VALIDATE")"

# --- the self-match CONTROL, measured once -----------------------------------
say "chrome-count control (t8): scoped+bracketed=$(chrome_count)  brief's-literal=$(chrome_count_literal)"
say "  the literal command counts the grep THAT IS RUNNING IT (its pattern is in that argv); the bracketed one cannot."

# --- control FIRST: the committed tree must be GREEN -------------------------
say "=== CONTROL — the committed tree ($(git rev-parse --short HEAD)) ==="
run_tiers CONTROL "$LOGS/control" || true
if ! grep -qE 'Test Files +[0-9]+ passed' "$LOGS/control/full.log"; then
  fail "the CONTROL run did not pass — read $LOGS/control/full.log; the harness cannot attribute anything"
fi
say "  control GREEN: $(suite_summary "$LOGS/control/full.log")"
browser_file_summary "$LOGS/control/full.log"
[ "$(chrome_count)" = "0" ] || fail "the control run left $(chrome_count) chrome processes behind — VOID"

# --- ARM A: TOO STRICT — the length check hard-codes 64 ----------------------
BEFORE_A="$(hash_of "$VALIDATE")"
python3 - "$VALIDATE" <<'PY'
import sys

path = sys.argv[1]
src = open(path).read()
anchor = (
    "  if (raw.length > NAME_MAX_LENGTH) {\n"
    "    throw new StoreError(\"invalid_name\", `${what} may be at most ${NAME_MAX_LENGTH} characters`);\n"
    "  }"
)
assert src.count(anchor) == 1, "ARM A: the length check is not unique"
replacement = (
    "  if (raw.length > 64) {\n"
    "    throw new StoreError(\"invalid_name\", `${what} may be at most 64 characters`);\n"
    "  }"
)
open(path, "w").write(src.replace(anchor, replacement))
PY
[ $? -eq 0 ] || fail "ARM A: the injection did not apply"
grep -q 'raw.length > 64' "$VALIDATE" || fail "ARM A: the injection is not in $VALIDATE"
AFTER_A="$(hash_of "$VALIDATE")"
say "=== ARM A (TOO STRICT) — the length check hard-codes 64 while the constant stays at the bound ==="
say "  file:   $VALIDATE"
say "  sha256: $BEFORE_A  (before)"
say "  sha256: $AFTER_A  (after injection)"
[ "$BEFORE_A" != "$AFTER_A" ] || fail "arm A hash unchanged — VOID probe"
run_tiers "ARM A" "$LOGS/arm-a" || true
assert_red "arm A" "$LOGS/arm-a/full.log" "$PIN_Z1"
grep -F "the name at the bound was refused" "$LOGS/arm-a/full.log" >/dev/null \
  || fail "arm A reddened Z1 but NOT on the ACCEPTED half — the arm proves the wrong direction"
say "  ARM A reddened Z1 on the ACCEPTED half (a name AT the bound was refused)."
# Declared twins, measured rather than asserted away: ONE rule, so the prefix and the store
# name fall with it (Z2), and the smaller number reaches the message (Z3).
pin_red "$LOGS/arm-a/full.log" "$PIN_Z2" \
  && say "  DECLARED TWIN (measured): $PIN_Z2 -> RED (it is the same parser)" \
  || say "  $PIN_Z2 stayed green in this run"
pin_red "$LOGS/arm-a/full.log" "$PIN_Z3" \
  && say "  DECLARED TWIN (measured): $PIN_Z3 -> RED (the message states the smaller number)" \
  || say "  $PIN_Z3 stayed green in this run"
browser_file_summary "$LOGS/arm-a/full.log"
say "  browser file collateral: its Z5 fixture PUTs an entry AT the bound, so ARM A refuses it at setup (named, not hidden)."
[ "$(chrome_count)" = "0" ] || fail "arm A left $(chrome_count) chrome processes behind — VOID"
restore
[ "$(hash_of "$VALIDATE")" = "$BEFORE_A" ] || fail "arm A restore failed — the file hash did not come back"

# --- ARM B: TOO LOOSE — no length check, charset-only pattern ----------------
BEFORE_B="$(hash_of "$VALIDATE")"
python3 - "$VALIDATE" <<'PY'
import sys

path = sys.argv[1]
src = open(path).read()
length_check = (
    "  if (raw.length > NAME_MAX_LENGTH) {\n"
    "    throw new StoreError(\"invalid_name\", `${what} may be at most ${NAME_MAX_LENGTH} characters`);\n"
    "  }\n"
)
assert src.count(length_check) == 1, "ARM B: the length check is not unique"
src = src.replace(length_check, "")
pattern = (
    "export const NAME_PATTERN = new RegExp(\n"
    "  `^${NAME_FIRST_CHARSET}${NAME_CHARSET}{0,${NAME_MAX_LENGTH - 1}}$`,\n"
    ");"
)
assert src.count(pattern) == 1, "ARM B: the pattern build is not unique"
bounded = "export const NAME_PATTERN = new RegExp(\n  `^${NAME_FIRST_CHARSET}${NAME_CHARSET}*$`,\n);"
open(path, "w").write(src.replace(pattern, bounded))
PY
[ $? -eq 0 ] || fail "ARM B: the injection did not apply"
grep -q 'NAME_CHARSET}\*\$' "$VALIDATE" || fail "ARM B: the injection is not in $VALIDATE"
AFTER_B="$(hash_of "$VALIDATE")"
say "=== ARM B (TOO LOOSE) — the length check is gone and the pattern keeps only the charset ==="
say "  file:   $VALIDATE"
say "  sha256: $BEFORE_B  (before)"
say "  sha256: $AFTER_B  (after injection)"
[ "$BEFORE_B" != "$AFTER_B" ] || fail "arm B hash unchanged — VOID probe"
run_tiers "ARM B" "$LOGS/arm-b" || true
assert_red "arm B" "$LOGS/arm-b/full.log" "$PIN_Z1"
grep -F "a name one character past the bound was accepted" "$LOGS/arm-b/full.log" >/dev/null \
  || fail "arm B reddened Z1 but NOT on the REFUSAL half — the arm proves the wrong direction"
say "  ARM B reddened Z1 on the REFUSAL half (a name one character past the bound was accepted)."
say "  ...and its ACCEPTED half is proved GREEN by the failing message above: the run got PAST the"
say "  PUT/GET/DELETE at the bound and failed only on the +1 refusal."
pin_red "$LOGS/arm-b/full.log" "$PIN_Z3" \
  && say "  DECLARED TWIN (measured): $PIN_Z3 -> RED (no maximum is stated any more)" \
  || say "  $PIN_Z3 stayed green in this run"
pin_red "$LOGS/arm-b/full.log" "$PIN_Z6" \
  && say "  DECLARED TWIN (measured): $PIN_Z6 -> RED (the pattern no longer derives from the constant)" \
  || say "  $PIN_Z6 stayed green in this run"
browser_file_summary "$LOGS/arm-b/full.log"
[ "$(chrome_count)" = "0" ] || fail "arm B left $(chrome_count) chrome processes behind — VOID"
restore
[ "$(hash_of "$VALIDATE")" = "$BEFORE_B" ] || fail "arm B restore failed — the file hash did not come back"

# --- ARM C: the brief's literal arm, MEASURED (targeted probe, not a gate run) ---
BEFORE_C="$(hash_of "$VALIDATE")"
python3 - "$VALIDATE" <<'PY'
import sys

path = sys.argv[1]
src = open(path).read()
anchor = "export const NAME_MAX_LENGTH = 1024;"
assert src.count(anchor) == 1, "ARM C: the constant declaration is not unique"
open(path, "w").write(src.replace(anchor, "export const NAME_MAX_LENGTH = 64;"))
PY
[ $? -eq 0 ] || fail "ARM C: the injection did not apply"
grep -q 'NAME_MAX_LENGTH = 64;' "$VALIDATE" || fail "ARM C: the injection is not in $VALIDATE"
AFTER_C="$(hash_of "$VALIDATE")"
say "=== ARM C (the brief's literal arm) — NAME_MAX_LENGTH set to 64 and NOTHING else ==="
say "  file:   $VALIDATE"
say "  sha256: $BEFORE_C  (before)"
say "  sha256: $AFTER_C  (after injection)"
[ "$BEFORE_C" != "$AFTER_C" ] || fail "arm C hash unchanged — VOID probe"
run_targeted "ARM C" "$LOGS/arm-c" || true
if pin_red "$LOGS/arm-c/targeted.log" "$PIN_Z1"; then
  fail "arm C reddened Z1 — that would contradict the owner's correction and this report"
fi
say "  MEASURED: $PIN_Z1 stayed GREEN — the test DERIVES its boundary from the constant, so"
say "  changing the constant alone cannot redden it (this is the brief's arm as written, and it"
say "  is why the arm was re-aimed at Z1 in ARM A)."
pin_red "$LOGS/arm-c/targeted.log" "$PIN_Z4" \
  && say "  MEASURED: $PIN_Z4 -> RED — the docs still state the bound the constant used to be." \
  || fail "arm C did not redden Z4 — then nothing catches a bare constant change"
pin_red "$LOGS/arm-c/targeted.log" "$PIN_Z6" \
  && say "  COLLATERAL (measured): $PIN_Z6 -> RED — the value 64 occurs incidentally all over \`src/\`'s comments (row 64x)." \
  || say "  $PIN_Z6 stayed green in this run"
restore
[ "$(hash_of "$VALIDATE")" = "$BEFORE_C" ] || fail "arm C restore failed — the file hash did not come back"

# --- control AFTER: the restored tree must be GREEN again --------------------
say
say "=== CONTROL — the restored tree ==="
run_tiers "CONTROL 2" "$LOGS/control2" || true
grep -qE 'Test Files +[0-9]+ passed' "$LOGS/control2/full.log" \
  || fail "post-restore suite is not green — read $LOGS/control2/full.log"
say "  control GREEN: $(suite_summary "$LOGS/control2/full.log")"
browser_file_summary "$LOGS/control2/full.log"
say "  sha256: $(hash_of "$VALIDATE")  ($VALIDATE back to its before hash)"
[ "$(chrome_count)" = "0" ] || fail "the post-restore control left $(chrome_count) chrome processes behind — VOID"

say
say "DIFFERENTIAL COMPLETE: ARM A (TOO STRICT) went RED on PIN Z1's ACCEPTED half (Z2/Z3 twins);"
say "ARM B (TOO LOOSE) went RED on PIN Z1's REFUSAL half with the accepted half green (Z3/Z6 twins);"
say "ARM C measured the brief's literal wording: changing ONLY the constant leaves Z1 GREEN and is caught"
say "by PIN Z4. Both controls GREEN, so the pins are not merely always-red. Our own chrome processes"
say "after every run: 0 (count scoped to ServerStore/*browser-scratch with a bracketed pattern that cannot"
say "match its own argv; the brief's literal command self-matches, measured above). No VOID probe."
say "logs: $LOGS/{control,arm-a,arm-b,arm-c,control2}/*.log — raw transcript: $OUT"
exit 0
