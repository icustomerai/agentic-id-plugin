#!/usr/bin/env bash
# Run ONE Claude Code session the way a user would: the plugin loaded as installed (the hosted MCP
# server, skills, commands and agent), one prompt in, and everything that happened written out.
#
#   test/user-session.sh <out-dir> "<what the user types>"
#
# Sign-in is Claude Code's own: authenticate the plugin's hosted server once in an interactive
# session (/mcp > plugin:agentic-id:agentic-id > Authenticate); a headless session reuses it.
#
# Environment:
#   USER_SESSION_CWD          folder the session runs in (default: <out-dir>/work), e.g. one holding a CSV
#   USER_SESSION_MAX_USD      model spend cap for the session (default 1)
#   USER_SESSION_MODEL        the model the session uses (default sonnet)
#   USER_SESSION_ALLOW        extra --allowedTools entries, e.g. Bash(agentic-id:*) to let it use the CLI
#   USER_SESSION_EXTRA        extra claude flags (default: --no-chrome). Do not pass --strict-mcp-config:
#                             it also drops this plugin's own server.
#
# Writes into <out-dir>:
#   answer.txt     what Claude said to the user
#   tools.jsonl    one line per tool call: name, input, whether it was an error, and the result
#   raw.jsonl      the full event stream
set -euo pipefail
OUT="${1:?usage: user-session.sh <out-dir> \"<prompt>\"}"; PROMPT="${2:?give the prompt}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"; PLUGIN="$ROOT/plugins/agentic-id"
mkdir -p "$OUT"; OUT="$(cd "$OUT" && pwd)"
WORK="${USER_SESSION_CWD:-$OUT/work}"; mkdir -p "$WORK"
PREFIX="mcp__plugin_agentic-id_agentic-id__"; allowed="Read,Glob,Grep,Skill,Task,Write${USER_SESSION_ALLOW:+,$USER_SESSION_ALLOW}"
for v in validate resolve enrich find discover lookalike facts ledger feedback; do allowed+=",${PREFIX}${v}"; done
cd "$WORK"
set +e
printf "%s" "$PROMPT" | \
  claude -p --plugin-dir "$PLUGIN" --output-format stream-json --verbose \
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
echo "session exit $status; $(wc -l < "$OUT/tools.jsonl" | tr -d ' ') tool call(s); answer in $OUT/answer.txt"
exit $status
