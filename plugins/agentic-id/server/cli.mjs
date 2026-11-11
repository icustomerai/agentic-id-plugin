// agentic-id: the Agentic ID V3 API from a terminal, with the same cleaning, caps and batching as
// the MCP tools. Works on single lookups and on CSV files.
import { spawnSync } from 'node:child_process';
import { accessSync, constants, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { AgenticId, AgenticIdError, CLIENT, keyFromEnv, urlFromEnv } from './lib/client.mjs';
import { mapColumns, parseCsv, rowIdentifiers, toCsv } from './lib/csv.mjs';
import { estimate } from './lib/estimate.mjs';
import { cleanEmail, cleanIdentifiers, identityKey } from './lib/guards.mjs';
import * as ops from './lib/operations.mjs';

export const HELP = `agentic-id <command> [flags]      Agentic ID from a terminal (${CLIENT})

  validate <email...> [--domain acme.io]
  resolve  [--email e] [--linkedin url] [--name n] [--company c] [--domain d] [--spend]
  enrich   [--email e] [--linkedin url] [--name n] [--company c] [--domain d] [--fields title,work_email]
  find     <domain> [--role "VP Marketing"]... [--seniority director+] [--country GB] [--limit 5]
  discover [--industry software]... [--country GB]... [--min 100] [--max 2000] [--tech Snowflake] [--keyword k]
           [--title CTO]... [--seniority vp] [--per-account 1] [--max-accounts 25] [--count]
  lookalike <domain...> [--max-accounts 25]
  facts    <id>          every fact's level and the evidence behind it (free)
  ledger   <id>          the ID's history, hash chain re-checked (free)
  estimate <command> [the same flags]     the most it could cost, without calling (free)
  doctor                 is the key set, is the server reachable, what can this key read
  usage    [n]           credits per tool and the last n calls from the local log

Lists (CSV in, CSV out; repeats are paid once; personal emails never leave this machine):
  validate --file leads.csv [--column email]            adds email_verdict, email_reason
  resolve  --file leads.csv                             adds agentic_id, resolve_outcome, same_id_as_row
  enrich   --file leads.csv [--fields title,work_email] adds one column per field plus its level
  ... --out result.csv    write there instead of stdout       --limit-rows N    only the first N rows

Everywhere:
  --max-credits N   the most the call may charge. Needed for anything over 10 credits and for every --file run.
  --dry-run         show what would be sent and the estimate; send nothing
  --json            the full answer as JSON          --purpose b2b_outbound|ad_audience|own_customer_enrichment|fraud_check

Setup:  AGENTIC_ID_API_KEY (or AGENTIC_ID_API_KEY_FILE=path), AGENTIC_ID_URL (default ${urlFromEnv({})})
Exit:   0 ok · 1 bad input (nothing sent) · 2 key problem · 3 credits or cap · 4 refused by the API · 5 unreachable`;

const OPTIONS = {
  json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' }, spend: { type: 'boolean' }, count: { type: 'boolean' }, 'dry-run': { type: 'boolean' },
  email: { type: 'string' }, linkedin: { type: 'string' }, name: { type: 'string' }, company: { type: 'string' }, domain: { type: 'string' },
  fields: { type: 'string' }, role: { type: 'string', multiple: true }, seniority: { type: 'string' }, limit: { type: 'string' },
  industry: { type: 'string', multiple: true }, country: { type: 'string', multiple: true }, min: { type: 'string' }, max: { type: 'string' },
  tech: { type: 'string', multiple: true }, keyword: { type: 'string', multiple: true }, title: { type: 'string', multiple: true },
  'per-account': { type: 'string' }, 'max-accounts': { type: 'string' }, 'max-credits': { type: 'string' }, purpose: { type: 'string' }, kind: { type: 'string' },
  file: { type: 'string', short: 'f' }, out: { type: 'string', short: 'o' }, column: { type: 'string' }, 'limit-rows': { type: 'string' },
  'email-column': { type: 'string' }, 'linkedin-column': { type: 'string' }, 'name-column': { type: 'string' }, 'company-column': { type: 'string' }, 'domain-column': { type: 'string' },
};

class Usage extends Error {}
const num = (v, flag) => {
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new Usage(`--${flag} needs a whole number, got "${v}"`);
  return n;
};
const many = (v) => (v === undefined ? undefined : (Array.isArray(v) ? v : [v]).flatMap((x) => String(x).split(',')).map((x) => x.trim()).filter(Boolean));
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

/** Flags to the arguments an operation takes. Kept apart from I/O so it can be tested. */
export function toArgs(cmd, args, f) {
  const max_credits = num(f['max-credits'], 'max-credits');
  const who = clean({ email: f.email, linkedin_url: f.linkedin, name: f.name, company_name: f.company, company_domain: f.domain });
  const common = clean({ purpose: f.purpose, max_credits });
  switch (cmd) {
    case 'validate':
      return { ...common, ...clean({ emails: args.length ? args : undefined, domain: f.domain }) };
    case 'resolve':
      return { ...common, identifiers: who, ...clean({ kind: f.kind, spend: f.spend || undefined }) };
    case 'enrich': {
      const person = clean({ email: f.email, linkedin_url: f.linkedin, name: f.name });
      const hasPerson = Object.keys(person).length > 0;
      return { ...common, ...(hasPerson ? { contact: who } : { company: clean({ domain: f.domain, name: f.company }) }), ...clean({ fields: many(f.fields) }) };
    }
    case 'find':
      return { ...common, account: clean({ domain: args[0] ?? f.domain }), ...clean({ roles: many(f.role), seniority: f.seniority, countries: many(f.country), limit: num(f.limit, 'limit') }) };
    case 'discover': {
      const contact = clean({ job_title: many(f.title), job_level: f.seniority, per_account: num(f['per-account'], 'per-account') });
      return {
        ...common,
        account_filters: clean({ industry: many(f.industry), country: many(f.country), employees_min: num(f.min, 'min'), employees_max: num(f.max, 'max'), technologies: many(f.tech), keywords: many(f.keyword) }),
        ...(Object.keys(contact).length ? { contact_filters: contact } : {}),
        ...clean({ max_accounts: num(f['max-accounts'], 'max-accounts'), count_only: f.count || undefined }),
      };
    }
    case 'lookalike':
      return { ...common, seeds: args, ...clean({ max_accounts: num(f['max-accounts'], 'max-accounts') }) };
    case 'facts':
    case 'ledger':
      return { id: args[0] };
    default:
      return undefined;
  }
}

const OPS = { validate: ops.validate, resolve: ops.resolve, enrich: ops.enrich, find: ops.find, discover: ops.discover, lookalike: ops.lookalike, facts: ops.facts, ledger: ops.ledger };

/** A client that sends nothing: each call answers with what it would have sent. */
const dryClient = (real) =>
  new Proxy(real, {
    get(target, prop) {
      if (['validate', 'resolve', 'enrich', 'find', 'discover', 'lookalike'].includes(prop)) return async (body) => ({ dry_run: true, summary: `Dry run: nothing sent. Would POST /v1/${prop}.`, would_send: body, cost: { quoted_credits: 0, charged_credits: 0 }, results: [], accounts: [], contacts: [], people: [] });
      return target[prop];
    },
  });

// ------------------------------------------------------------------ the human view
const pad = (v, n) => String(v ?? '').padEnd(n);
export function render(cmd, r) {
  const lines = [];
  if (typeof r.summary === 'string') lines.push(r.summary);
  const rows = (k) => (Array.isArray(r[k]) ? r[k] : []);
  if (r.dry_run) lines.push(JSON.stringify(r.would_send, null, 2));
  if (cmd === 'validate') for (const x of rows('results')) lines.push(`  ${pad(x.verdict, 9)} ${x.email}${x.reason ? `  (${x.reason})` : ''}${x.role ? '  [shared mailbox]' : ''}`);
  if (cmd === 'validate' && r.domain) lines.push(`  domain ${r.domain.domain}: ${r.domain.status}${r.domain.reason ? ` (${r.domain.reason})` : ''}`);
  if (cmd === 'resolve' && r.outcome) {
    lines.push(`  id: ${r.id ?? '-'}  outcome: ${r.outcome}${r.matched_on ? `  matched on: ${r.matched_on}` : ''}${r.confidence !== undefined ? `  confidence: ${r.confidence}` : ''}`);
    for (const x of rows('related')) lines.push(`  related: ${x.id} (${x.reason})`);
  }
  if (cmd === 'enrich') for (const x of rows('results')) {
    lines.push(`  ${x.id ?? '-'}  ${x.status}: ${x.reason}`);
    for (const fld of x.fields ?? []) lines.push(`    ${pad(fld.field, 16)} ${pad(typeof fld.value === 'object' ? JSON.stringify(fld.value) : fld.value, 36)} ${pad(fld.level, 13)} ${fld.source}`);
  }
  if (cmd === 'find' || cmd === 'discover') for (const p of rows(cmd === 'find' ? 'people' : 'contacts')) lines.push(`  ${pad(p.name, 24)} ${pad(p.title, 32)} ${pad(p.email, 28)} ${p.level ?? ''}  ${p.id}`);
  if (cmd === 'discover' || cmd === 'lookalike') {
    if (r.profile) lines.push(`  profile: ${[...(r.profile.industries ?? []), ...(r.profile.countries ?? [])].join(', ')}${r.profile.employees ? `, ${r.profile.employees.min}+ employees` : ''} (from ${r.profile.seeds_used} seeds)`);
    for (const a of rows('accounts')) lines.push(`  ${a.similarity !== undefined ? pad(a.similarity, 5) : ''}${pad(a.domain, 28)} ${pad(a.country, 3)} ${pad(a.employees ? `${a.employees.min}${a.employees.max ? `-${a.employees.max}` : '+'}` : '', 12)}${a.why ? a.why.join(', ') : ''}${a.charged === false ? '  (not charged)' : ''}`);
    for (const x of rows('seeds_rejected')) lines.push(`  seed ignored: ${x.domain} (${x.reason})`);
    if (rows('plan')[0]) lines.push(`  source: ${rows('plan')[0].why}`);
    if (typeof r.bigger_than_seeds === 'number' && r.bigger_than_seeds > 0.5) lines.push(`  note: ${Math.round(r.bigger_than_seeds * 100)}% of results are bigger than your largest seed`);
  }
  for (const [k, v] of Object.entries(r.excluded ?? {})) lines.push(`  left out: ${v} ${k}`);
  if (rows('rejected').length) lines.push(`  filter values not understood: ${rows('rejected').map((x) => `${x.field}="${x.value}"`).join(', ')}`);
  if (cmd === 'ledger') {
    lines.push(`  chain ${r.verified ? 'verified' : 'BROKEN'}`);
    for (const e of rows('entries')) lines.push(`  #${e.seq} ${e.at} ${pad(e.kind, 18)} ${String(e.hash).slice(0, 12)}…`);
  }
  if (cmd === 'facts') {
    lines.push(`  ${r.kind}, ${r.verified_id ? 'a Verified ID' : `not a Verified ID yet: ${(r.missing ?? []).join('; ')}`}`);
    for (const x of rows('facts')) lines.push(`  ${pad(x.fact, 16)} ${pad(x.level, 13)} ${x.reason}${x.recheck_at ? `  (re-check by ${String(x.recheck_at).slice(0, 10)})` : ''}`);
  }
  for (const note of r.input_notes ?? []) lines.push(`  note: ${note}`);
  if (r.cost && !r.summary?.includes('credit')) lines.push(`  charged ${r.cost.charged_credits} of ${r.cost.quoted_credits} quoted credits`);
  return lines.join('\n');
}

// ------------------------------------------------------------------ files
function readList(f) {
  const { header, rows, delimiter } = parseCsv(readFileSync(f.file, 'utf8'));
  if (!header.length) throw new Usage(`${f.file} is empty.`);
  const limit = num(f['limit-rows'], 'limit-rows');
  const map = mapColumns(header, clean({ email: f['email-column'] ?? f.column, linkedin_url: f['linkedin-column'], name: f['name-column'], company_name: f['company-column'], company_domain: f['domain-column'] }));
  return { header, rows: limit ? rows.slice(0, limit) : rows, delimiter, map };
}

async function runFile(cmd, client, f, io) {
  const max_credits = num(f['max-credits'], 'max-credits');
  const { header, rows, delimiter, map } = readList(f);
  if (!Object.keys(map).length) throw new Usage(`No identifier column found in ${f.file}. Columns: ${header.join(', ')}. Name one with --email-column, --linkedin-column, --name-column, --company-column or --domain-column.`);
  const dry = f['dry-run'];
  let added;
  let reply;

  if (cmd === 'validate') {
    if (!map.email) throw new Usage(`No email column in ${f.file}. Name it with --column.`);
    const emails = rows.map((r) => r[map.email]).filter(Boolean);
    const est = estimate('validate', { emails });
    if (dry) return io.err(`Dry run: ${rows.length} rows, ${emails.length} with an email. At most ${est.max_credits} credits (${est.arithmetic}). Nothing sent.`);
    if (max_credits === undefined) throw new Usage(`A file run needs --max-credits. This one could cost up to ${est.max_credits} credits (${est.arithmetic}).`);
    reply = await ops.validate(client, { emails, purpose: f.purpose, max_credits });
    const by = new Map(reply.results.map((x) => [x.email, x]));
    added = ['email_verdict', 'email_reason'];
    for (const r of rows) {
      const e = r[map.email] ? cleanEmail(r[map.email]) : undefined;
      const hit = e?.email ? by.get(e.email) : undefined;
      r.email_verdict = !r[map.email] ? '' : hit?.verdict ?? (e?.ok ? 'not_checked' : 'rejected');
      r.email_reason = hit?.reason ?? (e && !e.ok ? e.reason : '');
    }
  } else if (cmd === 'resolve') {
    const est = estimate('resolve_many', { records: rows });
    if (dry) return io.err(`Dry run: ${rows.length} rows. At most ${est.max_credits} credits (${est.arithmetic}). Nothing sent.`);
    if (max_credits === undefined) throw new Usage(`A file run needs --max-credits. This one could cost up to ${est.max_credits} credits (${est.arithmetic}).`);
    const out = [];
    let cost = { quoted_credits: 0, charged_credits: 0 };
    for (let i = 0; i < rows.length; i += 500) {
      const left = max_credits - cost.charged_credits;
      if (left < 1) break;
      const part = await ops.resolveMany(client, { records: rows.slice(i, i + 500).map((r) => rowIdentifiers(r, map)), kind: f.kind, spend: f.spend, purpose: f.purpose, max_credits: left });
      out.push(...part.rows.map((x) => ({ ...x, row: x.row + i, repeat_of_row: x.repeat_of_row ? x.repeat_of_row + i : undefined })));
      cost = { quoted_credits: cost.quoted_credits + part.cost.quoted_credits, charged_credits: cost.charged_credits + part.cost.charged_credits };
      if (part.stopped) break;
    }
    const firstRowOf = new Map();
    added = ['agentic_id', 'resolve_outcome', 'same_id_as_row'];
    rows.forEach((r, i) => {
      const x = out[i];
      r.agentic_id = x?.id ?? '';
      r.resolve_outcome = x?.outcome ?? 'not_run';
      r.same_id_as_row = '';
      if (x?.id) {
        if (firstRowOf.has(x.id)) r.same_id_as_row = firstRowOf.get(x.id);
        else firstRowOf.set(x.id, i + 1);
      }
    });
    const dupes = rows.filter((r) => r.same_id_as_row !== '').length;
    reply = { summary: `${rows.length} rows: ${firstRowOf.size} distinct IDs, ${dupes} duplicate rows, ${rows.filter((r) => !r.agentic_id).length} without an ID. ${cost.charged_credits} credits charged.`, cost };
  } else if (cmd === 'enrich') {
    const fields = many(f.fields);
    const unique = [];
    const keyOf = new Map();
    const rowKey = rows.map((r) => {
      const c = cleanIdentifiers(rowIdentifiers(r, map));
      if (c.empty) return undefined;
      const key = identityKey(c.identifiers) ?? JSON.stringify(c.identifiers);
      if (!keyOf.has(key)) {
        keyOf.set(key, unique.length);
        unique.push(c.identifiers);
      }
      return key;
    });
    const est = estimate('enrich', { contacts: unique, fields });
    if (dry) return io.err(`Dry run: ${rows.length} rows, ${unique.length} distinct contacts to enrich. At most ${est.max_credits} credits (${est.arithmetic}). Nothing sent.`);
    if (max_credits === undefined) throw new Usage(`A file run needs --max-credits. This one could cost up to ${est.max_credits} credits (${est.arithmetic}).`);
    if (!unique.length) throw new Usage('No row has a usable work identifier.');
    reply = await ops.enrich(client, { contacts: unique, fields, purpose: f.purpose, max_credits });
    const results = reply.results ?? [];
    const names = [...new Set(results.flatMap((x) => (x.fields ?? []).map((y) => y.field)))];
    added = ['agentic_id', 'enrich_status', ...names.flatMap((n) => [`os_${n}`, `os_${n}_level`])];
    rows.forEach((r, i) => {
      const x = rowKey[i] === undefined ? undefined : results[keyOf.get(rowKey[i])];
      r.agentic_id = x?.id ?? '';
      r.enrich_status = rowKey[i] === undefined ? 'skipped: no work identifier' : x?.status ?? 'not_run';
      for (const y of x?.fields ?? []) {
        r[`os_${y.field}`] = y.value;
        r[`os_${y.field}_level`] = y.level;
      }
    });
  } else throw new Usage(`--file works with validate, resolve and enrich, not ${cmd}.`);

  const csv = toCsv([...header, ...added.filter((a) => !header.includes(a))], rows, delimiter);
  if (f.out) {
    writeFileSync(f.out, csv);
    io.err(`Wrote ${rows.length} rows to ${f.out}`);
  } else io.out(csv.trimEnd());
  io.err(reply.summary);
  for (const note of reply.input_notes ?? []) io.err(`note: ${note}`);
  return 0;
}

// ------------------------------------------------------------------ doctor
async function doctor(client, io) {
  const ok = (good, label, fix) => io.out(`${good ? ' ok ' : 'FAIL'}  ${label}${!good && fix ? `\n      fix: ${fix}` : ''}`);
  const major = Number(process.versions.node.split('.')[0]);
  ok(major >= 18, `Node ${process.versions.node}`, 'Install Node 18 or later.');
  const keyed = Boolean(keyFromEnv());
  ok(keyed, keyed ? `API key found (${process.env.AGENTIC_ID_API_KEY && !process.env.AGENTIC_ID_API_KEY.startsWith('${') ? 'AGENTIC_ID_API_KEY' : 'AGENTIC_ID_API_KEY_FILE'})` : 'No API key', 'export AGENTIC_ID_API_KEY=..., or AGENTIC_ID_API_KEY_FILE=<a file that holds it>.');
  io.out(`      server: ${client.baseUrl}`);
  const started = Date.now();
  const s = await ops.status(client);
  ok(s.ok, s.ok ? `${s.summary} ${Date.now() - started} ms` : `Server check: ${s.summary}`, s.fix);
  if (s.ok) io.out(`      contact values: ${s.contact_values}`);
  const dir = process.env.AGENTIC_ID_CONFIG_DIR?.trim() || join(homedir(), '.agentic-id');
  let writable = true;
  try {
    mkdirSync(dir, { recursive: true });
    accessSync(dir, constants.W_OK);
  } catch {
    writable = false;
  }
  ok(writable, `Usage log folder ${dir}`, 'Make the folder writable, or set AGENTIC_ID_CONFIG_DIR.');
  return keyed && s.ok && major >= 18 ? 0 : s.status === 401 || !keyed ? 2 : 5;
}

// ------------------------------------------------------------------ entry
export const exitCodeFor = (e) => {
  if (e instanceof Usage) return 1;
  if (!(e instanceof AgenticIdError)) return 1;
  if (e.code === 'cap_required' || e.status === 402 || /credit/.test(e.code ?? '')) return 3;
  if (e.local) return 1;
  if (e.status === 401 || e.status === 403) return 2;
  if (e.status === 0 || e.status >= 500) return 5;
  return 4;
};

export async function main(argv = process.argv.slice(2), io = { out: (s) => console.log(s), err: (s) => console.error(s) }, client) {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, allowPositionals: true, options: OPTIONS });
  } catch (e) {
    io.err(`${e.message}\nRun agentic-id --help for the flags.`);
    return 1;
  }
  const { positionals, values: f } = parsed;
  let [cmd, ...args] = positionals;
  if (f.version) return io.out(CLIENT), 0;
  if (!cmd || f.help || cmd === 'help') return io.out(HELP), cmd || f.help ? 0 : 1;
  if (cmd === 'me' || cmd === 'status' || cmd === 'whoami') cmd = 'status';
  try {
    if (cmd === 'usage') {
      const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'usage-summary.mjs');
      return spawnSync(process.execPath, [script, ...args], { stdio: 'inherit' }).status ?? 1;
    }
    if (cmd === 'estimate') {
      const [target, ...rest] = args;
      const built = target && toArgs(target, rest, f);
      const est = built && estimate(target, built);
      if (!est) throw new Usage('estimate needs a command: agentic-id estimate discover --country GB --max-accounts 50');
      io.out(f.json ? JSON.stringify({ command: target, ...est }, null, 2) : est.free ? `Free: ${est.arithmetic}.` : `At most ${est.max_credits} credits: ${est.arithmetic}. Only results are charged.`);
      return 0;
    }
    const real = client ?? new AgenticId();
    if (cmd === 'doctor') return await doctor(real, io);
    if (cmd === 'status') {
      const s = await ops.status(real);
      io.out(f.json ? JSON.stringify(s, null, 2) : `${s.summary}${s.ok ? `\n  contact values: ${s.contact_values}` : `\n  fix: ${s.fix ?? 'run agentic-id doctor'}`}`);
      return s.ok ? 0 : s.key_configured ? 5 : 2;
    }
    if (!OPS[cmd]) throw new Usage(`Unknown command "${cmd}". Run agentic-id --help.`);
    if (f.file) return await runFile(cmd, real, f, io);
    const reply = await OPS[cmd](f['dry-run'] ? dryClient(real) : real, toArgs(cmd, args, f));
    io.out(f.json ? JSON.stringify(reply, null, 2) : render(cmd, reply));
    return 0;
  } catch (e) {
    if (e instanceof AgenticIdError) {
      const body = e.toJSON();
      if (f.json) io.err(JSON.stringify(body, null, 2));
      else io.err(`${e.local ? 'Not sent' : e.status ? `Agentic ID refused (${e.status}${e.code ? ` ${e.code}` : ''})` : 'Agentic ID did not answer'}: ${body.message}${body.issues ? `\n${body.issues.map((i) => `  ${i.path}: ${i.message}`).join('\n')}` : ''}${body.fix ? `\n  fix: ${body.fix}` : ''}`);
    } else if (e instanceof Usage || e?.code === 'ENOENT') io.err(e.code === 'ENOENT' ? `No such file: ${e.path}` : e.message);
    else throw e;
    return exitCodeFor(e);
  }
}
