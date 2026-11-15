#!/usr/bin/env node
// Agentic ID as MCP tools over stdio, calling the V3 public API. No dependencies: Node 18+ only.
//
//   { "mcpServers": { "agentic-id": { "command": "node", "args": ["<plugin>/server/mcp.mjs"],
//       "env": { "AGENTIC_ID_API_KEY": "...", "AGENTIC_ID_URL": "https://..." } } } }
//
// Speaks JSON-RPC 2.0, one message per line. stdout carries protocol messages only; anything
// else goes to stderr. Each tool answers with a one-line summary followed by the full answer as
// JSON, and the same answer as structured content.
import { appendFileSync, mkdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { AgenticId, AgenticIdError, CLIENT , rememberUrl } from './lib/client.mjs';
import { TOOLS, byName } from './lib/tools.mjs';

const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const INSTRUCTIONS = [
  'Agentic ID resolves work identities and companies to one stable ID and says how sure it is about every value (verified, corroborated, claimed, contradicted).',
  'Use these tools for any request to check an email, identify or enrich a person or company, find people at a company, or build a list of companies. Never answer such a request from memory: a list of companies or people you were not given by a tool is invented.',
  'SPENDING. Free: status, workspace, facts, ledger, estimate, report, login, discover with count_only, list with dry_run. Everything else costs credits. Before any paid discover, always run it once with count_only: true (free), even when the user already gave a budget, and say how many match.',
  'Before any call that could cost more than 10 credits, the user must have given a number of credits in their own words. "Go ahead", "I don\'t care what it costs" or a count of companies is not a budget: show the arithmetic (estimate, or a free count) and ask for a number. Never pick max_credits yourself above what the user said. If the user gave a budget, use it without asking again.',
  'Set max_credits on every paid call. Afterwards say what was charged (cost.charged_credits), in credits. For "what did I spend" or "what was that charge for", call agentic_id_workspace: it is the billing record; the local usage log is not.',
  'ANSWERS. Say only what a tool returned. Do not add facts about a company or person from memory, and do not guess dates or ages. When fewer results came back than asked, say why (excluded, fewer_than_asked, rejected). "confidence" on a resolve is how sure the identifier points at that ID, not how verified its facts are.',
  'Speak plainly: no tool names, error codes, provider names or scope names unless the user asks. Never name the data sources or vendors behind Agentic ID, even if a result seems to.',
  'If a result says source_unavailable or an error is source.unavailable, a data source behind Agentic ID was down: say so in one line, say what was charged (usually nothing), and do not retry in a loop or blame the user\'s account. A run marked partial did not reach every row: say how many were done and how many were not, never that it is done.',
  'Work identities only: never send personal emails or phone numbers; say they were held back.',
  'SIGN-IN AND KEYS. If a call says the user is not signed in, start sign-in yourself straight away: call agentic_id_login and show the link it returns; do not just tell them to run a command. Never ask for, repeat, print or search for an API key, password or code, in files or the environment; if asked to show a key, say it cannot be shown and where it is managed.',
  'When the user says what happened to a value (bounced, replied, wrong person, confirmed), record it with agentic_id_report.',
  'Files: use agentic_id_list (dry_run first), not shell commands. Never overwrite or rewrite the user\'s original file yourself. If they want the result in the same file, call agentic_id_list with replace_original: true (it saves the original beside it first) and tell them both names. Row numbers in results count data rows (the first row under the header is 1): say "data row N". Report how many addresses were held back as personal.',
  'On a resolve, outcome "known" means Agentic ID already had this ID, not that this workspace held it; it costs 1 credit unless the workspace holds it.',
].join(' ');

export function createServer({ client = new AgenticId(), log = () => {} } = {}) {
  const result = (id, value) => ({ jsonrpc: '2.0', id, result: value });
  const failure = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

  // Claude Code's after-call hook does not run for a failed call, so failures are logged here:
  // the tool, the error code and the request ID. Never an input.
  function logFailure(tool, body) {
    if (process.env.AGENTIC_ID_NO_USAGE_LOG) return;
    try {
      const dir = process.env.AGENTIC_ID_CONFIG_DIR?.trim() || join(homedir(), '.agentic-id');
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      const code = typeof body?.error === 'string' && /^[a-z0-9_.]{1,64}$/i.test(body.error) ? body.error : 'error';
      appendFileSync(join(dir, 'usage.jsonl'), `${JSON.stringify({ ts: new Date().toISOString(), session_id: null, server: 'agentic-id', tool: String(tool).replace(/^agentic_id_/, ''), ok: false, error: code, request_id: typeof body?.request_id === 'string' ? body.request_id : null, quoted_credits: null, credits_charged: 0, logged_by: 'server' })}\n`, { mode: 0o600 });
    } catch {
      /* the log is best effort */
    }
  }

  async function callTool(params) {
    const tool = byName.get(params?.name);
    if (!tool) return { content: [{ type: 'text', text: `Unknown tool "${params?.name}". Tools: ${TOOLS.map((t) => t.name).join(', ')}.` }], isError: true };
    const args = params.arguments && typeof params.arguments === 'object' ? params.arguments : {};
    const unknown = Object.keys(args).filter((k) => !(k in tool.inputSchema.properties));
    if (unknown.length) {
      const body = { error: 'request.invalid', message: `Unknown argument${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}.`, fix: `Allowed: ${Object.keys(tool.inputSchema.properties).join(', ') || 'none'}.`, sent: false };
      return { content: [{ type: 'text', text: `Agentic ID refused: ${body.message} ${body.fix}\n${JSON.stringify(body)}` }], structuredContent: body, isError: true };
    }
    try {
      const reply = await tool.run(client, args);
      return { content: [{ type: 'text', text: `${reply.summary ?? 'Done.'}\n${JSON.stringify(reply)}` }], structuredContent: reply };
    } catch (e) {
      if (!(e instanceof AgenticIdError)) {
        log(`tool ${params.name} crashed: ${e?.stack ?? e}`);
        const body = { error: 'plugin_error', message: 'The Agentic ID plugin hit an unexpected error. Nothing more was sent.', fix: 'Try once more; if it repeats, report it with the tool name.' };
        return { content: [{ type: 'text', text: `${body.message}\n${JSON.stringify(body)}` }], structuredContent: body, isError: true };
      }
      const body = e.toJSON();
      const where = e.local ? 'Not sent' : e.code === 'source.unavailable' ? 'Agentic ID could not answer' : e.status ? `Agentic ID refused (${e.status})` : 'Agentic ID did not answer';
      logFailure(params.name, body);
      return { content: [{ type: 'text', text: `${where}: ${body.message}${body.fix ? ` ${body.fix}` : ''}\n${JSON.stringify(body)}` }], structuredContent: body, isError: true };
    }
  }

  /** One JSON-RPC message in, one answer out (or undefined for a notification). */
  async function handle(msg) {
    if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return msg?.id !== undefined && msg?.method === undefined ? undefined : failure(msg?.id ?? null, -32600, 'Invalid request');
    const { id, method, params } = msg;
    if (id === undefined) return undefined; // notifications (initialized, cancelled, ...) need no answer
    switch (method) {
      case 'initialize':
        return result(id, {
          protocolVersion: PROTOCOLS.includes(params?.protocolVersion) ? params.protocolVersion : PROTOCOLS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'agentic-id', title: 'Agentic ID', version: CLIENT.split('/')[1] },
          instructions: INSTRUCTIONS,
        });
      case 'ping':
        return result(id, {});
      case 'tools/list':
        return result(id, { tools: TOOLS.map(({ run: _run, ...t }) => t) });
      case 'tools/call':
        return result(id, await callTool(params));
      case 'resources/list':
        return result(id, { resources: [] });
      case 'resources/templates/list':
        return result(id, { resourceTemplates: [] });
      case 'prompts/list':
        return result(id, { prompts: [] });
      default:
        return failure(id, -32601, `Method not found: ${method}`);
    }
  }

  return { handle, callTool };
}

export async function serve({ input = process.stdin, output = process.stdout, client } = {}) {
  const log = (line) => process.stderr.write(`[agentic-id] ${line}\n`);
  // So the `agentic-id` command, run from a shell inside the same Claude Code, talks to the same server.
  if (!client) rememberUrl();
  const server = createServer({ client, log });
  const send = (m) => output.write(`${JSON.stringify(m)}\n`);
  const pending = new Set();
  const rl = createInterface({ input, crlfDelay: Infinity });
  rl.on('line', (line) => {
    if (!line.trim()) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
      return;
    }
    // Tool calls run side by side; answers go out as each one finishes.
    const work = (Array.isArray(msg) ? Promise.all(msg.map(server.handle)).then((r) => r.filter(Boolean)).then((r) => (r.length ? r : undefined)) : server.handle(msg))
      .then((answer) => answer && send(answer))
      .catch((e) => log(`unhandled: ${e?.stack ?? e}`))
      .finally(() => pending.delete(work));
    pending.add(work);
  });
  await new Promise((done) => rl.once('close', done));
  await Promise.all(pending);
}

const isMain = (() => {
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();
if (isMain) await serve();
