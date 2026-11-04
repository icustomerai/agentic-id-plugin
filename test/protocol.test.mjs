#!/usr/bin/env node
// Protocol test: does what Claude Code does with this plugin, without a model in the loop.
//   1. reads plugins/onesource/.mcp.json and expands the URL the way Claude Code does;
//   2. runs the plugin's headersHelper (with an API key in a temp config dir, as in plugin mode);
//   3. speaks MCP over Streamable HTTP: initialize, tools/list, then calls the tools;
//   4. feeds each real tool answer to the plugin's PostToolUse hook and checks the usage line.
//
// Needs a running OneSource server. Usage:
//   ONESOURCE_MCP_URL=http://127.0.0.1:3000/mcp ONESOURCE_API_KEY=<key> node test/protocol.test.mjs
// Spends about 3 credits on the target server (validate 1 + enrich-by-identifier estimate; resolve
// is free). Set PROTOCOL_PAID=0 to skip the paid calls.
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PLUGIN = join(ROOT, 'plugins/onesource');
const EMAIL = process.env.E2E_EMAIL ?? 'jenish@icustomer.ai';
const PAID = process.env.PROTOCOL_PAID !== '0';

let failures = 0;
const check = (ok, label, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

if (!process.env.ONESOURCE_API_KEY) {
  console.error('Set ONESOURCE_API_KEY (and ONESOURCE_MCP_URL) to run the protocol test.');
  process.exit(2);
}

// 1. URL from the plugin's own .mcp.json, ${VAR:-default} expanded.
const server = JSON.parse(readFileSync(join(PLUGIN, '.mcp.json'), 'utf8')).mcpServers.onesource;
const url = server.url.replace(/\$\{(\w+):-([^}]*)\}/g, (_m, name, fallback) => process.env[name] || fallback);
check(server.type === 'http' && !server.headers, '.mcp.json is http with no static headers');

// 2. headersHelper, run with a key file in a temp config dir and credential env vars scrubbed (as
//    Claude Code does for plugin helpers).
const cfg = mkdtempSync(join(tmpdir(), 'onesource-protocol-'));
writeFileSync(join(cfg, 'api-key'), `${process.env.ONESOURCE_API_KEY}\n`);
chmodSync(join(cfg, 'api-key'), 0o600);

const helperEnv = { PATH: process.env.PATH, HOME: process.env.HOME, CLAUDE_PLUGIN_ROOT: PLUGIN, ONESOURCE_CONFIG_DIR: cfg };
const helperCmd = server.headersHelper.replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, PLUGIN);
const helper = spawnSync('/bin/sh', ['-c', helperCmd], { env: helperEnv, encoding: 'utf8' });
let headers = {};

try {
  headers = JSON.parse(helper.stdout);
} catch {
  /* checked below */
}
check(helper.status === 0 && typeof headers['x-api-key'] === 'string', 'headersHelper returns the key from the config dir');
check(headers['x-onesource-client'] === 'plugin/0.1.0', 'headersHelper labels the client as the plugin');

// 3. MCP over Streamable HTTP.
let nextId = 1;

async function rpc(method, params) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18', ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
  });
  const text = await res.text();
  // A Streamable HTTP server may answer as JSON or as one SSE event.
  const json = text.trim().startsWith('{') ? text : text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).join('');

  return { status: res.status, body: json ? JSON.parse(json) : null };
}

const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'onesource-plugin-protocol-test', version: '0.1.0' } });
check(init.status === 200 && init.body?.result?.serverInfo, 'initialize', `${init.status} ${init.body?.result?.serverInfo?.name ?? JSON.stringify(init.body?.error ?? '')}`);

const list = await rpc('tools/list', {});
const names = (list.body?.result?.tools ?? []).map((t) => t.name).sort();
check(['validate', 'resolve', 'enrich', 'find', 'discover'].every((v) => names.some((n) => n.endsWith(v))), 'tools/list has the five verbs', names.join(', '));

const toolName = (verb) => names.find((n) => n.endsWith(verb));
const hook = join(PLUGIN, 'hooks/log-usage.mjs');

async function callAndLog(verb, args) {
  const res = await rpc('tools/call', { name: toolName(verb), arguments: args });
  const result = res.body?.result;
  const structured = result?.structuredContent ?? null;

  // 4. The PostToolUse hook, with the payload Claude Code would send for this plugin tool.
  const payload = {
    session_id: 'protocol-test',
    hook_event_name: 'PostToolUse',
    tool_name: `mcp__plugin_onesource_onesource__${toolName(verb)}`,
    tool_input: args,
    tool_response: result,
  };
  const ran = spawnSync(process.execPath, [hook], { input: JSON.stringify(payload), env: { ...helperEnv }, encoding: 'utf8' });

  return { res, result, structured, hookStatus: ran.status };
}

const free = await callAndLog('resolve', { identifiers: { email: EMAIL }, max_credits: 1 });
check(!free.result?.isError && free.structured, 'resolve answers', free.structured?.summary ?? JSON.stringify(free.result?.content?.[0]?.text ?? free.res.body?.error).slice(0, 160));
check(typeof free.structured?.request_id === 'string', 'answers carry a request_id for the trace');

const rejected = await callAndLog('validate', { identifiers: { email: 'test@example.com' }, max_credits: 1 });
check(rejected.result?.isError === true && /invalid_input/.test(rejected.result?.content?.[0]?.text ?? ''), 'a placeholder email is refused before any lookup');

if (PAID) {
  const paid = await callAndLog('validate', { identifiers: { email: EMAIL }, max_credits: 1 });
  check(!paid.result?.isError && /valid|invalid|catch-all|unknown|risky/.test(paid.structured?.summary ?? ''), 'validate answers with a status', paid.structured?.summary ?? '');
  check(paid.structured?.cost?.charged_credits <= 1, 'validate stays within max_credits', JSON.stringify(paid.structured?.cost));
}

// The usage log: one line per call, nothing from the inputs.
let lines = [];

try {
  lines = readFileSync(join(cfg, 'usage.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
} catch {
  /* checked below */
}
check(lines.length === (PAID ? 3 : 2), 'the usage hook wrote one line per call', `${lines.length} line(s)`);
check(!readFileSync(join(cfg, 'usage.jsonl'), 'utf8').includes(EMAIL), 'the usage log holds no email');
check(lines.some((l) => l.request_id), 'usage lines carry the request_id', lines.map((l) => `${l.tool}:${l.credits_charged ?? '-'}`).join(' '));

rmSync(cfg, { recursive: true, force: true });
console.log(failures ? `protocol test: ${failures} check(s) failed` : 'protocol test: all checks passed');
process.exit(failures ? 1 : 0);
