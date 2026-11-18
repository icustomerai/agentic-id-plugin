#!/usr/bin/env node
// Static check of the eval suite (no model calls): every case has a prompt.md with a body and at
// least one grader; every grader has a known type and the fields that type needs; every mock is
// for a tool the hosted Agentic ID MCP server actually exposes, shaped like its answers (a one-line
// summary, then JSON); every _tools.json lists exactly those tools with an input schema; nothing
// looks like real PII.
//   node test/check-evals.mjs [plugins/agentic-id/evals]
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EVALS = process.argv[2] ?? join(ROOT, 'plugins/agentic-id/evals');
// The hosted server's tools (MCP ids mcp__plugin_agentic-id_agentic-id__<name>).
const TOOLS = ['validate', 'resolve', 'enrich', 'find', 'discover', 'lookalike', 'facts', 'ledger', 'feedback', 'credits'];
const GRADERS = {
  tool_used: ['tool'],
  tool_order: ['before', 'after'],
  regex: ['pattern'],
  llm: [],
  baseline: ['baseline_file'],
  file_exists: ['path'],
};

let failures = 0;
const fail = (file, why) => { failures += 1; console.log(`FAIL  ${relative(ROOT, file)}: ${why}`); };

function frontmatter(file) {
  const text = readFileSync(file, 'utf8');
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { fields: {}, body: text.trim(), ok: false };
  const fields = Object.fromEntries(m[1].split('\n').filter((l) => /^\w[\w-]*:/.test(l)).map((l) => {
    const i = l.indexOf(':');
    return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
  }));
  return { fields, body: m[2].trim(), ok: true };
}

const walk = (dir) => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? [p, ...walk(p)] : [];
});

const dirs = walk(EVALS).filter((d) => !d.split('/').includes('results'));
const cases = dirs.filter((d) => existsSync(join(d, 'prompt.md')) || existsSync(join(d, 'case.yaml')));
const mockDirs = dirs.filter((d) => /\/mocks\/agentic-id$/.test(d));

for (const c of cases) {
  const prompt = join(c, 'prompt.md');
  const p = frontmatter(prompt);
  if (!p.body) fail(prompt, 'empty prompt body');
  if (/(gmail|yahoo|outlook)\.com|\+1\s?\d{3}/.test(p.body) && !/privacy|personal/.test(p.fields.tags ?? '')) {
    fail(prompt, 'personal data in a prompt not tagged privacy');
  }
  const gdir = join(c, 'graders');
  const graders = existsSync(gdir) ? readdirSync(gdir).filter((f) => f.endsWith('.md')) : [];
  if (!graders.length) fail(c, 'no graders');
  for (const g of graders) {
    const file = join(gdir, g);
    const { fields, body, ok } = frontmatter(file);
    if (!ok) { fail(file, 'no frontmatter'); continue; }
    const need = GRADERS[fields.type];
    if (!need) { fail(file, `unknown grader type "${fields.type}"`); continue; }
    for (const f of need) if (!fields[f]) fail(file, `${fields.type} grader needs "${f}"`);
    if (fields.type === 'llm' && !body && !fields.criteria) fail(file, 'llm grader needs criteria (body)');
    for (const key of ['tool', 'before', 'after']) {
      const v = fields[key];
      if (v && v.startsWith('mcp__') && !TOOLS.some((t) => v === `mcp__plugin_agentic-id_agentic-id__${t}`)) fail(file, `unknown MCP tool ${v}`);
    }
    for (const key of ['input_match', 'pattern']) {
      if (!fields[key]) continue;
      try { new RegExp(fields[key].replace(/^'(.*)'$/, '$1')); } catch (e) { fail(file, `bad regex in ${key}: ${e.message}`); }
    }
  }
}

for (const d of mockDirs) {
  const toolsFile = join(d, '_tools.json');
  if (existsSync(toolsFile)) {
    try {
      const listed = JSON.parse(readFileSync(toolsFile, 'utf8')).tools ?? [];
      const names = listed.map((t) => t.name);
      for (const t of TOOLS) if (!names.includes(t)) fail(toolsFile, `missing tool ${t}`);
      for (const t of listed) {
        if (!TOOLS.includes(t.name)) fail(toolsFile, `tool the server does not expose: ${t.name}`);
        if (t.inputSchema?.type !== 'object') fail(toolsFile, `${t.name} needs an object inputSchema`);
      }
    } catch (e) { fail(toolsFile, `not JSON: ${e.message}`); }
  }
  for (const f of readdirSync(d).filter((n) => n.endsWith('.md'))) {
    const file = join(d, f);
    if (!TOOLS.includes(f.replace(/\.md$/, ''))) fail(file, 'mock for a tool the server does not expose');
    const { fields, body } = frontmatter(file);
    // type: agent mocks hold instructions for the judge model that plays the server, not a JSON answer.
    // fixed mocks answer like the hosted server: one summary line, then JSON. error: true mocks may be bare JSON.
    if (fields.type === 'agent') { if (body.length < 40) fail(file, 'agent mock needs instructions'); }
    else {
      const nl = body.indexOf('\n');
      const hasSummary = !body.startsWith('{') && nl > 0;
      if (!hasSummary && fields.error !== 'true') fail(file, 'mock answer needs a one-line summary before the JSON');
      try { JSON.parse(hasSummary ? body.slice(nl + 1) : body); } catch (e) { fail(file, `mock body is not JSON: ${e.message}`); }
    }
    for (const [, domain] of body.matchAll(/[\w.+-]+@([\w-]+(?:\.[\w-]+)+)/g)) {
      if (!domain.endsWith('-synthetic.com')) fail(file, `mock email on a real-looking domain (${domain}); use a -synthetic.com domain`);
    }
  }
}

console.log(`${cases.length} cases, ${mockDirs.length} mock dirs checked`);
if (failures) { console.log(`check-evals: ${failures} problem(s)`); process.exit(1); }
console.log('check-evals: ok');
