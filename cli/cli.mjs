// agentic-id: the Agentic ID V3 API from a terminal, with the same cleaning, caps and batching as
// the MCP tools. Works on single lookups and on CSV files.
import { accessSync, constants, existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve as resolvePath } from 'node:path';
import { parseArgs } from 'node:util';
import { AuthError, login, logout } from './lib/auth.mjs';
import { AgenticId, AgenticIdError, CLIENT, keyFromEnv, urlFromEnv } from './lib/client.mjs';
import { cellFor, columnName, decodeText, mapColumns, parseCsv, rowIdentifiers, toCsv, unmappedEmailColumns } from './lib/csv.mjs';
import { estimate } from './lib/estimate.mjs';
import { cleanEmail, cleanIdentifiers, identityKey } from './lib/guards.mjs';
import * as ops from './lib/operations.mjs';

export const HELP = `agentic-id <command> [flags]      Agentic ID from a terminal (${CLIENT})

  validate <email...> [--domain acme.io]
  resolve  [--email e] [--linkedin url] [--name n] [--company c] [--domain d] [--spend]
  enrich   [--email e] [--linkedin url] [--name n] [--company c] [--domain d] [--fields title,work_email]
  find     <domain> [--role "VP Marketing"]... [--seniority director+] [--country GB] [--limit 5] [--confirmed-only]
  discover [--industry software]... [--country GB]... [--min 100] [--max 2000] [--tech Snowflake] [--keyword k]
           [--title CTO]... [--seniority vp] [--per-account 1] [--max-accounts 25] [--count] [--confirmed-only]
  lookalike <domain...> [--max-accounts 25]
  facts    <id>          every fact's level and the evidence behind it (free)
  ledger   <id>          the ID's history, hash chain re-checked (free)
  estimate <command> [the same flags]     the most it could cost, without calling (free)
  workspace [n]          credits available, what was spent, the last n charges, how this workspace shares (free)
  topup    <credits>     a payment link to buy credits ($0.05 each, 100 to 200,000); nothing is charged until you pay
  report   <id> --outcome bounced|replied|wrong_person|confirmed [--field work_email]   what happened to a value (free)
  login                  sign in with your iCustomer account in the browser (no API key needed)
  logout                 end that sign-in on this machine and on the server
  doctor                 signed in or key set, is the server reachable, what can this caller read

Lists (CSV in, CSV out; repeats are paid once; personal emails never leave this machine):
  validate --file leads.csv [--column email]            adds email_verdict, email_reason
  resolve  --file leads.csv                             adds agentic_id, resolve_outcome, same_id_as_row
  enrich   --file leads.csv [--fields title,work_email] adds one column per field plus its level
  report   --file outcomes.csv                          columns agentic_id, outcome and optionally field; adds report_status
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
  outcome: { type: 'string' }, field: { type: 'string' }, 'confirmed-only': { type: 'boolean' },
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
const compact = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== ''));

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
      return { ...common, account: clean({ domain: args[0] ?? f.domain }), ...clean({ roles: many(f.role), seniority: f.seniority, countries: many(f.country), limit: num(f.limit, 'limit'), include_unconfirmed: f['confirmed-only'] ? false : undefined }) };
    case 'discover': {
      const contact = clean({ job_title: many(f.title), job_level: f.seniority, per_account: num(f['per-account'], 'per-account'), include_unconfirmed: f['confirmed-only'] ? false : undefined });
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
  if (cmd === 'enrich') for (const x of [...rows('results'), ...rows('company_results')]) {
    lines.push(`  ${x.id ?? x.domain ?? x.name ?? '-'}  ${x.status}${x.reason ? `: ${x.reason}` : ''}`);
    for (const fld of x.fields ?? []) lines.push(`    ${pad(fld.field, 16)} ${pad(typeof fld.value === 'object' ? JSON.stringify(fld.value) : fld.value, 36)} ${pad(fld.level, 13)} ${fld.source}`);
  }
  if (cmd === 'find' || cmd === 'discover') for (const p of rows(cmd === 'find' ? 'people' : 'contacts')) {
    lines.push(`  ${pad(p.name, 24)} ${pad(p.title, 32)} ${pad(p.email, 28)} ${p.level ?? ''}  ${p.id}`);
    if (p.employment?.status === 'unconfirmed') lines.push(`    ! ${p.employment.flag ?? 'unconfirmed: the employer is not confirmed yet'}`);
  }
  if (cmd === 'discover' || cmd === 'lookalike') {
    if (r.profile) lines.push(`  profile: ${[...(r.profile.industries ?? []), ...(r.profile.countries ?? [])].join(', ')}${r.profile.employees ? `, ${r.profile.employees.min}+ employees` : ''} (from ${r.profile.seeds_used} seeds)`);
    for (const a of rows('accounts')) lines.push(`  ${a.similarity !== undefined ? pad(a.similarity, 5) : ''}${pad(a.domain, 28)} ${pad(a.country, 3)} ${pad(a.employees ? `${a.employees.min}${a.employees.max ? `-${a.employees.max}` : '+'}` : '', 12)}${a.why ? a.why.join(', ') : ''}${a.charged === false ? '  (not charged)' : ''}`);
    for (const x of rows('seeds_rejected')) lines.push(`  seed ignored: ${x.domain} (${x.reason})`);
    if (rows('plan')[0]?.why) lines.push(`  search: ${rows('plan')[0].why}`);
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
/** True when two paths are the same file on disk: another spelling, another letter case, or a link to it. */
export function sameFile(a, b) {
  if (resolvePath(a) === resolvePath(b)) return true;
  try {
    if (!existsSync(a) || !existsSync(b)) return false;
    if (realpathSync(a) === realpathSync(b)) return true;
    const [x, y] = [statSync(a), statSync(b)];
    return x.ino === y.ino && x.dev === y.dev;
  } catch {
    return false;
  }
}
const OVERWRITE = '--out must not be the input file (or a link to it): the original is never overwritten. Give another name.';

function readList(f) {
  const sheet = parseCsv(decodeText(readFileSync(f.file)).text);
  const { header, rows, delimiter } = sheet;
  if (!header.length) throw new Usage(`${f.file} is empty.`);
  const limit = num(f['limit-rows'], 'limit-rows');
  if (limit !== undefined && limit < 1) throw new Usage('--limit-rows must be 1 or more.');
  if (f.out && sameFile(f.out, f.file)) throw new Usage(OVERWRITE);
  // With --json the rows have nowhere to go but a file: refuse before anything is paid for.
  if (f.json && !f.out && !f['dry-run']) throw new Usage('--json with --file needs --out <file>: the rows are written there and the summary is printed as JSON.');
  let map;
  try {
    map = mapColumns(header, clean({ email: f['email-column'] ?? f.column, linkedin_url: f['linkedin-column'], name: f['name-column'], company_name: f['company-column'], company_domain: f['domain-column'] }));
  } catch (e) {
    throw new Usage(e.message);
  }
  return { header, rows: limit ? rows.slice(0, limit) : rows, delimiter, map, like: { bom: sheet.bom, eol: sheet.eol, sep: sheet.sep } };
}

/** "email from E-Mail Address, company from Firma": so the user sees what will be read before anything is sent. */
function columnsLine(map, header, rows) {
  const label = { email: 'email', linkedin_url: 'LinkedIn', name: 'name', first_name: 'first name', last_name: 'last name', company_name: 'company', company_domain: 'company domain' };
  const used = Object.entries(map).map(([k, col]) => `${label[k] ?? k} from "${columnName(col)}"`).join(', ');
  const missed = unmappedEmailColumns(header, rows, map).map((h) => `"${columnName(h) || '(no name)'}" (column ${header.indexOf(h) + 1})`);
  return `Columns used: ${used || 'none'}.${missed.length ? ` Warning: ${missed.join(', ')} holds email addresses but its name was not recognised, so it is NOT being read; name it with --email-column (tool: columns.email).` : ''}`;
}

async function runFile(cmd, client, f, io) {
  const max_credits = num(f['max-credits'], 'max-credits');
  const { header, rows, delimiter, map, like } = readList(f);
  const columns = columnsLine(map, header, rows);
  const needCap = (est) => {
    const e = new ops.LocalRefusal('cap_required', `A file run needs --max-credits. This one could cost up to ${est.max_credits} credits (${est.arithmetic}). ${columns}`, 'Run with --dry-run to see the estimate, then give --max-credits.');
    return e;
  };
  if (!Object.keys(map).length) throw new Usage(`No identifier column found in ${f.file}. Columns: ${header.map(columnName).join(', ')}. Name one with --email-column, --linkedin-column, --name-column, --company-column or --domain-column.`);
  const dry = f['dry-run'];
  // A column of emails we are not reading means people would be matched on their company alone: stop before paying.
  const unread = map.email ? [] : unmappedEmailColumns(header, rows, map);
  if (unread.length && !dry && cmd !== 'validate') throw new Usage(`"${columnName(unread[0]) || '(no name)'}" (column ${header.indexOf(unread[0]) + 1}) holds email addresses but its name was not recognised. Name it with --email-column "${columnName(unread[0])}" (tool: columns.email) so each person is looked up by their own address.`);
  let added;
  let reply;
  let capReached = false;
  let stoppedBy;
  const dryOut = (line, numbers) => {
    io.err(line);
    if (f.json) io.out(JSON.stringify({ dry_run: true, ...numbers, summary: line }, null, 2));
    return 0;
  };

  if (cmd === 'validate') {
    if (!map.email) throw new Usage(`No email column in ${f.file}. Name it with --column.`);
    const emails = rows.map((r) => cellFor(r, map, 'email')).filter(Boolean);
    // Priced on what would really be sent: repeats once, personal and malformed addresses not at all.
    const sendable = [...new Set(emails.map((e) => cleanEmail(e)).filter((e) => e.ok).map((e) => e.email))];
    const est = estimate('validate', { emails: sendable });
    const cleanedAll = emails.map((e) => cleanEmail(e));
    const personalCount = cleanedAll.filter((e) => !e.ok && /personal/.test(e.reason)).length;
    const malformedCount = cleanedAll.filter((e) => !e.ok && !/personal/.test(e.reason)).length;
    const repeatCount = cleanedAll.filter((e) => e.ok).length - sendable.length;
    if (dry) return dryOut(`Dry run: ${rows.length} rows, ${emails.length} with an email, ${sendable.length} distinct work addresses to check (not sent: ${repeatCount} repeat${repeatCount === 1 ? '' : 's'}, ${personalCount} personal, ${malformedCount} malformed or disposable). At most ${est.max_credits} credits (${est.arithmetic}). Nothing sent. ${columns}`, { rows: rows.length, to_send: sendable.length, max_credits: est.max_credits });
    if (max_credits === undefined) throw needCap(est);
    reply = await ops.validate(client, { emails, purpose: f.purpose, max_credits });
    const heldBack = emails.map((e) => cleanEmail(e)).filter((e) => !e.ok);
    if (heldBack.length) reply = { ...reply, summary: `${String(reply.summary ?? '').replace(/ Plus \d+ rejected on this machine without being sent\./, '')} ${heldBack.length} address${heldBack.length === 1 ? ' was' : 'es were'} not sent (${heldBack.filter((e) => /personal/.test(e.reason)).length} personal, ${heldBack.filter((e) => !/personal/.test(e.reason)).length} malformed or disposable): marked rejected.` };
    const by = new Map(reply.results.map((x) => [x.email, x]));
    // A run the cap or an error cut short still writes every row: the ones not reached say not_checked.
    if (reply.stopped?.error === 'cap_reached') capReached = true;
    else if (reply.stopped) stoppedBy = reply.stopped;
    added = ['email_verdict', 'email_reason'];
    for (const r of rows) {
      const raw = cellFor(r, map, 'email');
      const e = raw ? cleanEmail(raw) : undefined;
      const hit = e?.email ? by.get(e.email) : undefined;
      r.email_verdict = !raw ? '' : hit?.verdict ?? (e?.ok ? 'not_checked' : 'rejected');
      r.email_reason = hit?.reason ?? (e && !e.ok ? e.reason : '');
    }
  } else if (cmd === 'resolve') {
    // Priced on distinct lookups: rows that are the same lookup are paid once, rows with nothing usable not at all.
    const keys = new Set();
    for (const r of rows) {
      const c = cleanIdentifiers(rowIdentifiers(r, map));
      const k = c.empty ? undefined : identityKey(c.identifiers);
      if (k) keys.add(k);
    }
    const est = estimate('resolve_many', { records: [...keys] });
    if (dry) return dryOut(`Dry run: ${rows.length} rows, ${keys.size} distinct lookups (repeats and rows with nothing usable are not sent). At most ${est.max_credits} credits (${est.arithmetic}). Nothing sent. ${columns}`, { rows: rows.length, to_send: keys.size, max_credits: est.max_credits });
    if (max_credits === undefined) throw needCap(est);
    const out = [];
    let cost = { quoted_credits: 0, charged_credits: 0 };
    for (let i = 0; i < rows.length; i += 500) {
      const left = max_credits - cost.charged_credits;
      if (left < 1) {
        capReached = true;
        break;
      }
      const part = await ops.resolveMany(client, { records: rows.slice(i, i + 500).map((r) => rowIdentifiers(r, map)), kind: f.kind, spend: f.spend, purpose: f.purpose, max_credits: left });
      out.push(...part.rows.map((x) => ({ ...x, row: x.row + i, repeat_of_row: x.repeat_of_row ? x.repeat_of_row + i : undefined })));
      cost = { quoted_credits: cost.quoted_credits + part.cost.quoted_credits, charged_credits: cost.charged_credits + part.cost.charged_credits };
      if (part.stopped) {
        if (part.stopped.error === 'cap_reached') capReached = true;
        // A refused credential is not a partial result: stop here, write nothing.
        else if (part.stopped.status === 401 || part.stopped.status === 403) {
          const refused = new AgenticIdError(part.stopped.status, part.stopped.error, part.stopped.message ?? 'The credential was refused.', {});
          if (part.stopped.fix) refused.fix = part.stopped.fix; // keeps "the configured key was refused" over the generic hint
          throw refused;
        }
        else stoppedBy = part.stopped;
        break;
      }
    }
    const firstRowOf = new Map();
    const pairs = []; // "4 = 1": data row 4 is the same person or company as data row 1
    added = ['agentic_id', 'resolve_outcome', 'resolve_note', 'same_id_as_row'];
    rows.forEach((r, i) => {
      const x = out[i];
      r.agentic_id = x?.id ?? '';
      r.resolve_outcome = x?.outcome ?? 'not_run';
      // Why a row has no ID, in a few words (never an identifier from the row).
      r.resolve_note = x?.id ? '' : String(x?.reason ?? (x ? '' : 'not run: the cap was reached')).replace(/\s+/g, ' ').slice(0, 160);
      r.same_id_as_row = '';
      if (x?.id) {
        if (firstRowOf.has(x.id)) {
          r.same_id_as_row = firstRowOf.get(x.id);
          r.resolve_note = `duplicate of data row ${firstRowOf.get(x.id)}`;
          pairs.push(`${i + 1} = ${firstRowOf.get(x.id)}`);
        } else firstRowOf.set(x.id, i + 1);
      }
    });
    const dupes = rows.filter((r) => r.same_id_as_row !== '').length;
    // Which rows got no ID, by number, so nobody has to open the file (or guess) to say which.
    // In a few plain words per row, never a value from the row.
    const why = (r) => {
      const n = String(r.resolve_note ?? '');
      if (/no identifier/.test(n) || !n) return r.resolve_outcome === 'skipped' ? 'empty or nothing usable' : r.resolve_outcome;
      if (/not enough to identify/.test(n)) return /held back/.test(n) ? 'only a name; its personal data was held back' : 'only a name';
      if (r.resolve_outcome === 'review' || r.resolve_outcome === 'conflict') return `needs a person to look (${r.resolve_outcome})`;
      if (r.resolve_outcome === 'unresolvable') return 'not enough to resolve';
      return r.resolve_outcome;
    };
    const noId = rows.map((r, i) => (!r.agentic_id && r.resolve_outcome !== 'not_run' ? `${i + 1} (${why(r)})` : '')).filter(Boolean);
    const notRun = rows.filter((r) => r.resolve_outcome === 'not_run').length;
    reply = { summary: `${rows.length} rows: ${firstRowOf.size} distinct IDs, ${dupes} duplicate rows, ${rows.filter((r) => !r.agentic_id).length} without an ID (${rows.filter((r) => r.resolve_outcome === 'skipped').length} skipped: personal data only, a name alone, or empty; see resolve_note). ${pairs.length ? `Duplicates (data row = the earlier data row it repeats): ${pairs.slice(0, 25).join(', ')}${pairs.length > 25 ? `, and ${pairs.length - 25} more in the file` : ''}. ` : ''}${noId.length ? `Without an ID: data row${noId.length === 1 ? '' : 's'} ${noId.slice(0, 25).join(', ')}${noId.length > 25 ? `, and ${noId.length - 25} more (see resolve_note)` : ''}. ` : ''}Data rows are counted from 1 under the header. ${cost.charged_credits} credits charged.${capReached ? ` Stopped at the ${max_credits}-credit cap: ${notRun} rows not run.` : ''}${stoppedBy ? ` Stopped early: ${stoppedBy.message ?? stoppedBy.error}.` : ''}`, cost };
  } else if (cmd === 'enrich') {
    const fields = many(f.fields);
    // Each row is a person (a work email, a LinkedIn URL or a name with a company) or, when it has
    // only a company, a company: enriched and priced as one (1 credit, company fields).
    const people = [];
    const companies = [];
    const keyOf = new Map();
    const rowKey = rows.map((r) => {
      const c = cleanIdentifiers(rowIdentifiers(r, map));
      if (c.empty) return undefined;
      const i = c.identifiers;
      const person = Boolean(i.email || i.linkedin_url || i.name);
      const key = person ? `p:${identityKey(i) ?? JSON.stringify(i)}` : `c:${i.company_domain ?? `n:${String(i.company_name).toLowerCase()}`}`;
      if (!keyOf.has(key)) {
        keyOf.set(key, person ? people.length : companies.length);
        if (person) people.push(i);
        else companies.push(compact({ domain: i.company_domain, name: i.company_name }));
      }
      return key;
    });
    const est = estimate('enrich', { contacts: people, companies, fields });
    const what = [people.length ? `${people.length} distinct ${people.length === 1 ? 'person' : 'people'}` : '', companies.length ? `${companies.length} distinct ${companies.length === 1 ? 'company' : 'companies'}` : ''].filter(Boolean).join(' and ');
    if (dry) return dryOut(`Dry run: ${rows.length} rows, ${what || 'nothing'} to enrich. At most ${est.max_credits} credits (${est.arithmetic}). Nothing sent. ${columns}`, { rows: rows.length, to_send: people.length + companies.length, people: people.length, companies: companies.length, max_credits: est.max_credits });
    if (max_credits === undefined) throw needCap(est);
    if (!people.length && !companies.length) throw new Usage('No row has a usable work identifier or company.');
    reply = await ops.enrich(client, { ...(people.length ? { contacts: people } : {}), ...(companies.length ? { companies } : {}), fields, purpose: f.purpose, max_credits });
    if (reply.stopped?.error === 'cap_reached') capReached = true;
    else if (reply.stopped) stoppedBy = reply.stopped;
    const personResults = reply.results ?? [];
    const companyResults = reply.company_results ?? (people.length ? [] : reply.results ?? []);
    const resultFor = (k) => (k === undefined ? undefined : k.startsWith('p:') ? personResults[keyOf.get(k)] : companyResults[keyOf.get(k)]);
    const names = [...new Set([...personResults, ...companyResults].flatMap((x) => (x?.fields ?? []).map((y) => y.field)))];
    added = ['agentic_id', 'enrich_status', ...names.flatMap((n) => [`aid_${n}`, `aid_${n}_level`])];
    rows.forEach((r, i) => {
      const x = resultFor(rowKey[i]);
      r.agentic_id = x?.id ?? '';
      r.enrich_status = rowKey[i] === undefined ? 'skipped: no work identifier' : x?.status ?? 'not_run';
      for (const y of x?.fields ?? []) {
        // A range reads as "51-200" in a spreadsheet, not as JSON.
        r[`aid_${y.field}`] = y.value && typeof y.value === 'object' && !Array.isArray(y.value) && ('min' in y.value || 'max' in y.value) ? `${y.value.min ?? ''}${y.value.max ? `-${y.value.max}` : '+'}` : Array.isArray(y.value) ? y.value.join('; ') : y.value;
        r[`aid_${y.field}_level`] = y.level;
      }
    });
  } else throw new Usage(`--file works with validate, resolve and enrich, not ${cmd}.`);

  const csv = toCsv([...header, ...added.filter((a) => !header.includes(a))], rows, delimiter, like);
  if (f.out) {
    writeFileSync(f.out, csv);
    io.err(`Wrote ${rows.length} rows to ${f.out}`);
  } else if (!f.json) io.out(csv.trimEnd());
  io.err(reply.summary);
  io.err(columns);
  for (const note of reply.input_notes ?? []) io.err(`note: ${note}`);
  const partial = capReached || Boolean(stoppedBy);
  if (f.json) io.out(JSON.stringify({ summary: reply.summary, cost: reply.cost, rows: rows.length, out_file: f.out ?? null, added_columns: added, cap_reached: capReached, partial, ...(stoppedBy ? { stopped: stoppedBy.error } : {}) }, null, 2));
  io.done?.({ summary: reply.summary, cost: reply.cost, rows: rows.length, out_file: f.out, added_columns: added, cap_reached: capReached, partial, ...(stoppedBy ? { stopped: stoppedBy.error } : {}) });
  // A run that did not reach every row is never "done": the file holds what was done and the rest
  // is marked. 3 when the cap or the wallet stopped it, 2 when the credential did, 5 when an outage did.
  if (capReached) return 3;
  if (stoppedBy) return stoppedBy.status === 402 || /^credits\./.test(stoppedBy.error ?? '') ? 3 : stoppedBy.status === 401 || stoppedBy.status === 403 ? 2 : 5;
  return 0;
}

// ------------------------------------------------------------------ doctor
async function doctor(client, io) {
  const ok = (good, label, fix) => io.out(`${good ? ' ok ' : 'FAIL'}  ${label}${!good && fix ? `\n      fix: ${fix}` : ''}`);
  const major = Number(process.versions.node.split('.')[0]);
  ok(major >= 18, `Node ${process.versions.node}`, 'Install Node 18 or later.');
  const signedIn = client.authMode === 'signin';
  const keyed = Boolean(keyFromEnv()) || signedIn;
  ok(keyed, signedIn ? 'Signed in (session in ~/.agentic-id/session.json)' : keyed ? `API key found (${process.env.AGENTIC_ID_API_KEY && !process.env.AGENTIC_ID_API_KEY.startsWith('${') ? 'AGENTIC_ID_API_KEY' : 'AGENTIC_ID_API_KEY_FILE'})` : 'Not signed in and no API key', 'Run agentic-id login, or export AGENTIC_ID_API_KEY=..., or AGENTIC_ID_API_KEY_FILE=<a file that holds it>.');
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
  return keyed && s.ok && major >= 18 ? 0 : s.reachable === false ? 5 : s.status === 401 || !keyed ? 2 : 5;
}

// ------------------------------------------------------------------ entry
export const exitCodeFor = (e) => {
  if (e instanceof Usage) return 1;
  if (!(e instanceof AgenticIdError)) return 1;
  if (e.code === 'cap_required' || e.status === 402 || /credit/.test(e.code ?? '')) return 3;
  if (e.local) return 1;
  if (e.code === 'topup.unavailable') return 4; // the server cannot sell credits: a refusal, not an outage
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
    if (cmd === 'usage') throw new Usage('The local usage log is gone. For credits and what was spent, run: agentic-id workspace');
    if (cmd === 'estimate') {
      const [target, ...rest] = args;
      const built = target && toArgs(target, rest, f);
      const est = built && estimate(target, built);
      if (!est) throw new Usage('estimate needs a command: agentic-id estimate discover --country GB --max-accounts 50');
      io.out(f.json ? JSON.stringify({ command: target, ...est }, null, 2) : est.free ? `Free: ${est.arithmetic}.` : `At most ${est.max_credits} credits: ${est.arithmetic}. Only results are charged.`);
      return 0;
    }
    const real = client ?? new AgenticId();
    if (cmd === 'login') {
      if (real.apiKey) io.out('Note: an API key is configured and takes precedence over a sign-in. Unset it to use the sign-in.');
      try {
        await login({ baseUrl: real.baseUrl, io });
      } catch (e) {
        if (!(e instanceof AuthError)) throw e;
        io.err(`${e.message}${e.fix ? `\n  fix: ${e.fix}` : ''}`);
        return e.code === 'unreachable' ? 5 : 2;
      }
      const s = await ops.status(new AgenticId({ baseUrl: real.baseUrl, apiKey: '' }));
      io.out(s.ok ? `Signed in. ${s.summary}` : `Signed in, but the check failed: ${s.summary}`);
      return s.ok ? 0 : 5;
    }
    if (cmd === 'logout') {
      io.out((await logout(real.baseUrl)) ? 'Signed out.' : 'There was no sign-in for this server.');
      return 0;
    }
    if (cmd === 'doctor') return await doctor(real, io);
    if (cmd === 'status') {
      const s = await ops.status(real);
      io.out(f.json ? JSON.stringify(s, null, 2) : `${s.summary}${s.ok ? `\n  contact values: ${s.contact_values}` : `\n  fix: ${s.fix ?? 'run agentic-id doctor'}`}`);
      return s.ok ? 0 : s.reachable === false || s.key_configured ? 5 : 2;
    }
    if (cmd === 'buy-credits') cmd = 'topup';
    if (cmd === 'topup') {
      const n = args[0];
      if (!n || !/^\d+$/.test(n) || Number(n) < 1) throw new Usage(`topup needs a whole number of credits above 0${n ? `, got "${n}"` : ''}: agentic-id topup 1000`);
      // The link is printed, never opened: paying is the user's own step.
      const t = await ops.topup(real, { credits: Number(n) });
      if (f.json) io.out(JSON.stringify(t, null, 2));
      else {
        io.out(t.summary);
        io.out(`  pay here: ${t.url}`);
        if (t.expires_at) io.out(`  the link works until ${String(t.expires_at).slice(0, 16).replace('T', ' ')} UTC`);
        io.out('  Nothing is charged until you pay. The credits land seconds after; check with: agentic-id workspace');
      }
      return 0;
    }
    if (cmd === 'credits') cmd = 'workspace';
    if (cmd === 'workspace') {
      const w = await ops.workspace(real, { recent: args[0] === undefined ? undefined : Number(args[0]) });
      if (f.json) io.out(JSON.stringify(w, null, 2));
      else {
        io.out(w.summary);
        for (const t of w.spent.by_tool) io.out(`  ${t.tool.padEnd(10)} ${String(t.credits).padStart(6)} credits in ${t.calls} call${t.calls === 1 ? '' : 's'} (30 days)`);
        for (const l of w.recent) io.out(`  ${l.at.slice(0, 16).replace('T', ' ')}  ${l.kind === 'grant' ? '+' : '-'}${l.credits}  ${l.tool ?? l.note ?? l.kind}`);
        if (w.delivered?.length) io.out('  delivered (what each charge was for):');
        for (const d of w.delivered ?? []) io.out(`    ${d.at.slice(0, 16).replace('T', ' ')}  ${d.id}  ${(d.company ?? (d.kind === 'person' ? 'a person' : '')).padEnd(24)} ${d.tool}  ${d.credits} credit${d.credits === 1 ? '' : 's'}`);
        if (w.topups?.length) io.out('  credits bought (latest first):');
        for (const t of w.topups ?? []) io.out(`    ${String(t.paid_at ?? t.created_at ?? '').slice(0, 16).replace('T', ' ').padEnd(16)}  +${t.credits} credits  ${typeof t.amount_usd === 'number' ? `$${t.amount_usd.toFixed(2)}` : ''}  ${t.status}  ${t.topup_id}`);
        io.out('  times and "today" are in UTC');
      }
      return 0;
    }
    if (cmd === 'report') {
      let reports;
      let sheet;
      if (f.file) {
        sheet = parseCsv(decodeText(readFileSync(f.file)).text);
        if (f.out && sameFile(f.out, f.file)) throw new Usage(OVERWRITE);
        const col = (names) => sheet.header.find((h) => names.includes(columnName(h).trim().toLowerCase().replace(/[\s-]+/g, '_')));
        const idCol = col(['agentic_id', 'id', 'ic_id']);
        const outCol = col(['outcome', 'result', 'status']);
        const fieldCol = col(['field', 'value', 'attribute']);
        if (!idCol || !outCol) throw new Usage(`${f.file} needs an agentic_id column and an outcome column. Columns: ${sheet.header.map(columnName).join(', ')}.`);
        reports = sheet.rows.map((r) => ({ id: String(r[idCol] ?? '').trim(), outcome: String(r[outCol] ?? '').trim(), ...(fieldCol && r[fieldCol] ? { field: r[fieldCol] } : f.field ? { field: f.field } : {}), row: r })).filter((r) => r.id && r.outcome);
        if (!reports.length) throw new Usage(`No row in ${f.file} has both an Agentic ID and an outcome.`);
        if (f['dry-run']) return io.err(`Dry run: ${reports.length} outcome(s) would be reported. Nothing sent, nothing is charged for reports.`), 0;
      } else {
        if (!args[0] || !f.outcome) throw new Usage('report needs an ID and an outcome: agentic-id report ic-... --outcome bounced [--field work_email]');
        reports = [{ id: args[0], outcome: f.outcome, ...(f.field ? { field: f.field } : {}) }];
      }
      const out = [];
      for (let i = 0; i < reports.length; i += 200) out.push(await ops.report(real, { reports: reports.slice(i, i + 200).map(({ id, outcome, field }) => ({ id, outcome, ...(field ? { field } : {}) })) }));
      const results = out.flatMap((o) => o.results);
      const recorded = results.filter((r) => r.recorded).length;
      if (sheet) {
        const by = new Map(results.map((r) => [`${r.id}\n${r.field}`, r]));
        for (const r of reports) {
          const hit = by.get(`${String(r.id).trim()}\n${(r.field ?? 'work_email').toLowerCase()}`) ?? results.find((x) => x.id === String(r.id).trim());
          r.row.report_status = hit ? (hit.recorded ? 'recorded' : hit.error ?? 'not_recorded') : 'not_sent';
        }
        const csv = toCsv([...sheet.header.filter((h) => h !== 'report_status'), 'report_status'], sheet.rows, sheet.delimiter, { bom: sheet.bom, eol: sheet.eol, sep: sheet.sep });
        if (f.out) writeFileSync(f.out, csv);
        else io.out(csv.trimEnd());
        io.err(`${recorded} of ${reports.length} outcome(s) recorded. Nothing charged.${f.out ? ` Wrote ${f.out}.` : ''}`);
        io.done?.({ summary: `${recorded} of ${reports.length} outcome(s) recorded. Nothing charged.`, cost: { quoted_credits: 0, charged_credits: 0 }, rows: sheet.rows.length, out_file: f.out, added_columns: ['report_status'] });
      } else io.out(f.json ? JSON.stringify(out[0], null, 2) : `${out[0].summary}${results[0]?.note ? `\n  ${results[0].note}` : ''}`);
      return recorded === reports.length ? 0 : 4;
    }
    if (!OPS[cmd]) throw new Usage(`Unknown command "${cmd}". Run agentic-id --help.`);
    if (f.file) return await runFile(cmd, real, f, io);
    const reply = await OPS[cmd](f['dry-run'] ? dryClient(real) : real, toArgs(cmd, args, f));
    io.out(f.json ? JSON.stringify(reply, null, 2) : render(cmd, reply));
    return 0;
  } catch (e) {
    // A caller running this in-process (the list tool) gets the error itself, not only the exit
    // code: the code alone cannot tell "out of credits" from "no cap given", or a refused key
    // from a server that did not answer.
    io.failed?.(e);
    if (e instanceof AgenticIdError) {
      const body = e.toJSON();
      if (f.json) io.err(JSON.stringify(body, null, 2));
      else io.err(`${e.local ? 'Not sent' : e.status ? `Agentic ID refused (${e.status}${e.code ? ` ${e.code}` : ''})` : 'Agentic ID did not answer'}: ${body.message}${body.issues ? `\n${body.issues.map((i) => `  ${i.path}: ${i.message}`).join('\n')}` : ''}${body.fix ? `\n  fix: ${body.fix}` : ''}`);
    } else if (e instanceof Usage || e?.code === 'ENOENT') io.err(e.code === 'ENOENT' ? `No such file: ${e.path}` : e.message);
    else throw e;
    return exitCodeFor(e);
  }
}
