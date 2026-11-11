#!/usr/bin/env node
// Protocol test: does what Claude Code does with this plugin, without a model in the loop.
//   1. reads plugins/agentic-id/.mcp.json and fills its ${user_config.*} references the way Claude
//      Code does: api_key from AGENTIC_ID_API_KEY. The URL is the one fixed in .mcp.json, unless
//      AGENTIC_ID_MCP_URL points the test at another server;
//   2. speaks MCP over Streamable HTTP: initialize, tools/list, then calls the tools;
//   3. feeds each real tool answer to the plugin's PostToolUse hook and checks the usage line.
//
// Needs a running Agentic ID server. Usage:
//   AGENTIC_ID_MCP_URL=http://127.0.0.1:3000/mcp AGENTIC_ID_API_KEY=<key> node test/protocol.test.mjs
// Spends at most 1 credit on the target server (validate; resolve is free). Set PROTOCOL_PAID=0 to
// skip the paid call. E2E_EMAIL picks the work address to look up; the default is fictional.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PLUGIN = join(ROOT, 'plugins/agentic-id');
const EMAIL = process.env.E2E_EMAIL ?? 'maya.chen@tallpinesoftware.com';
const PAID = process.env.PROTOCOL_PAID !== '0';

let failures = 0;
const check = (ok, label, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

if (!process.env.AGENTIC_ID_API_KEY) {
  console.error('Set AGENTIC_ID_API_KEY (and AGENTIC_ID_MCP_URL) to run the protocol test.');
  process.exit(2);
}

// 1. The server entry from the plugin's own .mcp.json, with the user's options filled in.
const manifest = JSON.parse(readFileSync(join(PLUGIN, '.claude-plugin/plugin.json'), 'utf8'));
const server = JSON.parse(readFileSync(join(PLUGIN, '.mcp.json'), 'utf8')).mcpServers['agentic-id'];
const options = {
  api_key: process.env.AGENTIC_ID_API_KEY,
};
const fill = (value) =>
  value.replace(/\$\{user_config\.(\w+)\}/g, (_m, key) => {
    if (!(key in manifest.userConfig)) throw new Error(`.mcp.json references undeclared option ${key}`);
    return options[key] ?? manifest.userConfig[key].default ?? '';
  });

check(server.type === 'http' && /^https:\/\/[a-z0-9.-]+\/mcp$/.test(server.url) && !server.headersHelper, '.mcp.json: http server, fixed https URL, no headersHelper');
check(server.headers?.['x-api-key'] === '${user_config.api_key}' && manifest.userConfig.api_key.sensitive === true, 'the API key comes only from a sensitive userConfig option');

const url = process.env.AGENTIC_ID_MCP_URL || server.url;
const headers = Object.fromEntries(Object.entries(server.headers ?? {}).map(([k, v]) => [k, fill(v)]));
const cfg = mkdtempSync(join(tmpdir(), 'agentic-id-protocol-'));
const hookEnv = { PATH: process.env.PATH, HOME: process.env.HOME, CLAUDE_PLUGIN_ROOT: PLUGIN, AGENTIC_ID_CONFIG_DIR: cfg };

// 2. MCP over Streamable HTTP.
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

const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'agentic-id-protocol-test', version: '0.1.0' } });
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

  // 3. The PostToolUse hook, with the payload Claude Code would send for this plugin tool.
  const payload = {
    session_id: 'protocol-test',
    hook_event_name: 'PostToolUse',
    tool_name: `mcp__plugin_agentic-id_agentic-id__${toolName(verb)}`,
    tool_input: args,
    tool_response: result,
  };
  const ran = spawnSync(process.execPath, [hook], { input: JSON.stringify(payload), env: { ...hookEnv }, encoding: 'utf8' });

  return { res, result, structured, hookStatus: ran.status };
}

const free = await callAndLog('resolve', { identifiers: { email: EMAIL }, max_credits: 1 });
const freeText = free.result?.content?.[0]?.text ?? JSON.stringify(free.res.body?.error ?? '');
// A fictional address resolves to no_match, which is still a well-formed, free answer.
check(Boolean(free.structured) || /no_match|not_found/.test(freeText), 'resolve answers', free.structured?.summary ?? freeText.slice(0, 160));
if (free.structured) check(typeof free.structured.request_id === 'string', 'answers carry a request_id for the trace');

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
