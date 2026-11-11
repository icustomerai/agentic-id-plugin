#!/usr/bin/env bash
# End-to-end check: a headless Claude Code session loads this plugin exactly as an installed
# plugin (its own .mcp.json, hooks and options), calls two free Agentic ID tools against a live
# V3 API, and reports what came back.
#
# Spends no Agentic ID credits (status and a discover count are free). Needs an Agentic ID API
# key; it is never written into the repo and never put on a command line: it goes into a 0600
# temp settings file that is deleted on exit.
#
#   AGENTIC_ID_URL=http://127.0.0.1:3100 AGENTIC_ID_API_KEY_FILE=<file with the key> ./test/e2e.sh
#
# Optional:
#   AGENTIC_ID_API_KEY   the key itself, instead of AGENTIC_ID_API_KEY_FILE
#   E2E_REQUIRE_HOOK     1 (default) fails when the usage hook wrote no log line; 0 only warns.
#   E2E_MAX_BUDGET_USD   model spend cap for the session (default 1).
set -euo pipefail

: "${AGENTIC_ID_URL:?set AGENTIC_ID_URL, e.g. http://127.0.0.1:3100}"
[ -n "${AGENTIC_ID_API_KEY:-}${AGENTIC_ID_API_KEY_FILE:-}" ] || { echo "set AGENTIC_ID_API_KEY_FILE (or AGENTIC_ID_API_KEY)"; exit 1; }
command -v claude >/dev/null || { echo "claude CLI not found"; exit 1; }
command -v node >/dev/null || { echo "node not found"; exit 1; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGIN="$ROOT/plugins/agentic-id"
REQUIRE_HOOK="${E2E_REQUIRE_HOOK:-1}"

umask 077
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
CFG="$TMP/agentic-id"          # the usage hook writes its log here
mkdir -p "$CFG"

# The plugin's options, written by node from the environment (not via argv). A plugin loaded with
# --plugin-dir reads them under the id agentic-id@inline.
node --input-type=module -e '
  import { writeFileSync } from "node:fs";
  import { keyFromEnv } from "'"$PLUGIN"'/server/lib/client.mjs";
  const options = { api_key: keyFromEnv(), api_url: process.env.AGENTIC_ID_URL };
  if (!options.api_key) { console.error("no key found"); process.exit(1); }
  writeFileSync(process.argv[1], JSON.stringify({ pluginConfigs: { "agentic-id@inline": { options } } }), { mode: 0o600 });
' "$TMP/settings.json"

PREFIX="mcp__plugin_agentic-id_agentic-id__agentic_id_"
allowed=""
for v in validate resolve resolve_many enrich find discover lookalike facts ledger estimate status; do allowed+="${allowed:+,}${PREFIX}${v}"; done
args=(-p --plugin-dir "$PLUGIN" --settings "$TMP/settings.json" --output-format text --max-budget-usd "${E2E_MAX_BUDGET_USD:-1}" --allowedTools "$allowed")

PROMPT="Do exactly two Agentic ID tool calls and nothing else. First the status tool. Then the discover tool \
with count_only true for software companies in the UK with 100 to 2000 employees. \
Reply in at most three lines: the workspace you are connected as, how many companies match, and the credits charged."

echo "== e2e: plugin mode, api=$AGENTIC_ID_URL"
cd "$ROOT"
set +e
# --allowedTools takes several values and would swallow a trailing prompt, so it goes on stdin.
# The key variables are removed from the session's own environment: only the plugin option carries it.
printf "%s" "$PROMPT" | env -u AGENTIC_ID_API_KEY -u AGENTIC_ID_API_KEY_FILE -u AGENTIC_ID_URL AGENTIC_ID_CONFIG_DIR="$CFG" \
  claude "${args[@]}" > "$TMP/out.txt" 2>&1
status=$?
set -e

echo "-- claude output (exit $status)"
sed 's/^/   /' "$TMP/out.txt"
echo "--"

failures=0
ok() { echo "ok    $1"; }
bad() { echo "FAIL  $1"; failures=$((failures + 1)); }
[ "$status" -eq 0 ] || bad "claude exited $status"
grep -qE 'ws_[A-Za-z0-9_]+' "$TMP/out.txt" && ok "output names the workspace" || bad "output does not name the workspace"
grep -qE '[0-9][0-9,]*' "$TMP/out.txt" && grep -qiE 'compan|match' "$TMP/out.txt" && ok "output reports a count" || bad "output does not report a count"
grep -qiE 'credit|charged|free' "$TMP/out.txt" && ok "output reports credits" || bad "output does not report credits"

LOG="$CFG/usage.jsonl"
if [ -s "$LOG" ] && grep -q '"tool":"discover"' "$LOG" && grep -q '"tool":"status"' "$LOG"; then
  ok "usage hook logged both calls: $(tail -n 1 "$LOG")"
  grep -qiE 'software|"GB"|"UK"' "$LOG" && bad "usage log contains input values"
elif [ "$REQUIRE_HOOK" = "1" ]; then
  bad "usage hook did not log both calls to $LOG"
else
  echo "warn  usage hook did not log both calls (E2E_REQUIRE_HOOK=0)"
fi

if [ "$failures" -eq 0 ]; then echo "e2e.sh: passed"; else echo "e2e.sh: $failures check(s) failed"; exit 1; fi
