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
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { estimate } from '../server/lib/estimate.mjs';
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

/** The most a call could spend: its own max_credits, or the list-price estimate when it carries none. 0 for a free call. */
export function worstCase(payload) {
  const parsed = parseToolName(payload?.tool_name);
  if (!parsed || FREE.has(parsed.verb)) return 0;
  const input = payload.tool_input && typeof payload.tool_input === 'object' ? payload.tool_input : {};
  if (parsed.verb === 'discover' && input.count_only === true) return 0;
  if (parsed.verb === 'list' && (input.dry_run === true || input.action === 'report')) return 0;
  if (typeof input.max_credits === 'number' && input.max_credits >= 0) return input.max_credits;
  if (parsed.verb === 'list') return Infinity; // a paid file run with no cap is refused by the tool anyway
  try {
    return estimate(parsed.verb, input)?.max_credits ?? Infinity;
  } catch {
    return Infinity;
  }
}

/** null to let the call through, or the reason it is denied. */
export function decide(payload, budget, spent) {
  if (!budget || !payload || typeof payload !== 'object') return null;
  const cost = worstCase(payload);
  if (cost === 0) return null;
  const left = budget - spent;
  if (left <= 0) return `The Agentic ID session budget of ${budget} credits is spent (${spent} charged so far in this session). Tell the user the total and ask before going further; they can raise "Session credit budget" in the plugin options.`;
  if (cost > left) return `This call could spend ${Number.isFinite(cost) ? `up to ${cost} credits` : 'an unbounded number of credits (it has no max_credits)'}, more than what is left of the ${budget}-credit session budget (${left} left, ${spent} charged so far). Set max_credits to ${left} or less, or ask the user to raise "Session credit budget" in the plugin options.`;
  return null;
}

export function confirmAboveFrom(env = process.env) {
  const raw = env.AGENTIC_ID_CONFIRM_ABOVE ?? env.CLAUDE_PLUGIN_OPTION_CONFIRM_ABOVE ?? env.CLAUDE_PLUGIN_OPTION_confirm_above;
  const text = String(raw ?? '').trim();
  if (text === '' || text.startsWith('${')) return 10;
  const n = Number(text);
  return Number.isFinite(n) && n >= 0 ? n : 10;
}

/**
 * The person at the keyboard approves any call that could spend more than `threshold` credits:
 * Claude Code shows them the amount. null when no approval is needed.
 */
export function needsConfirmation(payload, threshold, spent = 0) {
  const cost = worstCase(payload);
  if (cost === 0) return null;
  // Many small calls add up: ask again each time the session's spend would cross another
  // `threshold` credits (10, 20, 30 ... by default), so a run of 1-credit calls is not unattended.
  // Past, not onto: with a threshold of 10, the tenth credit goes through and the eleventh asks.
  if (cost <= threshold && threshold > 0 && Number.isFinite(cost) && spent > 0 && Math.ceil((spent + cost) / threshold) > Math.ceil(spent / threshold)) {
    return `Agentic ID: this session has spent ${spent} credits and this call may add up to ${cost}. Approve to go past ${Math.ceil(spent / threshold) * threshold} credits in this session (change "Ask before spending more than" in the plugin options).`;
  }
  if (cost <= threshold) return null;
  return `Agentic ID: this call may spend ${Number.isFinite(cost) ? `up to ${cost} credits` : 'credits with no upper limit'}. Calls above ${threshold} credits need your approval (change "Ask before spending more than" in the plugin options).`;
}

function logDenied(payload, error) {
  try {
    const parsed = parseToolName(payload.tool_name);
    const dir = configDir();
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    appendFileSync(join(dir, 'usage.jsonl'), `${JSON.stringify({ ts: new Date().toISOString(), session_id: payload.session_id ?? null, server: parsed?.server ?? null, tool: parsed?.verb ?? null, ok: false, error, request_id: null, quoted_credits: null, credits_charged: 0 })}\n`, { mode: 0o600 });
  } catch {
    /* the log is best effort */
  }
}

async function main() {
  try {
    const chunks = [];
    for await (const c of process.stdin) chunks.push(c);
    const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const budget = budgetFrom();
    const denied = budget ? decide(payload, budget, spentInSession(payload.session_id)) : null;
    if (denied) {
      logDenied(payload, 'budget_denied');
      process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: denied } }));
      return;
    }
    const ask = needsConfirmation(payload, confirmAboveFrom(), spentInSession(payload.session_id));
    if (ask) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: ask } }));
  } catch {
    /* never block a call because the guard itself failed */
  }
}

if (process.argv[1]?.endsWith('budget-guard.mjs')) await main();
