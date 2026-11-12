#!/usr/bin/env node
// PreToolUse hook: an optional credit budget for one Claude Code session.
//
// When the plugin option "Session credit budget" is set (or AGENTIC_ID_SESSION_BUDGET), a paid
// Agentic ID call is denied once the calls already logged for this session have charged that
// many credits, or when its own max_credits would take the session past the budget. Free calls
// (facts, ledger, estimate, status, discover with count_only) always pass.
//
// It reads the local usage log written by log-usage.mjs: tool, credits, session id; no inputs.
// With no budget set, or on any error, it stays out of the way: exit 0, no output.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { configDir, parseToolName } from './log-usage.mjs';

const FREE = new Set(['facts', 'ledger', 'estimate', 'status', 'workspace', 'report', 'login']);

export function budgetFrom(env = process.env) {
  const raw = env.AGENTIC_ID_SESSION_BUDGET ?? env.CLAUDE_PLUGIN_OPTION_SESSION_BUDGET ?? env.CLAUDE_PLUGIN_OPTION_session_budget;
  const n = Number(String(raw ?? '').trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function spentInSession(sessionId, dir = configDir()) {
  let total = 0;
  try {
    for (const line of readFileSync(join(dir, 'usage.jsonl'), 'utf8').split('\n')) {
      if (!line) continue;
      try {
        const r = JSON.parse(line);
        if (r.session_id === sessionId && typeof r.credits_charged === 'number') total += r.credits_charged;
      } catch {
        /* skip an unreadable line */
      }
    }
  } catch {
    /* no log yet: nothing spent */
  }
  return total;
}

/** null to let the call through, or the reason it is denied. */
export function decide(payload, budget, spent) {
  if (!budget || !payload || typeof payload !== 'object') return null;
  const parsed = parseToolName(payload.tool_name);
  if (!parsed || FREE.has(parsed.verb)) return null;
  const input = payload.tool_input && typeof payload.tool_input === 'object' ? payload.tool_input : {};
  if (parsed.verb === 'discover' && input.count_only === true) return null;
  const left = budget - spent;
  if (left <= 0) return `The Agentic ID session budget of ${budget} credits is spent (${spent} charged so far in this session). Tell the user the total and ask before going further; they can raise "Session credit budget" in the plugin options. Free tools (facts, ledger, estimate, status, discover with count_only) still work.`;
  const cap = typeof input.max_credits === 'number' ? input.max_credits : null;
  if (cap !== null && cap > left) return `This call's max_credits (${cap}) is more than what is left of the ${budget}-credit session budget (${left} left, ${spent} charged so far). Lower max_credits to ${left} or less, or ask the user to raise the budget.`;
  return null;
}

async function main() {
  try {
    const budget = budgetFrom();
    if (!budget) return;
    const chunks = [];
    for await (const c of process.stdin) chunks.push(c);
    const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const reason = decide(payload, budget, spentInSession(payload.session_id));
    if (reason) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }));
  } catch {
    /* never block a call because the guard itself failed */
  }
}

if (process.argv[1]?.endsWith('budget-guard.mjs')) await main();
