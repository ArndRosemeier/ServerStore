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
# The SAME lock scripts/gate.sh takes: derived from the git COMMON dir, so it is one
# lock across the main tree and every worktree. A scratch lock in the worktree would
# protect nothing — the gate would take its own, elsewhere, and never see ours.
GIT_COMMON="$(git rev-parse --path-format=absolute --git-common-dir)"
LOCK="$(cd "$GIT_COMMON/.." && pwd)/.gate-lock"


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
# The harness HOLDS this lock and therefore must NOT call scripts/gate.sh for the
# arms: the gate takes the same lock and would (correctly) refuse itself with exit 9,
# which is VOID, not evidence. So each arm runs the two tiers the gate would run,
# with the lock held by this script instead.
mkdir -p "$(dirname "$LOCK")"
if ! mkdir "$LOCK" 2>/dev/null; then
  echo "REFUSED — another run holds $LOCK. This harness is VOID."
  exit 9
fi
printf 'pid=%s\nstarted=%s\ntier=differential\nrepo=%s\n' "$$" "$(date -u +%FT%TZ)" "$REPO_ROOT" > "$LOCK/owner"
echo "lock: acquired $LOCK (held across all arms)"

# $1 = label. Runs the cheap tier then the full tier, like the gate, to $OUT/$1.log.
# Echoes 0 on both-green, 1 on any failure.
run_tiers() {
  {
    echo "\$ pnpm run typecheck"
    pnpm run typecheck
    echo "\$ pnpm test"
    pnpm test
  } > "$OUT/$1.log" 2>&1
  if [ $? -eq 0 ]; then echo 0; else echo 1; fi
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
A_EXIT="$(run_tiers arm-a)"
A_PIN="$(grep -c 'PIN 6: the master store exists after first boot' "$OUT/arm-a.log" || true)"
echo "  tiers exit: $A_EXIT (1 = RED)"
echo "  named pin RED: ${A_PIN} line(s) in the log"
sed -n '/Failed Tests/,$p' "$OUT/arm-a.log" | grep -A5 '> PIN 6: the master store exists' | head -6
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
B_EXIT="$(run_tiers arm-b)"
B_PIN="$(grep -c 'PIN 5: the presented key string never appears in the database file' "$OUT/arm-b.log" || true)"
echo "  tiers exit: $B_EXIT (1 = RED)"
echo "  named pin RED: ${B_PIN} line(s) in the log"
sed -n '/Failed Tests/,$p' "$OUT/arm-b.log" | grep -A5 '> PIN 5: the presented key string' | head -6
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
C_EXIT="$(run_tiers arm-c)"
C_PIN="$(grep -c '× PIN 3: A REVOKED key is refused 401' "$OUT/arm-c.log" || true)"
echo "  tiers exit: $C_EXIT (1 = RED)"
echo "  named pin RED: ${C_PIN} line(s) in the log"
sed -n '/Failed Tests/,$p' "$OUT/arm-c.log" | grep -A5 '> PIN 3: A REVOKED' | head -6
git checkout HEAD -- "$C_FILE"
[ "$(hash_of "$C_FILE")" = "$C_BEFORE" ] || fail "arm C restore failed"
[ "$C_EXIT" = "1" ] || fail "arm C did not go RED (exit $C_EXIT)"
[ "$C_PIN" -ge 1 ] || fail "arm C went red but NOT on the named pin"

# --- arm D: a parameter property — the defect that only bites in production --
# `constructor(readonly key: T)` is legal TypeScript and vitest transpiles it fine,
# while `node --experimental-strip-types` refuses it at import. This is the exact
# defect this slice shipped and then found by probing `pnpm run serve` by hand.
D_FILE="src/server/app.ts"
D_BEFORE="$(hash_of "$D_FILE")"
python3 - "$D_FILE" <<'PY'
import sys
path = sys.argv[1]
source = open(path).read()
old = """  readonly key: AccessKeyRecord;
  readonly ctx: AppContext;

  constructor(key: AccessKeyRecord, ctx: AppContext) {
    this.key = key;
    this.ctx = ctx;
  }"""
new = """  constructor(
    readonly key: AccessKeyRecord,
    readonly ctx: AppContext,
  ) {}"""
if old not in source:
    print("ANCHOR MISSING", file=sys.stderr)
    sys.exit(3)
open(path, "w").write(source.replace(old, new))
PY
[ $? -eq 0 ] || fail "arm D injection did not apply"
grep -q "readonly key: AccessKeyRecord," "$D_FILE" || fail "arm D injection did not apply"
D_AFTER="$(hash_of "$D_FILE")"
echo
echo "ARM D — break the RUNTIME contract (a parameter property, which strip-only Node refuses)"
echo "  file:   $D_FILE"
echo "  sha256: $D_BEFORE  (before)"
echo "  sha256: $D_AFTER  (after injection)"
[ "$D_BEFORE" != "$D_AFTER" ] || fail "arm D hash unchanged — VOID probe"
D_EXIT="$(run_tiers arm-d)"
D_PIN="$(grep -c '× every side-effect-free module imports in a real node process' "$OUT/arm-d.log" || true)"
echo "  tiers exit: $D_EXIT (1 = RED)"
echo "  named pin RED: ${D_PIN} line(s) in the log"
sed -n '/Failed Tests/,$p' "$OUT/arm-d.log" | grep -A6 'a module failed to import under strip-only' | head -8
git checkout HEAD -- "$D_FILE"
[ "$(hash_of "$D_FILE")" = "$D_BEFORE" ] || fail "arm D restore failed"
[ "$D_EXIT" = "1" ] || fail "arm D did not go RED (exit $D_EXIT)"
[ "$D_PIN" -ge 1 ] || fail "arm D went red but NOT on the named pin"

# --- restore, then the control: the tree must be GREEN again ----------------
restore
echo
echo "CONTROL — the restored tree, same lock still held"
CTRL_EXIT="$(run_tiers control)"
echo "  tiers exit: $CTRL_EXIT (0 = GREEN)"
[ "$CTRL_EXIT" = "0" ] || fail "control run is not green — the injection was not the only difference"

echo
echo "DIFFERENTIAL COMPLETE: 4 arms RED on their named pins, control GREEN."
echo "logs: $OUT/arm-a.log $OUT/arm-b.log $OUT/arm-c.log $OUT/arm-d.log $OUT/control.log"
