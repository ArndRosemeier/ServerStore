#!/usr/bin/env bash
#
# The writer's OWN differential — scratch machinery, lives in this worktree.
#
# Three arms. Each one edits ONE line of committed source, proves the file hash
# CHANGED, and shows the named pin going RED. Two arms that produced identical
# output would be a VOID probe, so the arms inject DIFFERENT defects into
# DIFFERENT files and each prints the test that failed.
#
# The lock is taken BEFORE the first injection and held for the whole run, so no
# other actor can start a suite while a line of source is broken. The restore runs
# in a trap, so a failure in the middle cannot leave the tree mutated.
#
# The slice is COMMITTED before this runs: restoration is `git checkout HEAD --`,
# which would otherwise destroy uncommitted work.

set -u
cd "$(dirname "$0")/.." || exit 1
REPO_ROOT="$(pwd)"
OUT="$REPO_ROOT/.diff-harness"
mkdir -p "$OUT"
LOCK="$REPO_ROOT/.gate-lock"
GATE="$REPO_ROOT/scripts/gate.sh"

RESTORED=0
restore() {
  if [ "$RESTORED" = "1" ]; then return; fi
  RESTORED=1
  git checkout HEAD -- src tests >/dev/null 2>&1 || true
  rm -rf "$LOCK"
  echo "RESTORED: working tree back at $(git rev-parse --short HEAD), lock released"
}
trap restore EXIT INT TERM

fail() { echo "HARNESS FAILURE: $*"; exit 1; }

# --- the lock, held for the whole run ---------------------------------------
mkdir -p "$(dirname "$LOCK")"
if ! mkdir "$LOCK" 2>/dev/null; then
  echo "REFUSED — another run holds $LOCK. This harness is VOID."
  exit 9
fi
printf 'pid=%s\nstarted=%s\ntier=differential\nrepo=%s\n' "$$" "$(date -u +%FT%TZ)" "$REPO_ROOT" > "$LOCK/owner"
echo "lock: acquired $LOCK (held across all arms)"

run_gate() { # $1 = label ; writes stdout+stderr to $OUT/$1.log, echoes the exit code
  bash "$GATE" > "$OUT/$1.log" 2>&1
  echo $?
}

hash_of() { sha256sum "$1" | awk '{print $1}'; }

# --- arm A: master store seeded under the WRONG NAME (pin 6) ----------------
A_FILE="src/stores/registry.ts"
A_BEFORE="$(hash_of "$A_FILE")"
sed -i "s/VALUES ('master', /VALUES ('MASTER', /" "$A_FILE"
grep -q "VALUES ('MASTER'" "$A_FILE" || fail "arm A injection did not apply"
A_AFTER="$(hash_of "$A_FILE")"
echo
echo "ARM A — break pin 6 (the seeded store is not named 'master')"
echo "  file:   $A_FILE"
echo "  sha256: $A_BEFORE  (before)"
echo "  sha256: $A_AFTER  (after injection)"
[ "$A_BEFORE" != "$A_AFTER" ] || fail "arm A hash unchanged — VOID probe"
A_EXIT="$(run_gate arm-a)"
A_PIN="$(grep -c 'PIN 6: the master store exists after first boot' "$OUT/arm-a.log" || true)"
echo "  gate exit: $A_EXIT (1 = RED)"
echo "  named pin RED: ${A_PIN} line(s) in the log"
sed -n '/Failed Tests/,/^$/p' "$OUT/arm-a.log" | grep -E '^ FAIL|AssertionError' | head -4
git checkout HEAD -- "$A_FILE"
[ "$(hash_of "$A_FILE")" = "$A_BEFORE" ] || fail "arm A restore failed"
[ "$A_EXIT" = "1" ] || fail "arm A did not go RED (exit $A_EXIT)"
[ "$A_PIN" -ge 1 ] || fail "arm A went red but NOT on the named pin"

# --- arm B: the raw key stored NEXT TO its hash (pin 5) ---------------------
B_FILE="src/core/keys.ts"
B_BEFORE="$(hash_of "$B_FILE")"
sed -i 's/sha256Hex(raw),/`${sha256Hex(raw)}:${raw}`,/' "$B_FILE"
grep -q '${sha256Hex(raw)}:${raw}' "$B_FILE" || fail "arm B injection did not apply"
B_AFTER="$(hash_of "$B_FILE")"
echo
echo "ARM B — break pin 5 (the raw key is written into the database beside its hash)"
echo "  file:   $B_FILE"
echo "  sha256: $B_BEFORE  (before)"
echo "  sha256: $B_AFTER  (after injection)"
[ "$B_BEFORE" != "$B_AFTER" ] || fail "arm B hash unchanged — VOID probe"
B_EXIT="$(run_gate arm-b)"
B_PIN="$(grep -c 'PIN 5: the presented key string never appears in the database file' "$OUT/arm-b.log" || true)"
echo "  gate exit: $B_EXIT (1 = RED)"
echo "  named pin RED: ${B_PIN} line(s) in the log"
sed -n '/Failed Tests/,/^$/p' "$OUT/arm-b.log" | grep -E '^ FAIL|AssertionError' | head -4
git checkout HEAD -- "$B_FILE"
[ "$(hash_of "$B_FILE")" = "$B_BEFORE" ] || fail "arm B restore failed"
[ "$B_EXIT" = "1" ] || fail "arm B did not go RED (exit $B_EXIT)"
[ "$B_PIN" -ge 1 ] || fail "arm B went red but NOT on the named pin"

# --- arm C: a revoked key still resolves (pin 3) ----------------------------
C_FILE="src/core/keys.ts"
C_BEFORE="$(hash_of "$C_FILE")"
sed -i 's/  if (row.revoked_at !== null) return null;/  if (row.revoked_at === null) return null;/' "$C_FILE"
grep -q 'row.revoked_at === null' "$C_FILE" || fail "arm C injection did not apply"
C_AFTER="$(hash_of "$C_FILE")"
echo
echo "ARM C — break pin 3 (the revoked-key check is inverted)"
echo "  file:   $C_FILE"
echo "  sha256: $C_BEFORE  (before)"
echo "  sha256: $C_AFTER  (after injection)"
[ "$C_BEFORE" != "$C_AFTER" ] || fail "arm C hash unchanged — VOID probe"
C_EXIT="$(run_gate arm-c)"
C_PIN="$(grep -c 'A REVOKED key is refused 401' "$OUT/arm-c.log" || true)"
echo "  gate exit: $C_EXIT (1 = RED)"
echo "  named pin RED: ${C_PIN} line(s) in the log"
sed -n '/Failed Tests/,/^$/p' "$OUT/arm-c.log" | grep -E '^ FAIL|AssertionError' | head -4
git checkout HEAD -- "$C_FILE"
[ "$(hash_of "$C_FILE")" = "$C_BEFORE" ] || fail "arm C restore failed"
[ "$C_EXIT" = "1" ] || fail "arm C did not go RED (exit $C_EXIT)"
[ "$C_PIN" -ge 1 ] || fail "arm C went red but NOT on the named pin"

# --- restore, then the control: the tree must be GREEN again ----------------
restore
echo
echo "CONTROL — the restored tree, same lock still held"
CTRL_EXIT="$(run_gate control)"
echo "  gate exit: $CTRL_EXIT (0 = GREEN)"
[ "$CTRL_EXIT" = "0" ] || fail "control run is not green — the injection was not the only difference"

echo
echo "DIFFERENTIAL COMPLETE: 3 arms RED on their named pins, control GREEN."
echo "logs: $OUT/arm-a.log $OUT/arm-b.log $OUT/arm-c.log $OUT/control.log"
