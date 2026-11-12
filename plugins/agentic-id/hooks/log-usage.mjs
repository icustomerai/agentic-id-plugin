#!/usr/bin/env node
// PostToolUse hook: append one JSON line per Agentic ID tool call to
// <AGENTIC_ID_CONFIG_DIR or ~/.agentic-id>/usage.jsonl.
//
// What is written: timestamp, session id, tool, outcome, error code, request id, quoted and
// charged credits. What is never written: tool inputs, names, emails, domains, summaries or any
// other value from the request or the answer (no PII).
//
// This hook must never get in the way of the tool: every path ends in exit 0 with no output.
import { appendFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const VERBS = new Set(['validate', 'resolve', 'resolve_many', 'enrich', 'find', 'discover', 'lookalike', 'facts', 'ledger', 'estimate', 'status', 'workspace', 'report']);
const REQUEST_ID_KEYS = ['request_id', 'requestId', 'x-request-id', 'x_request_id'];

// Reads one named variable only; the environment object is never passed around or enumerated.
export function configDir(dir = process.env.AGENTIC_ID_CONFIG_DIR) {
  return dir && dir.trim() ? dir.trim() : join(homedir(), '.agentic-id');
}

// mcp__plugin_agentic-id_agentic-id__agentic_id_validate -> { server, verb: 'validate' }
export function parseToolName(name) {
  if (typeof name !== 'string' || !name.startsWith('mcp__')) return null;
  const sep = name.lastIndexOf('__');
  if (sep <= 'mcp__'.length) return null;
  const server = name.slice('mcp__'.length, sep);
  const tool = name.slice(sep + 2);
  const verb = tool.replace(/^agentic[_-]id[_-]/, '');
  if (!VERBS.has(verb) || !/agentic[_-]id/i.test(server + tool)) return null;
  return { server, tool, verb };
}

function tryJson(text) {
  if (typeof text !== 'string') return null;
  try {
    return JSON.parse(text);
  } catch {
    // The server's text block is "<summary line>\n<pretty JSON>": parse from the first brace.
    const at = text.indexOf('{');
    if (at < 0) return null;
    try {
      return JSON.parse(text.slice(at));
    } catch {
      return null;
    }
  }
}

// The tool response can arrive as a CallToolResult object, a bare content array, a JSON string,
// or the structured content itself. Return { structured, isError } from whichever it is.
export function extractResult(response) {
  let value = response;
  if (typeof value === 'string') value = tryJson(value) ?? value;

  let isError = false;
  let content = null;
  let structured = null;

  if (Array.isArray(value)) {
    content = value;
  } else if (value && typeof value === 'object') {
    isError = value.isError === true || value.is_error === true;
    if (value.structuredContent && typeof value.structuredContent === 'object') structured = value.structuredContent;
    if (Array.isArray(value.content)) content = value.content;
    if (!structured && !content) structured = value;
  }

  if (!structured && content) {
    for (const block of content) {
      const parsed = tryJson(block && typeof block === 'object' ? block.text : block);
      if (parsed && typeof parsed === 'object') {
        structured = parsed;
        break;
      }
    }
  }

  if (structured && typeof structured.error === 'string' && !structured.cost) isError = true;
  return { structured, isError };
}

function findKey(obj, keys, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 4) return undefined;
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === 'string' && v.length > 0 && v.length <= 128) return v;
  }
  for (const v of Object.values(obj)) {
    if (v && typeof v === 'object') {
      const found = findKey(v, keys, depth + 1);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// Build the log record. Only whitelisted, non-identifying fields are copied.
export function buildRecord(payload, now = new Date()) {
  if (!payload || typeof payload !== 'object') return null;
  const parsed = parseToolName(payload.tool_name);
  if (!parsed) return null;

  const { structured, isError } = extractResult(payload.tool_response);
  const cost = structured && typeof structured.cost === 'object' ? structured.cost : null;
  const charged = num(cost?.charged_credits) ?? num(structured?.credits_charged);
  const quoted = num(cost?.quoted_credits);
  const errorCode = isError && typeof structured?.error === 'string' ? structured.error.slice(0, 64) : null;
  const requestId = findKey(structured, REQUEST_ID_KEYS) ?? null;
  const safeId = requestId && /^[A-Za-z0-9._:-]+$/.test(requestId) ? requestId : null;

  return {
    ts: now.toISOString(),
    session_id: typeof payload.session_id === 'string' ? payload.session_id.slice(0, 64) : null,
    server: parsed.server,
    tool: parsed.verb,
    ok: !isError,
    error: errorCode,
    request_id: safeId,
    quoted_credits: quoted,
    credits_charged: isError ? (charged ?? 0) : charged,
  };
}

export function appendRecord(record, dir = configDir()) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  appendFileSync(join(dir, 'usage.jsonl'), JSON.stringify(record) + '\n', { mode: 0o600 });
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  try {
    const raw = await readStdin();
    const record = buildRecord(JSON.parse(raw));
    if (record) appendRecord(record);
  } catch {
    // Never fail the tool call because of logging.
  }
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('log-usage.mjs')) {
  main();
}
