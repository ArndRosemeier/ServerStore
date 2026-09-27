#!/usr/bin/env bash
#
# probe-live.sh — one live probe of a running ServerStore, over whatever URL you hand
# it (a loopback port, or the tunnel hostname https://store.futuremagic.de).
#
# It is the SAME two checks the spawned-entrypoint test pins (tests/entrypoint.test.ts,
# PIN D1 and PIN D3), run against the live host instead of a child process — so
# "it works through the tunnel" is a command with an exit code, not a claim.
#
# EXIT CODES ARE THE VOCABULARY — quote them exactly, never inflate them:
#   0  PASS    every check answered exactly what the pin requires
#   1  FAIL    at least one check did not; the failing line names the check
#   2  UNKNOWN the probe could not run at all (bad usage, no curl) — NOT a pass
#
# WHAT IT DELIBERATELY DOES NOT DO: it never takes, prints or logs an access key.
# The key-bearing round-trip (mint with `pnpm run admin:key`, PUT, GET, revoke) is
# the OWNER's acceptance step, because the dispatcher must not hold his master key.
# Do not add a `--key` flag here.
#
# Usage:
#   bash scripts/probe-live.sh https://store.futuremagic.de
#   bash scripts/probe-live.sh http://127.0.0.1:8477
#
# Env (defaults in brackets):
#   PROBE_TIMEOUT   seconds per request                              [10]

set -u

EXIT_PASS=0
EXIT_FAIL=1
EXIT_UNKNOWN=2

TIMEOUT="${PROBE_TIMEOUT:-10}"

if [ "$#" -ne 1 ] || [ -z "${1:-}" ]; then
  echo "UNKNOWN usage: $0 <base-url>   (e.g. https://store.futuremagic.de)"
  echo "        exit $EXIT_UNKNOWN — nothing was checked, so this is NOT a pass"
  exit "$EXIT_UNKNOWN"
fi

BASE="${1%/}"
case "$BASE" in
  http://*|https://*) ;;
  *)
    echo "UNKNOWN '$BASE' is not an http(s) base URL"
    echo "        exit $EXIT_UNKNOWN — nothing was checked, so this is NOT a pass"
    exit "$EXIT_UNKNOWN"
    ;;
esac

# Never log or echo a key: this script has no way to receive one.
case "$BASE" in
  *@*)
    echo "UNKNOWN refuse a base URL that carries credentials ('user:pass@host')"
    echo "        exit $EXIT_UNKNOWN — nothing was checked, so this is NOT a pass"
    exit "$EXIT_UNKNOWN"
    ;;
esac

if ! command -v curl >/dev/null 2>&1; then
  echo "UNKNOWN curl is required and was not found on PATH"
  echo "        exit $EXIT_UNKNOWN — nothing was checked, so this is NOT a pass"
  exit "$EXIT_UNKNOWN"
fi

BODY_FILE="$(mktemp "${TMPDIR:-/tmp}/serverstore-probe.XXXXXX")"
trap 'rm -f "$BODY_FILE"' EXIT INT TERM

echo "probe: $BASE"

# One check = one HTTP request, folded to a single status line.
#
# It is NOT called as `if probe ...`: a function used as an `if` condition runs in a
# SUBSHELL, so its PASS/FAIL lines would be captured instead of printed and its exit
# status would be discarded. `probe` prints directly and leaves the answer in
# `PROBE_STATUS`, read in this shell.
FAILURES=0
LAST_BODY=""
PROBE_STATUS=1
probe() {
  local label="$1" expected="$2" path="$3" got
  got="$(curl -sS -o "$BODY_FILE" -w '%{http_code}' --max-time "$TIMEOUT" -X GET "$BASE$path" 2>/dev/null)"
  got="${got:-000}"
  LAST_BODY="$(head -c 512 "$BODY_FILE" 2>/dev/null | tr -d '\r\n')"
  if [ "$got" = "$expected" ]; then
    PROBE_STATUS=0
    echo "PASS: $label — GET $path answered $got"
    return
  fi
  PROBE_STATUS=1
  echo "FAIL: $label — GET $path answered $got, expected $expected"
  echo "      body: $LAST_BODY"
  FAILURES=$((FAILURES + 1))
}

probe "healthz is 200 without a key" 200 "/healthz"
if [ "$PROBE_STATUS" -eq 0 ]; then
  if [ "$LAST_BODY" = '{"ok":true}' ]; then
    echo "PASS: healthz body is {\"ok\":true} — the service, not a proxy error page"
  else
    echo "FAIL: healthz body was '$LAST_BODY', expected '{\"ok\":true}'"
    FAILURES=$((FAILURES + 1))
  fi
fi

# The 401 must be the SERVICE's refusal, not a tunnel/edge page that happens to carry
# the same status, so the body is checked for the one error surface too.
probe "an unauthenticated API call is refused 401" 401 "/stores"
if [ "$PROBE_STATUS" -eq 0 ]; then
  if [ "$LAST_BODY" = '{"error":{"code":"unauthorized","message":"no access key presented (Authorization: Bearer <key> or x-api-key)"}}' ]; then
    echo "PASS: the refusal is the service's own error surface ('unauthorized'), not a tunnel/edge 401"
  else
    echo "FAIL: the 401 body is not the service's error surface: $LAST_BODY"
    FAILURES=$((FAILURES + 1))
  fi
fi

if [ "$FAILURES" -ne 0 ]; then
  echo "RESULT: FAIL — $FAILURES check(s) failed (exit $EXIT_FAIL)"
  exit "$EXIT_FAIL"
fi

echo "RESULT: PASS — every check answered exactly what it had to (exit $EXIT_PASS)"
echo "NOTE: this probe held no key. The key-bearing round-trip is the owner's acceptance step."
exit "$EXIT_PASS"
