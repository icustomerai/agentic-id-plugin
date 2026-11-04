#!/usr/bin/env bash
# Static checks for the OneSource plugin marketplace. No network, no credits, no secrets.
#   1. `claude plugin validate` on the marketplace and the plugin (skipped if unavailable)
#   2. every *.json file parses
#   3. skills, agents and commands carry frontmatter with a description
#   4. .mcp.json ships no static headers and no secret-looking values
#   5. unit tests for the usage hook, the usage summary and the headers helper
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGIN="$ROOT/plugins/onesource"
failures=0
pass() { printf '  ok    %s\n' "$1"; }
fail() { printf '  FAIL  %s\n' "$1"; failures=$((failures + 1)); }
skip() { printf '  skip  %s\n' "$1"; }

command -v node >/dev/null 2>&1 || { echo "node is required"; exit 1; }

echo "== claude plugin validate"
if command -v claude >/dev/null 2>&1 && claude plugin validate --help >/dev/null 2>&1; then
  for target in "$ROOT" "$PLUGIN"; do
    if out="$(claude plugin validate "$target" 2>&1)"; then
      pass "claude plugin validate ${target#"$ROOT"/}"
    else
      fail "claude plugin validate ${target#"$ROOT"/}"
    fi
    printf '%s\n' "$out" | sed 's/^/        /'
  done
else
  skip "claude CLI with 'plugin validate' not found"
fi

echo "== JSON files parse"
while IFS= read -r -d '' f; do
  if node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' "$f" 2>/dev/null; then
    pass "${f#"$ROOT"/}"
  else
    fail "${f#"$ROOT"/} is not valid JSON"
  fi
done < <(find "$ROOT" -name '*.json' -not -path '*/.git/*' -not -path '*/node_modules/*' -print0)

echo "== frontmatter"
for f in "$PLUGIN"/skills/*/SKILL.md "$PLUGIN"/agents/*.md "$PLUGIN"/commands/*.md; do
  if node -e '
    const t = require("fs").readFileSync(process.argv[1], "utf8");
    const m = t.match(/^---\n([\s\S]*?)\n---\n/);
    if (!m || !/^description:\s*\S/m.test(m[1])) process.exit(1);
    if (/SKILL\.md$|agents\//.test(process.argv[1]) && !/^name:\s*\S/m.test(m[1])) process.exit(1);
  ' "$f"; then pass "${f#"$ROOT"/}"; else fail "${f#"$ROOT"/} frontmatter needs name/description"; fi
done

echo "== no static secrets"
if node -e '
  const c = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  for (const s of Object.values(c.mcpServers)) if (s.headers) process.exit(1);
' "$PLUGIN/.mcp.json"; then pass ".mcp.json has no static headers"; else fail ".mcp.json must not carry static headers"; fi
if grep -RInE --exclude-dir=.git '(x-api-key"?\s*[:=]\s*"[A-Za-z0-9_-]{16,})|(sk-[A-Za-z0-9]{20,})|(os_(live|test)_[A-Za-z0-9]{8,})' "$ROOT" >/dev/null; then
  fail "secret-looking value found in the repo"
else
  pass "no secret-looking values in the repo"
fi

echo "== unit tests (node --test)"
if node --test "$ROOT/test/log-usage.test.mjs" 2>&1 | sed 's/^/        /'; [ "${PIPESTATUS[0]}" -eq 0 ]; then
  pass "log-usage.mjs, usage-summary.mjs, api-key-headers.mjs"
else
  fail "unit tests"
fi

echo
if [ "$failures" -eq 0 ]; then echo "validate.sh: all checks passed"; else echo "validate.sh: $failures check(s) failed"; fi
exit "$([ "$failures" -eq 0 ] && echo 0 || echo 1)"
