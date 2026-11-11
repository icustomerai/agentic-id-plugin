#!/usr/bin/env node
// Agentic ID as MCP tools over stdio, calling the V3 public API. No dependencies: Node 18+ only.
//
//   { "mcpServers": { "agentic-id": { "command": "node", "args": ["<plugin>/server/mcp.mjs"],
//       "env": { "AGENTIC_ID_API_KEY": "...", "AGENTIC_ID_URL": "https://..." } } } }
//
// Speaks JSON-RPC 2.0, one message per line. stdout carries protocol messages only; anything
// else goes to stderr. Each tool answers with a one-line summary followed by the full answer as
// JSON, and the same answer as structured content.
import { realpathSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { AgenticId, AgenticIdError, CLIENT } from './lib/client.mjs';
import { TOOLS, byName } from './lib/tools.mjs';

const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const INSTRUCTIONS =
  'Agentic ID resolves B2B people and companies to one stable ID and says how sure it is about every value (verified, corroborated, claimed, contradicted). ' +
  'Order of use: validate, resolve, enrich, find, discover, lookalike; stop when the question is answered. ' +
  'Free: facts, ledger, estimate, status, and discover with count_only. Set max_credits on every paid call and report cost.charged_credits afterwards. ' +
  'B2B only: never send personal emails or phone numbers. Never invent a person, title or email; an empty answer means Agentic ID does not know.';

export function createServer({ client = new AgenticId(), log = () => {} } = {}) {
  const result = (id, value) => ({ jsonrpc: '2.0', id, result: value });
  const failure = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

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
      const where = e.local ? 'Not sent' : e.status ? `Agentic ID refused (${e.status})` : 'Agentic ID did not answer';
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
