#!/usr/bin/env bash
#
# The writer's OWN differential for SLICE 3 — the secret tripwire. Kept as
# reproducible evidence for this landing and as a worked example, NOT a general
# harness: the arm below is this slice's pin and file.
#
# ONE arm: append an OBVIOUSLY FAKE GitHub token (ghp_ + 36 x "A") to a tracked file,
# run the ONE gate, and watch PIN S1 go RED. The file's sha256 is printed before and
# after — an unchanged hash would make the probe VOID. The restore runs from HEAD in an
# EXIT INT TERM trap, so a crash cannot leave the token in the tree.
#
# The slice is COMMITTED before this runs: restoration is `git checkout HEAD --`.
# The fake token is BUILT from parts, never written as a literal: this script is
# tracked, and a literal would make the tripwire flag its own harness.
#
# GATE_LOG_DIR is redirected per arm so the writer's GREEN gate log is not clobbered.

set -u
cd "$(dirname "$0")/.." || exit 1
REPO_ROOT="$(pwd)"
TARGET="AGENTS.md"
OUT="$REPO_ROOT/.diff-harness"
mkdir -p "$OUT"

FAKE="ghp_$(printf 'A%.0s' $(seq 1 36))"

RESTORED=0
restore() {
  if [ "$RESTORED" = "1" ]; then return; fi
  RESTORED=1
  git checkout HEAD -- "$TARGET" >/dev/null 2>&1 || true
  echo "RESTORED: $TARGET back at $(git rev-parse --short HEAD)"
}
trap restore EXIT INT TERM

fail() { echo "HARNESS FAILURE: $*"; exit 1; }
hash_of() { sha256sum "$1" | awk '{print $1}'; }

# --- arm S: a fake token in a tracked file (pin S1) --------------------------
BEFORE="$(hash_of "$TARGET")"
printf '\n<!-- throwaway probe, restored by the trap -->\n%s\n' "$FAKE" >> "$TARGET"
AFTER="$(hash_of "$TARGET")"
echo "ARM S — plant an obviously fake GitHub token in a TRACKED file"
echo "  file:   $TARGET"
echo "  sha256: $BEFORE  (before)"
echo "  sha256: $AFTER  (after injection)"
[ "$BEFORE" != "$AFTER" ] || fail "arm S hash unchanged — VOID probe"

GATE_LOG_DIR="$OUT/arm" bash scripts/gate.sh
ARM_EXIT=$?
echo "  gate exit: $ARM_EXIT (1 = RED)"
PIN_LINES="$(grep -c 'PIN S1: the tracked tree carries no GitHub token shape' "$OUT/arm/gate.log" || true)"
echo "  named pin RED: ${PIN_LINES} line(s) in the log"
sed -n '/Failed Tests/,$p' "$OUT/arm/gate.log" | grep -A6 'PIN S1: the tracked tree carries no GitHub token shape' | head -8

restore
[ "$(hash_of "$TARGET")" = "$BEFORE" ] || fail "restore failed — the file hash did not come back"
[ "$ARM_EXIT" = "1" ] || fail "arm S did not go RED (exit $ARM_EXIT)"
[ "$PIN_LINES" -ge 1 ] || fail "arm S went red but NOT on the named pin"

# --- control: the restored tree must be GREEN again --------------------------
echo
echo "CONTROL — the restored tree"
GATE_LOG_DIR="$OUT/control" bash scripts/gate.sh
CTRL_EXIT=$?
echo "  gate exit: $CTRL_EXIT (0 = GREEN)"
[ "$CTRL_EXIT" = "0" ] || fail "control run is not green — the injection was not the only difference"

echo
echo "DIFFERENTIAL COMPLETE: arm RED on PIN S1, control GREEN."
echo "logs: $OUT/arm/gate.log $OUT/control/gate.log"
