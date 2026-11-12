#!/usr/bin/env node
// Protocol test: does what Claude Code does with this plugin, without a model in the loop.
//   1. reads plugins/agentic-id/.mcp.json and fills its ${user_config.*} and ${CLAUDE_PLUGIN_ROOT}
//      references the way Claude Code does;
//   2. starts the server it names and speaks MCP over stdio: initialize, tools/list, tool calls;
//   3. feeds each real tool answer to the plugin's PostToolUse hook and checks the usage line.
//
// Needs a running Agentic ID V3 API. Usage:
//   AGENTIC_ID_URL=http://127.0.0.1:3100 AGENTIC_ID_API_KEY_FILE=<file with the key> node test/protocol.test.mjs
//
// Free calls only by default (status, estimate, discover count, facts, ledger, local refusals).
// PROTOCOL_PAID=1 adds one resolve of a company domain (1 credit at most, no provider is asked).
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { keyFromEnv } from '../plugins/agentic-id/server/lib/client.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PLUGIN = join(ROOT, 'plugins/agentic-id');
const PAID = process.env.PROTOCOL_PAID === '1';
const DOMAIN = process.env.E2E_DOMAIN ?? 'stripe.com';

let failures = 0;
const check = (ok, label, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

const apiKey = keyFromEnv();
if (!apiKey) {
  console.error('Set AGENTIC_ID_API_KEY or AGENTIC_ID_API_KEY_FILE (and AGENTIC_ID_URL) to run the protocol test.');
  process.exit(2);
}

// 1. The server entry from the plugin's own .mcp.json, with the user's options filled in.
const manifest = JSON.parse(readFileSync(join(PLUGIN, '.claude-plugin/plugin.json'), 'utf8'));
const entry = JSON.parse(readFileSync(join(PLUGIN, '.mcp.json'), 'utf8')).mcpServers['agentic-id'];
const options = { api_key: apiKey, api_url: process.env.AGENTIC_ID_URL };
const fill = (value) =>
  value.replaceAll('${CLAUDE_PLUGIN_ROOT}', PLUGIN).replace(/\$\{user_config\.(\w+)\}/g, (_m, key) => {
    if (!(key in manifest.userConfig)) throw new Error(`.mcp.json references undeclared option ${key}`);
    return options[key] ?? manifest.userConfig[key].default ?? '';
  });

check(entry.command === 'node' && entry.args.length === 1 && entry.args[0] === '${CLAUDE_PLUGIN_ROOT}/server/mcp.mjs', '.mcp.json starts the bundled server with node, nothing downloaded');
check(entry.env.AGENTIC_ID_API_KEY === '${user_config.api_key}' && manifest.userConfig.api_key.sensitive === true, 'the API key comes only from a sensitive userConfig option');
check(!JSON.stringify(entry).includes(apiKey), 'no key is written in .mcp.json');

const cfg = mkdtempSync(join(tmpdir(), 'agentic-id-protocol-'));
const hookEnv = { PATH: process.env.PATH, HOME: process.env.HOME, CLAUDE_PLUGIN_ROOT: PLUGIN, AGENTIC_ID_CONFIG_DIR: cfg };

// 2. MCP over stdio.
const child = spawn(entry.command, entry.args.map(fill), { env: { PATH: process.env.PATH, HOME: process.env.HOME, AGENTIC_ID_CONFIG_DIR: cfg, ...Object.fromEntries(Object.entries(entry.env).map(([k, v]) => [k, fill(v)])) }, stdio: ['pipe', 'pipe', 'pipe'] });
let stderr = '';
child.stderr.on('data', (d) => (stderr += d));
const waiting = new Map();
const stray = [];
createInterface({ input: child.stdout }).on('line', (line) => {
  try {
    const msg = JSON.parse(line);
    waiting.get(msg.id)?.(msg);
    waiting.delete(msg.id);
  } catch {
    stray.push(line);
  }
});
let nextId = 1;
const rpc = (method, params) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => reject(new Error(`${method} timed out`)), 120_000);
    waiting.set(id, (m) => (clearTimeout(timer), resolve(m)));
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
const call = async (name, args) => (await rpc('tools/call', { name, arguments: args })).result;

function runHook(toolName, toolResponse) {
  const payload = { session_id: 'protocol-test', hook_event_name: 'PostToolUse', tool_name: toolName, tool_input: { redacted: true }, tool_response: toolResponse };
  return spawnSync('node', [join(PLUGIN, 'hooks/log-usage.mjs')], { input: JSON.stringify(payload), env: hookEnv, encoding: 'utf8' });
}
const lastLog = () => JSON.parse(readFileSync(join(cfg, 'usage.jsonl'), 'utf8').trim().split('\n').at(-1));
const prefixed = (tool) => `mcp__plugin_agentic-id_agentic-id__${tool}`;

try {
  const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'protocol-test', version: '1' } });
  check(init.result?.serverInfo?.name === 'agentic-id' && init.result.protocolVersion === '2025-06-18', 'initialize', `${init.result?.serverInfo?.name} ${init.result?.serverInfo?.version}`);
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);

  const tools = (await rpc('tools/list')).result.tools.map((t) => t.name);
  const expected = ['validate', 'resolve', 'resolve_many', 'enrich', 'find', 'discover', 'lookalike', 'facts', 'ledger', 'workspace', 'report', 'list', 'login', 'estimate', 'status'].map((v) => `agentic_id_${v}`);
  check(expected.every((t) => tools.includes(t)) && tools.length === expected.length, `tools/list returns the ${expected.length} tools`, tools.join(', '));

  const status = await call('agentic_id_status', {});
  check(status.structuredContent?.ok === true, 'status: connected with the configured key', status.structuredContent?.summary);
  check(!JSON.stringify(status).includes(apiKey), 'status never echoes the key');

  const count = await call('agentic_id_discover', { account_filters: { country: ['UK'], industry: ['software'], employees_min: 100, employees_max: 2000 }, count_only: true });
  const c = count.structuredContent;
  check(!count.isError && c?.cost?.charged_credits === 0 && typeof c.request_id === 'string', 'discover count_only: free, with a request id', c?.summary);
  let hook = runHook(prefixed('agentic_id_discover'), count);
  let rec = lastLog();
  check(hook.status === 0 && rec.tool === 'discover' && rec.ok === true && rec.credits_charged === 0 && rec.request_id === c.request_id, 'hook logs the discover count', JSON.stringify(rec));

  const held = await call('agentic_id_validate', { emails: ['someone@gmail.com', 'not-an-email'] });
  check(!held.isError && held.structuredContent.request_id === null && held.structuredContent.results.every((r) => r.verdict === 'rejected'), 'validate: personal and malformed addresses are answered locally, nothing sent');

  const refused = await call('agentic_id_discover', { account_filters: { country: ['GB'] } });
  check(refused.isError === true && refused.structuredContent.error === 'cap_required' && refused.structuredContent.sent === false, 'discover without a cap is refused before it is sent');
  hook = runHook(prefixed('agentic_id_discover'), refused);
  rec = lastLog();
  check(rec.ok === false && rec.error === 'cap_required' && rec.credits_charged === 0, 'hook logs the refusal with its code and 0 credits', JSON.stringify(rec));

  const bad = await call('agentic_id_find', { account: { domain: DOMAIN }, roles: ['CTO'], limit: 1, max_credits: 0 });
  check((bad.structuredContent?.cost?.charged_credits ?? 0) === 0, 'find with max_credits 0 charges nothing', bad.structuredContent?.summary ?? bad.structuredContent?.message);

  const facts = await call('agentic_id_facts', { id: 'ic-doesNotExist000000000' });
  check(facts.isError === true && facts.structuredContent.error === 'id.not_held' && /holds/.test(facts.structuredContent.fix ?? ''), 'facts for an ID this workspace does not hold: refused, with what to do');
  const ledger = await call('agentic_id_ledger', { id: 'ic-doesNotExist000000000' });
  check(ledger.isError === true && ledger.structuredContent.error === 'id.not_held', 'ledger for an ID this workspace does not hold: refused');
  const ws = await call('agentic_id_workspace', {});
  check(!ws.isError && typeof ws.structuredContent.credits?.available === 'number' && /credits? available/.test(ws.structuredContent.summary), 'workspace: credits and spend', ws.structuredContent.summary);

  if (PAID) {
    const r = await call('agentic_id_resolve', { identifiers: { company_domain: `https://www.${DOMAIN}/` } });
    const s = r.structuredContent;
    check(!r.isError && ['known', 'new'].includes(s.outcome) && /^ic-/.test(s.id) && s.cost.charged_credits <= 1, `resolve ${DOMAIN}`, s.summary);
    runHook(prefixed('agentic_id_resolve'), r);
    rec = lastLog();
    check(rec.tool === 'resolve' && rec.credits_charged === s.cost.charged_credits && rec.request_id === s.request_id, 'hook logs the resolve with its credits', JSON.stringify(rec));
    const again = await call('agentic_id_resolve', { identifiers: { company_domain: DOMAIN.toUpperCase() } });
    check(again.structuredContent.id === s.id, 'the same company in another spelling gets the same ID');
    const history = await call('agentic_id_ledger', { id: s.id });
    check(history.structuredContent.verified === true && history.structuredContent.entries.length >= 1, 'its ledger chain verifies', history.structuredContent.summary);
    const heldFacts = await call('agentic_id_facts', { id: s.id });
    check(!heldFacts.isError && Array.isArray(heldFacts.structuredContent.facts), 'facts open for an ID the workspace holds');
    const rep = await call('agentic_id_report', { id: s.id, field: 'company_domain', outcome: 'confirmed' });
    check(!rep.isError && rep.structuredContent.recorded === 1 && rep.structuredContent.cost.charged_credits === 0, 'report: an outcome for a held ID is recorded, free', rep.structuredContent.summary);
    const many = await call('agentic_id_resolve_many', { records: [{ company_domain: DOMAIN }, { company_domain: `www.${DOMAIN}` }, { email: 'x@gmail.com' }], max_credits: 2 });
    const m = many.structuredContent;
    check(m.rows[1].repeat_of_row === 1 && m.rows[2].outcome === 'skipped' && m.cost.charged_credits <= 1, 'resolve_many: a repeat is paid once, a personal row is skipped', m.summary);
  } else console.log('SKIP  paid calls (set PROTOCOL_PAID=1 for a few resolves of one company, 3 credits at most)');

  const log = readFileSync(join(cfg, 'usage.jsonl'), 'utf8');
  check(!/gmail|stripe|@/.test(log), 'the usage log holds no input values');
  check(stray.length === 0, 'stdout carried protocol messages only', stray[0]);
} catch (e) {
  check(false, 'protocol run', `${e.message}${stderr ? ` | stderr: ${stderr.slice(0, 300)}` : ''}`);
} finally {
  child.stdin.end();
  rmSync(cfg, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} check(s) failed` : '\nprotocol test: all checks passed');
process.exit(failures ? 1 : 0);
