#!/usr/bin/env bash
# End-to-end check: a headless Claude Code session loads this plugin exactly as an installed
# plugin (its own .mcp.json, which points at the hosted Agentic ID server), makes one free call
# (a discover count) and reports what came back.
#
# Spends no Agentic ID credits. Sign-in is Claude Code's own: authenticate the plugin's server once
# in an interactive session (/mcp > plugin:agentic-id:agentic-id > Authenticate); a headless session
# reuses that sign-in. No key is read, written or put on a command line.
#
#   ./test/e2e.sh
#
# Optional:
#   E2E_MAX_BUDGET_USD   model spend cap for the session (default 1).
set -euo pipefail

command -v claude >/dev/null || { echo "claude CLI not found"; exit 1; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGIN="$ROOT/plugins/agentic-id"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

PREFIX="mcp__plugin_agentic-id_agentic-id__"
allowed=""
for v in validate resolve enrich find discover lookalike facts ledger feedback credits; do allowed+="${allowed:+,}${PREFIX}${v}"; done
args=(-p --plugin-dir "$PLUGIN" --output-format text --max-budget-usd "${E2E_MAX_BUDGET_USD:-1}" --allowedTools "$allowed")

PROMPT="Do exactly one Agentic ID tool call and nothing else: the discover tool with count_only true \
for software companies in the UK with 100 to 2000 employees. \
Reply in at most two lines: how many companies match, and the credits charged."

echo "== e2e: plugin mode, hosted server from $PLUGIN/.mcp.json"
cd "$ROOT"
set +e
# --allowedTools takes several values and would swallow a trailing prompt, so it goes on stdin.
printf "%s" "$PROMPT" | claude "${args[@]}" > "$TMP/out.txt" 2>&1
status=$?
set -e

echo "-- claude output (exit $status)"
sed 's/^/   /' "$TMP/out.txt"
echo "--"

failures=0
ok() { echo "ok    $1"; }
bad() { echo "FAIL  $1"; failures=$((failures + 1)); }
[ "$status" -eq 0 ] || bad "claude exited $status"
grep -qiE 'sign in|authenticat|not signed' "$TMP/out.txt" && bad "not signed in: run /mcp in an interactive session and authenticate plugin:agentic-id:agentic-id"
grep -qE '[0-9][0-9,]*' "$TMP/out.txt" && grep -qiE 'compan|match' "$TMP/out.txt" && ok "output reports a count" || bad "output does not report a count"
grep -qiE 'credit|charged|free' "$TMP/out.txt" && ok "output reports credits" || bad "output does not report credits"

if [ "$failures" -eq 0 ]; then echo "e2e.sh: passed"; else echo "e2e.sh: $failures check(s) failed"; exit 1; fi
