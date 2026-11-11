#!/usr/bin/env node
// Summarise <AGENTIC_ID_CONFIG_DIR or ~/.agentic-id>/usage.jsonl, written by hooks/log-usage.mjs:
// credits per tool, totals, and the last N calls (default 20). Read-only.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const dir = process.env.AGENTIC_ID_CONFIG_DIR?.trim() || join(homedir(), '.agentic-id');
const file = join(dir, 'usage.jsonl');
const lastN = Math.max(1, Number.parseInt(process.argv[2] ?? '20', 10) || 20);

let lines;
try {
  lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
} catch {
  console.log(`No Agentic ID usage logged yet (${file} does not exist).`);
  process.exit(0);
}

const records = [];
let skipped = 0;
for (const line of lines) {
  try {
    records.push(JSON.parse(line));
  } catch {
    skipped += 1;
  }
}

const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(2));
const byTool = new Map();
for (const r of records) {
  const t = byTool.get(r.tool) ?? { calls: 0, errors: 0, charged: 0, quoted: 0 };
  t.calls += 1;
  if (r.ok === false) t.errors += 1;
  t.charged += typeof r.credits_charged === 'number' ? r.credits_charged : 0;
  t.quoted += typeof r.quoted_credits === 'number' ? r.quoted_credits : 0;
  byTool.set(r.tool, t);
}

console.log(`Agentic ID usage log: ${file}`);
console.log(`${records.length} calls${skipped ? `, ${skipped} unreadable lines skipped` : ''}` +
  (records.length ? `, from ${records[0].ts} to ${records.at(-1).ts}` : ''));
console.log('');
console.log('| Tool | Calls | Errors | Credits quoted | Credits charged |');
console.log('| --- | ---: | ---: | ---: | ---: |');
let total = { calls: 0, errors: 0, charged: 0, quoted: 0 };
for (const [tool, t] of [...byTool.entries()].sort()) {
  console.log(`| ${tool} | ${t.calls} | ${t.errors} | ${fmt(t.quoted)} | ${fmt(t.charged)} |`);
  total = { calls: total.calls + t.calls, errors: total.errors + t.errors, charged: total.charged + t.charged, quoted: total.quoted + t.quoted };
}
console.log(`| **total** | ${total.calls} | ${total.errors} | ${fmt(total.quoted)} | ${fmt(total.charged)} |`);
console.log('');
console.log(`Last ${Math.min(lastN, records.length)} calls:`);
console.log('| Time (UTC) | Tool | Outcome | Credits charged | Request id |');
console.log('| --- | --- | --- | ---: | --- |');
for (const r of records.slice(-lastN).reverse()) {
  const outcome = r.ok === false ? `error${r.error ? ` (${r.error})` : ''}` : 'ok';
  const charged = typeof r.credits_charged === 'number' ? fmt(r.credits_charged) : 'n/a';
  console.log(`| ${r.ts} | ${r.tool} | ${outcome} | ${charged} | ${r.request_id ?? '-'} |`);
}
