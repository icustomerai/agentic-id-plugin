#!/usr/bin/env bash
# Run ONE Claude Code session the way a user would: the plugin loaded as installed (its MCP server,
# skills, hooks, commands and options), one prompt in, and everything that happened written out.
#
#   test/user-session.sh <out-dir> "<what the user types>"
#
# Environment:
#   AGENTIC_ID_URL            the API (default http://127.0.0.1:3100)
#   AGENTIC_ID_API_KEY_FILE   a file holding an API key; leave unset to use a stored sign-in
#   AGENTIC_ID_CONFIG_DIR     where the sign-in session and the usage log live (default: <out-dir>/config)
#   SESSION_BUDGET            the plugin's "session credit budget" option (optional)
#   CONFIRM_ABOVE             the plugin's "ask before spending more than" option. A headless session
#                             cannot show the approval prompt, so a call above it is refused; set it
#                             higher to stand in for the user clicking Approve (default: the plugin's 10)
#   USER_SESSION_CWD          folder the session runs in (default: <out-dir>/work), e.g. one holding a CSV
#   USER_SESSION_MAX_USD      model spend cap for the session (default 1)
#   USER_SESSION_MODEL        the model the session uses (default sonnet)
#   USER_SESSION_EXTRA        extra claude flags (default: --no-chrome). Do not pass --strict-mcp-config:
#                             it also drops this plugin's own server.
#
# Writes into <out-dir>:
#   answer.txt     what Claude said to the user
#   tools.jsonl    one line per tool call: name, input, whether it was an error, and the result
#   usage.jsonl    the plugin's own usage log for the session (copied)
#   raw.jsonl      the full event stream
# The key is never put on a command line or written into <out-dir>.
set -euo pipefail
OUT="${1:?usage: user-session.sh <out-dir> \"<prompt>\"}"; PROMPT="${2:?give the prompt}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"; PLUGIN="$ROOT/plugins/agentic-id"
export AGENTIC_ID_URL="${AGENTIC_ID_URL:-http://127.0.0.1:3100}"
umask 077
mkdir -p "$OUT"; OUT="$(cd "$OUT" && pwd)"
CFG="${AGENTIC_ID_CONFIG_DIR:-$OUT/config}"; WORK="${USER_SESSION_CWD:-$OUT/work}"; mkdir -p "$CFG" "$WORK"
SETTINGS="$(mktemp)"; trap 'rm -f "$SETTINGS"' EXIT
SESSION_BUDGET="${SESSION_BUDGET:-}" CONFIRM_ABOVE="${CONFIRM_ABOVE:-}" node --input-type=module -e '
  import { writeFileSync } from "node:fs";
  import { keyFromEnv } from "'"$PLUGIN"'/server/lib/client.mjs";
  const options = { api_url: process.env.AGENTIC_ID_URL, ...(keyFromEnv() ? { api_key: keyFromEnv() } : {}), ...(process.env.SESSION_BUDGET ? { session_budget: process.env.SESSION_BUDGET } : {}), ...(process.env.CONFIRM_ABOVE ? { confirm_above: process.env.CONFIRM_ABOVE } : {}) };
  writeFileSync(process.argv[1], JSON.stringify({ pluginConfigs: { "agentic-id@inline": { options } } }), { mode: 0o600 });
' "$SETTINGS"
PREFIX="mcp__plugin_agentic-id_agentic-id__agentic_id_"; allowed="Read,Glob,Grep,Skill,Task,Write,Bash(agentic-id:*),Bash($PLUGIN/scripts/agentic-id:*)${USER_SESSION_ALLOW:+,$USER_SESSION_ALLOW}"
for v in validate resolve resolve_many enrich find discover lookalike facts ledger workspace report list login estimate status; do allowed+=",${PREFIX}${v}"; done
cd "$WORK"
set +e
printf "%s" "$PROMPT" | env -u AGENTIC_ID_API_KEY -u AGENTIC_ID_API_KEY_FILE -u AGENTIC_ID_URL AGENTIC_ID_CONFIG_DIR="$CFG" \
  claude -p --plugin-dir "$PLUGIN" --settings "$SETTINGS" --output-format stream-json --verbose \
  --model "${USER_SESSION_MODEL:-sonnet}" ${USER_SESSION_EXTRA:---no-chrome} \
  --max-budget-usd "${USER_SESSION_MAX_USD:-1}" --allowedTools "$allowed" > "$OUT/raw.jsonl" 2> "$OUT/stderr.txt"
status=$?
set -e
node --input-type=module -e '
  import { readFileSync, writeFileSync } from "node:fs";
  const [raw, out] = process.argv.slice(1);
  const calls = new Map(); const order = []; let answer = "";
  for (const line of readFileSync(raw, "utf8").split("\n").filter(Boolean)) {
    let e; try { e = JSON.parse(line); } catch { continue; }
    if (e.type === "result" && typeof e.result === "string") answer = e.result;
    for (const b of e.message?.content ?? []) {
      if (b.type === "tool_use") { calls.set(b.id, { tool: b.name.replace(/^mcp__plugin_agentic-id_agentic-id__/, ""), input: b.input }); order.push(b.id); }
      if (b.type === "tool_result" && calls.has(b.tool_use_id)) {
        const text = Array.isArray(b.content) ? b.content.map((c) => c.text ?? "").join("") : String(b.content ?? "");
        let parsed; try { parsed = JSON.parse(text); } catch { parsed = text.slice(0, 4000); }
        Object.assign(calls.get(b.tool_use_id), { is_error: b.is_error === true, result: parsed });
      }
    }
  }
  writeFileSync(`${out}/tools.jsonl`, order.map((id) => JSON.stringify(calls.get(id))).join("\n") + (order.length ? "\n" : ""));
  writeFileSync(`${out}/answer.txt`, answer + "\n");
' "$OUT/raw.jsonl" "$OUT"
[ -f "$CFG/usage.jsonl" ] && cp "$CFG/usage.jsonl" "$OUT/usage.jsonl" || : > "$OUT/usage.jsonl"
echo "session exit $status; $(wc -l < "$OUT/tools.jsonl" | tr -d ' ') tool call(s); answer in $OUT/answer.txt"
exit $status
