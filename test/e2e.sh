#!/usr/bin/env bash
# End-to-end check: a headless Claude Code session with this plugin validates one work email
# through a live OneSource MCP server and reports the verdict and the credits.
#
# Spends real credits (about 1). Needs a OneSource API key; it is never written into the repo
# and never put on a command line: it goes into a 0600 temp file that is deleted on exit.
#
#   ONESOURCE_MCP_URL=http://localhost:3000/mcp ONESOURCE_API_KEY=... ./test/e2e.sh
#
# Optional:
#   E2E_EMAIL           work address to validate (default: a fictional one, which comes back invalid)
#   E2E_MODE            mcp-config (default): the key is sent by an --mcp-config server entry
#                         (--strict-mcp-config, so only that server loads);
#                       plugin: no --mcp-config; the plugin's own .mcp.json is used, with
#                         server_url and api_key set as its userConfig options through a 0600
#                         --settings file (pluginConfigs["onesource@inline"]). Exercises the
#                         shipped .mcp.json exactly as an installed plugin uses it.
#   E2E_REQUIRE_HOOK    1 (default) fails when the usage hook wrote no log line; 0 only warns.
#   E2E_MAX_BUDGET_USD  model spend cap for the session (default 1).
set -euo pipefail

: "${ONESOURCE_MCP_URL:?set ONESOURCE_MCP_URL, e.g. http://localhost:3000/mcp}"
: "${ONESOURCE_API_KEY:?set ONESOURCE_API_KEY (a OneSource API key for that server)}"
command -v claude >/dev/null || { echo "claude CLI not found"; exit 1; }
command -v node >/dev/null || { echo "node not found"; exit 1; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGIN="$ROOT/plugins/onesource"
EMAIL="${E2E_EMAIL:-maya.chen@tallpinesoftware.com}"
MODE="${E2E_MODE:-mcp-config}"
REQUIRE_HOOK="${E2E_REQUIRE_HOOK:-1}"

umask 077
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
CFG="$TMP/onesource"          # the usage hook writes its log here
mkdir -p "$CFG"

VERBS=(validate resolve enrich find discover)
args=(-p --plugin-dir "$PLUGIN" --output-format text --max-budget-usd "${E2E_MAX_BUDGET_USD:-1}")

if [ "$MODE" = "plugin" ] || [ "$MODE" = "helper" ]; then
  # The plugin's userConfig options, written from the environment by node (not via argv). A plugin
  # loaded with --plugin-dir reads them under the id onesource@inline.
  node -e '
    const fs = require("fs");
    const options = { server_url: process.env.ONESOURCE_MCP_URL, api_key: process.env.ONESOURCE_API_KEY };
    fs.writeFileSync(process.argv[1], JSON.stringify({ pluginConfigs: { "onesource@inline": { options } } }), { mode: 0o600 });
  ' "$TMP/settings.json"
  args+=(--settings "$TMP/settings.json")
  PREFIX="mcp__plugin_onesource_onesource__onesource_"
else
  # Server entry with the key header, written from the environment by node (not via argv).
  node -e '
    const fs = require("fs");
    const cfg = { mcpServers: { onesource: { type: "http", url: process.env.ONESOURCE_MCP_URL,
      headers: { "x-api-key": process.env.ONESOURCE_API_KEY } } } };
    fs.writeFileSync(process.argv[1], JSON.stringify(cfg), { mode: 0o600 });
  ' "$TMP/mcp.json"
  args+=(--mcp-config "$TMP/mcp.json" --strict-mcp-config)
  PREFIX="mcp__onesource__onesource_"
fi

allowed=""
for v in "${VERBS[@]}"; do allowed+="${allowed:+,}${PREFIX}${v}"; done
args+=(--allowedTools "$allowed")

PROMPT="Use the OneSource validate tool to check the work email ${EMAIL} with max_credits 1. \
Then reply in at most three lines: the validation status (valid, invalid, catch-all, risky or unknown) \
and the credits charged. Do not call any other tool."

echo "== e2e: mode=$MODE url=$ONESOURCE_MCP_URL tools=${PREFIX}{${VERBS[*]}}"
cd "$ROOT"
set +e
# --allowedTools takes several values and would swallow a trailing prompt, so it goes on stdin.
printf "%s" "$PROMPT" | ONESOURCE_CONFIG_DIR="$CFG" \
  claude "${args[@]}" > "$TMP/out.txt" 2>&1
status=$?
set -e

echo "-- claude output (exit $status)"
sed 's/^/   /' "$TMP/out.txt"
echo "--"

failures=0
if [ "$status" -ne 0 ]; then echo "FAIL  claude exited $status"; failures=$((failures + 1)); fi

if grep -qiE '\b(valid|invalid|catch-all|risky|unknown)\b' "$TMP/out.txt"; then
  echo "ok    output mentions a validation status"
else
  echo "FAIL  output does not mention a validation status"; failures=$((failures + 1))
fi

if grep -qiE 'credit' "$TMP/out.txt"; then
  echo "ok    output reports credits"
else
  echo "FAIL  output does not report credits"; failures=$((failures + 1))
fi

LOG="$CFG/usage.jsonl"
if [ -s "$LOG" ] && grep -q '"tool":"validate"' "$LOG"; then
  echo "ok    usage hook logged: $(tail -n 1 "$LOG")"
  if grep -qiF "$EMAIL" "$LOG"; then echo "FAIL  usage log contains the email"; failures=$((failures + 1)); fi
elif [ "$REQUIRE_HOOK" = "1" ]; then
  echo "FAIL  usage hook wrote no validate line to $LOG"; failures=$((failures + 1))
else
  echo "warn  usage hook wrote no validate line (E2E_REQUIRE_HOOK=0)"
fi

if [ "$failures" -eq 0 ]; then echo "e2e.sh: passed"; else echo "e2e.sh: $failures check(s) failed"; exit 1; fi
