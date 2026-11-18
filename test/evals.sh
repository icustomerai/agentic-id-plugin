#!/usr/bin/env bash
# Runs the plugin's skill evals (plugins/agentic-id/evals) with `claude plugin eval`.
#
# The Agentic ID tools (the hosted server's: validate, resolve, enrich, find, discover, lookalike,
# facts, ledger, feedback) answer from the mocks in evals/mocks/agentic-id/, so no sign-in, no
# credits and no real data are involved. Model and judge calls still cost money: the run stops at
# EVAL_MAX_COST_USD (list price).
#
# Reports are never published: --no-publish is always passed, because company policy forbids
# sharing eval output outside the company.
#
#   ./test/evals.sh                         # every case, 3 runs each, with/without-plugin ablation
#   ./test/evals.sh --tag triggering        # extra flags go straight to `claude plugin eval`
#   EVAL_QUICK=1 ./test/evals.sh            # 1 run per case, no ablation: a fast smoke check
#
# Optional:
#   EVAL_MAX_COST_USD   cost ceiling for the run (default 10)
#   EVAL_THRESHOLD      fail if any case scores below this (default 0.8)
#   EVAL_MODEL          pin the model under test (recommended in CI)
#   EVAL_JUDGE_MODEL    pin the judge model (recommended in CI)
#
# Needs a Claude Code build with `claude plugin eval` (check: `claude plugin eval --help`).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGIN="$ROOT/plugins/agentic-id"

command -v claude >/dev/null || { echo "claude CLI not found"; exit 1; }

args=(plugin eval "$PLUGIN" --no-publish
  --max-cost-usd "${EVAL_MAX_COST_USD:-10}"
  --threshold "${EVAL_THRESHOLD:-0.8}"
  --json "$ROOT/test/eval-results.json")

[ -n "${EVAL_MODEL:-}" ] && args+=(--model "$EVAL_MODEL")
[ -n "${EVAL_JUDGE_MODEL:-}" ] && args+=(--judge-model "$EVAL_JUDGE_MODEL")
[ "${EVAL_QUICK:-0}" = "1" ] && args+=(--runs 1 --ablation none)

echo "== claude ${args[*]} $*"
exec claude "${args[@]}" "$@"
