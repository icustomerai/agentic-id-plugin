// The operations behind both the MCP tools and the CLI. Each one cleans its input on this machine,
// refuses what should never be sent, sets a credit cap, makes the call (in batches when the list is
// longer than the API takes), and returns the API's answer with `input_notes` for anything it
// changed or held back.
import { spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { logout } from './auth.mjs';
import { AgenticIdError, CLIENT, isRun, KEY_PREFIX_RE } from './client.mjs';
import { AUTO_CAP, estimate } from './estimate.mjs';
import { cleanCountry, cleanDomain, cleanEmails, cleanIdentifiers, cleanList, companyNameProblem, identityKey, isPersonalDomain } from './guards.mjs';

/** A refusal made on this machine: nothing was sent and nothing was charged. */
export class LocalRefusal extends AgenticIdError {
  constructor(code, detail, fix, extra = {}) {
    super(0, code, detail, extra);
    this.fix = fix;
    this.local = true;
  }
  toJSON() {
    return { ...super.toJSON(), status: undefined, sent: false, ...this.problem };
  }
}

const compact = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && !(Array.isArray(v) && v.length === 0) && !(v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0)));
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const ID_RE = /^ic-[A-Za-z0-9]{6,40}$/;
const PLAN_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RUN_ID_RE = PLAN_RE;
/** The most results one search may aim for, and the most rows one call may send, when the call carries on as a run. */
export const RUN_MAX_TARGET = 50_000;
export const RUN_MAX_ROWS = 10_000;
const GRADES = ['A', 'B', 'C', 'D'];

/** min_trust: a grade A to D, or nothing. */
function minTrust(v) {
  if (v === undefined || v === null || v === '') return undefined;
  const g = String(v).trim().toUpperCase();
  if (!GRADES.includes(g)) throw new LocalRefusal('request.invalid', `min_trust must be A, B, C or D, got "${String(v).slice(0, 10)}".`, 'A is the best (identity verified, key fields corroborated), D the worst. Records below it are left out and not charged.');
  return g;
}

/**
 * A part of a list that carried on as a run (it was slow): followed to its end, so the part's own
 * answer can be merged like any other. Searches are not followed here: the caller shows the run.
 */
const settle = async (client, r) => (isRun(r) && typeof client.followRun === 'function' ? client.followRun(r.run_id) : r);
/** A followed run that paused (credits ran out, or a cap) is a stop, not a finished part. */
const pausedStop = (r, done, total, what) => (r?.run_status === 'paused' ? { error: 'run_paused', message: `stopped after ${done} of ${total} ${what}: the run paused (credits ran out, or a limit was reached)` } : undefined);

/** The cap to send. Small calls are capped at their own estimate; larger ones need the caller to say a number. */
function capFor(tool, args) {
  // A preview delivers nothing and charges nothing: no cap is needed (one given is passed on).
  if (args.preview === true) return args.max_credits;
  const est = estimate(tool, args);
  if (!est || est.free) return args.max_credits;
  if (args.max_credits !== undefined) {
    if (!Number.isInteger(args.max_credits) || args.max_credits < 0) throw new LocalRefusal('request.invalid', 'max_credits must be a whole number, 0 or more.', 'Pass max_credits as an integer.');
    return args.max_credits;
  }
  if (est.max_credits <= AUTO_CAP) return est.max_credits;
  throw new LocalRefusal('cap_required', `This call could cost up to ${est.max_credits} credits (${est.arithmetic}), so it needs max_credits.`, 'Tell the user the estimate, agree a budget, then call again with max_credits set to it.', { estimate: est });
}

const withNotes = (reply, notes) => (notes.length ? { ...reply, input_notes: notes } : reply);
const sumCost = (a, b) => ({ quoted_credits: (a?.quoted_credits ?? 0) + (b?.quoted_credits ?? 0), charged_credits: (a?.charged_credits ?? 0) + (b?.charged_credits ?? 0) });

// ------------------------------------------------------------------ validate
export async function validate(client, args = {}) {
  const { send, held, duplicates, test_like } = cleanEmails([...(Array.isArray(args.emails) ? args.emails : args.emails ? [args.emails] : []), ...(args.email ? [args.email] : [])]);
  const domain = args.domain ? cleanDomain(args.domain) : undefined;
  const notes = [];
  if (duplicates) notes.push(`${plural(duplicates, 'repeated address', 'repeated addresses')} checked once`);
  if (held.length) notes.push(`${plural(held.length, 'address', 'addresses')} held back on this machine and not sent (personal or malformed)`);
  if (test_like.length) notes.push(`${plural(test_like.length, 'address looks', 'addresses look')} like test data`);
  if (args.domain && !domain) notes.push(`"${String(args.domain).slice(0, 60)}" is not a domain and was not checked`);
  if (!send.length && !domain) {
    if (!held.length) throw new LocalRefusal('request.invalid', 'Nothing to validate: send email, emails or domain.', 'Pass at least one work email or a company domain.');
    return withNotes({ request_id: null, summary: `${plural(held.length, 'email')} checked on this machine: ${held.length} rejected. Nothing was sent; 0 credits charged.`, cost: { quoted_credits: 0, charged_credits: 0 }, results: held }, notes);
  }
  if (args.preview === true) {
    if (send.length > RUN_MAX_ROWS) throw new LocalRefusal('request.invalid', `${send.length} addresses in one preview; the most is ${RUN_MAX_ROWS}.`, 'Preview a part of the list.');
    return withNotes(await client.validate(compact({ emails: send, domain, preview: true, purpose: args.purpose, max_credits: args.max_credits })), notes);
  }
  const cap = capFor('validate', { emails: send, max_credits: args.max_credits });
  let cost = { quoted_credits: 0, charged_credits: 0 };
  const results = [];
  const requestIds = [];
  let domainResult;
  let stopped;
  let sourceDown = false;
  let first;
  // Each address can cost 1 credit, so a batch never holds more addresses than the cap has left:
  // the run stops at the cap with every address it did not check marked, never part-way through
  // a batch the server then cuts short. Unknown answers are free, so what is left is used again.
  let rest = [...send];
  let calls = 0;
  do {
    const left = cap === undefined ? undefined : cap - cost.charged_credits;
    if (rest.length && left !== undefined && left <= 0) {
      stopped = { error: 'cap_reached', message: `stopped after ${results.length} of ${send.length} addresses: the ${cap}-credit cap was reached` };
      break;
    }
    const batch = rest.slice(0, Math.min(1000, left === undefined ? 1000 : left));
    let r;
    try {
      r = await settle(client, await client.validate(compact({ emails: batch, domain: calls === 0 ? domain : undefined, purpose: args.purpose, max_credits: left })));
    } catch (e) {
      // The first call failing means nothing was done: the error is the answer. A later one keeps
      // what earlier batches already paid for, and says why it stopped.
      if (!(e instanceof AgenticIdError) || calls === 0) throw e;
      stopped = { ...e.toJSON(), message: `stopped after ${results.length} of ${send.length} addresses: ${e.detail}` };
      break;
    }
    calls += 1;
    first ??= r;
    const got = r.results ?? [];
    results.push(...got);
    cost = sumCost(cost, r.cost);
    requestIds.push(r.request_id);
    domainResult ??= r.domain;
    sourceDown ||= r.source_unavailable === true;
    // An address the server did not answer for is not sent again (it may have hit its own limit):
    // it is marked not_checked below.
    rest = rest.slice(batch.length);
    stopped = pausedStop(r, results.length, send.length, 'addresses');
    if (stopped) break;
  } while (rest.length);
  if (stopped) notes.push(stopped.message);
  const checked = new Set(results.map((x) => x.email));
  const notChecked = send.filter((e) => !checked.has(e)).map((email) => ({ email, verdict: 'not_checked', reason: stopped?.error === 'cap_reached' ? 'cap_reached' : stopped ? 'stopped_early' : 'no_answer', charged: false }));
  if (calls === 1 && !stopped && !notChecked.length) return withNotes({ ...first, summary: held.length ? `${first.summary} Plus ${held.length} rejected on this machine without being sent.` : first.summary, results: [...(first.results ?? []), ...held] }, notes);
  const tally = {};
  for (const r of [...results, ...held, ...notChecked]) tally[r.verdict] = (tally[r.verdict] ?? 0) + 1;
  return withNotes(
    compact({
      request_id: requestIds[0],
      request_ids: requestIds.length > 1 ? requestIds : undefined,
      summary: `${plural(results.length + held.length + notChecked.length, 'email')} ${stopped ? 'given' : 'checked'}${requestIds.length > 1 ? ` in ${plural(requestIds.length, 'batch', 'batches')}` : ''}: ${Object.entries(tally).map(([k, v]) => `${v} ${k}`).join(', ')}. ${plural(cost.charged_credits, 'credit')} charged.${stopped ? ` Partial: ${notChecked.length} not checked (${stopped.error === 'cap_reached' ? `the ${cap}-credit cap was reached` : stopped.message.replace(/^stopped after [^:]+: /, '')}); nothing was charged for them.` : ''}${sourceDown ? ' Some answers are missing because a data source was unavailable; only answers that came back are charged.' : ''}`,
      cost,
      results: [...results, ...held, ...notChecked],
      domain: domainResult,
      partial: stopped ? true : undefined,
      not_checked: notChecked.length || undefined,
      stopped,
      source_unavailable: sourceDown || undefined,
    }),
    notes,
  );
}

// ------------------------------------------------------------------ resolve
export async function resolve(client, args = {}) {
  const { identifiers, dropped, notes, empty } = cleanIdentifiers({ ...args, ...(args.identifiers ?? {}) });
  const all = [...notes, ...dropped.map((d) => `${d.field} was not sent (${d.reason})`)];
  if (empty) throw new LocalRefusal('nothing_to_resolve', dropped.length ? `Nothing usable to resolve: ${dropped.map((d) => `${d.field} (${d.reason})`).join(', ')}.` : 'Nothing to resolve: give a work email, a LinkedIn profile URL, a name with a company, or a company domain.', 'Agentic ID is B2B only. Send a work identifier, not a personal email or a phone number.', { dropped });
  if (identifiers.name && !identifiers.email && !identifiers.linkedin_url && !identifiers.company_domain && !identifiers.company_name) throw new LocalRefusal('name_alone', 'A name on its own cannot be resolved: many people share it.', 'Add the company (name or domain), a work email or a LinkedIn profile URL.');
  const body = compact({ identifiers, kind: args.kind, spend: args.spend === true ? true : undefined, preview: args.preview === true ? true : undefined, purpose: args.purpose, max_credits: capFor('resolve', args) });
  return withNotes(await settle(client, await client.resolve(body)), all);
}

/** A list resolved row by row, repeats paid once, with the rows that turned out to be the same ID grouped. */
export async function resolveMany(client, args = {}, { concurrency = 4 } = {}) {
  const records = Array.isArray(args.records) ? args.records : [];
  if (!records.length) throw new LocalRefusal('request.invalid', 'records is empty.', 'Pass records: an array of identifier objects (email, linkedin_url, name + company_domain, or company_domain).');
  if (records.length > 500) throw new LocalRefusal('too_many_rows', `${records.length} rows in one call; the limit is 500.`, 'Split the list, or use the CLI: agentic-id resolve --file <csv> --max-credits <budget>.');
  const rows = records.map((r, i) => ({ row: i + 1, ...cleanIdentifiers(r) }));
  const byKey = new Map();
  for (const r of rows) {
    r.key = r.empty ? undefined : identityKey(r.identifiers);
    // What is left cannot identify anyone (a name with no company, say): never sent.
    if (!r.empty && !r.key) r.unusable = true;
    if (r.key && !byKey.has(r.key)) byKey.set(r.key, r);
  }
  const unique = [...byKey.values()];
  const cap = capFor('resolve_many', { records: unique, max_credits: args.max_credits });
  let cost = { quoted_credits: 0, charged_credits: 0 };
  let halted;
  // Each lookup can cost 1 credit. One is set aside before it is sent and given back when it
  // answers, so lookups running side by side can never take the run past its cap.
  let inFlight = 0;
  const answers = new Map();
  const queue = [...unique];
  const worker = async () => {
    for (let r = queue.shift(); r; r = queue.shift()) {
      if (halted) return;
      if (cap - cost.charged_credits - inFlight < 1) {
        if (cap - cost.charged_credits < 1) {
          halted = { error: 'cap_reached', message: `stopped: the ${cap}-credit cap was reached` };
          return;
        }
        // The rest of the cap is spoken for by lookups still running: put this one back and wait.
        queue.unshift(r);
        await new Promise((res) => setTimeout(res, 25));
        continue;
      }
      inFlight += 1;
      try {
        const a = await settle(client, await client.resolve(compact({ identifiers: r.identifiers, kind: args.kind, spend: args.spend === true ? true : undefined, purpose: args.purpose, max_credits: 1 })));
        cost = sumCost(cost, a.cost);
        answers.set(r.key, compact({ id: a.id, outcome: a.outcome, matched_on: a.matched_on, confidence: a.confidence, reason: a.reason }));
      } catch (e) {
        if (!(e instanceof AgenticIdError)) throw e;
        // Money, auth and outage errors end the whole run; a bad row only fails that row.
        if ([401, 402, 0].includes(e.status) || e.status >= 500) halted = e.toJSON();
        else answers.set(r.key, { outcome: 'error', error: e.code ?? `http_${e.status}`, reason: e.detail });
      } finally {
        inFlight -= 1;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, unique.length) }, worker));

  const out = rows.map((r) => {
    if (r.empty) return { row: r.row, outcome: 'skipped', reason: r.dropped.map((d) => `${d.field}: ${d.reason}`).join('; ') || 'no identifier' };
    if (r.unusable) return { row: r.row, outcome: 'skipped', reason: `not enough to identify: ${Object.keys(r.identifiers).join(' and ')} alone${r.dropped.length ? ` (held back: ${r.dropped.map((d) => d.field).join(', ')})` : ''}. A name needs a company or a work email.` };
    const first = byKey.get(r.key);
    const a = answers.get(r.key) ?? { outcome: 'not_run', reason: halted?.message ?? 'stopped before this row' };
    return compact({ row: r.row, ...a, repeat_of_row: first.row !== r.row ? first.row : undefined });
  });
  const counts = {};
  for (const r of out) counts[r.outcome] = (counts[r.outcome] ?? 0) + 1;
  const byId = new Map();
  for (const r of out) if (r.id) byId.set(r.id, [...(byId.get(r.id) ?? []), r.row]);
  const sameId = [...byId.entries()].filter(([, v]) => v.length > 1).map(([id, v]) => ({ id, rows: v }));
  // What the run could have cost: one credit per distinct lookup, never more than its cap.
  cost = { quoted_credits: Math.max(Math.min(unique.length, cap), cost.charged_credits), charged_credits: cost.charged_credits };
  return compact({
    summary: `${plural(rows.length, 'row')}: ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ')}. ${sameId.length ? `${plural(sameId.length, 'ID')} shared by more than one row. ` : ''}${plural(cost.charged_credits, 'credit')} charged.`,
    cost,
    counts,
    rows: out,
    same_id: sameId,
    stopped: halted,
  });
}

// ------------------------------------------------------------------ enrich
export const PERSON_FIELDS = ['work_email', 'linkedin_url', 'title', 'seniority', 'company_name', 'company_domain', 'location', 'city', 'country'];
export const COMPANY_FIELDS = ['name', 'domain', 'linkedin_url', 'industry', 'employees', 'revenue_usd', 'country', 'city', 'founded', 'description'];
// The names people and older integrations use for the same fields.
const FIELD_ALIASES = { email: 'work_email', job_title: 'title', linkedin: 'linkedin_url', company: 'company_name', website: 'company_domain', employee_size: 'employees', employee_count: 'employees', headcount: 'employees', revenue: 'revenue_usd', job_level: 'seniority' };
// A company enriched on its own takes its own field names; these are the person-side names for them.
const TO_COMPANY_FIELD = { company_name: 'name', company_domain: 'domain' };
const isPersonId = (i) => Boolean(i.email || i.linkedin_url || i.name);

/** One company to enrich, from { domain, name } or a bare domain; undefined (with a reason) when unusable. */
function cleanCompany(raw) {
  const o = typeof raw === 'string' ? { domain: raw } : raw && typeof raw === 'object' ? raw : {};
  const rawDomain = o.domain ?? o.website ?? o.company_domain;
  const rawName = o.name ?? o.company_name;
  const out = {};
  let held;
  if (typeof rawDomain === 'string' && rawDomain.trim()) {
    const d = cleanDomain(rawDomain);
    if (!d) held = 'not_a_domain';
    else if (isPersonalDomain(d)) held = 'personal_mail_provider_is_not_a_company';
    else out.domain = d;
  }
  if (typeof rawName === 'string' && rawName.trim()) {
    const why = companyNameProblem(rawName);
    if (why) held = why;
    else out.name = rawName.trim().replace(/\s+/g, ' ').slice(0, 200);
  }
  return { company: Object.keys(out).length ? out : undefined, held };
}

export async function enrich(client, args = {}) {
  const notes = [];
  const people = [...(Array.isArray(args.contacts) ? args.contacts : []), ...(args.contact ? [args.contact] : [])].map((c) => cleanIdentifiers(c));
  const skipped = people.filter((p) => p.empty).length;
  const heldValues = people.filter((p) => !p.empty).reduce((n, p) => n + p.dropped.filter((d) => /personal|phone|email_in_company/.test(d.reason)).length, 0);
  const seen = new Set();
  const contacts = [];
  const companyLike = [];
  for (const p of people.filter((x) => !x.empty)) {
    // A "contact" with only a company on it is a company: priced and enriched as one.
    if (!isPersonId(p.identifiers)) {
      companyLike.push({ domain: p.identifiers.company_domain, name: p.identifiers.company_name });
      continue;
    }
    const key = identityKey(p.identifiers) ?? JSON.stringify(p.identifiers);
    if (seen.has(key)) continue;
    seen.add(key);
    contacts.push(p.identifiers);
  }
  const repeats = people.length - skipped - contacts.length - companyLike.length;
  if (skipped) notes.push(`${plural(skipped, 'contact')} had no usable work identifier and ${skipped === 1 ? 'was' : 'were'} not sent`);
  if (heldValues) notes.push(`${plural(heldValues, 'personal value')} (a personal email, a phone number or a mail provider) held back on this machine and not sent`);
  if (repeats) notes.push(`${plural(repeats, 'repeated contact')} enriched once`);
  if (companyLike.length) notes.push(`${plural(companyLike.length, 'entry', 'entries')} with only a company (no person) enriched as ${companyLike.length === 1 ? 'a company' : 'companies'}, 1 credit each`);
  let company;
  if (args.company) {
    const c = cleanCompany(args.company);
    if (c.held) notes.push(`the company's ${c.held === 'personal_mail_provider_is_not_a_company' ? 'domain is a mail provider, not a company' : `value was held back (${c.held.replace(/_/g, ' ')})`}; it was not sent`);
    company = c.company;
  }
  // Companies enriched one by one: `companies`, plus the contacts that turned out to be companies.
  const companies = [];
  const companySeen = new Set();
  let companyHeld = 0;
  for (const raw of [...(Array.isArray(args.companies) ? args.companies : []), ...companyLike]) {
    const c = cleanCompany(raw);
    if (!c.company) {
      companyHeld += 1;
      continue;
    }
    const key = c.company.domain ?? `n:${c.company.name.toLowerCase()}`;
    if (companySeen.has(key) || (company && (company.domain ?? `n:${company.name?.toLowerCase()}`) === key)) continue;
    companySeen.add(key);
    companies.push(c.company);
  }
  if (companyHeld) notes.push(`${plural(companyHeld, 'company', 'companies')} had no usable domain or name and ${companyHeld === 1 ? 'was' : 'were'} not sent`);
  const hasCompanies = Boolean(company) || companies.length > 0;

  const fields = args.fields ? cleanList(args.fields, (f) => FIELD_ALIASES[f.toLowerCase().replace(/[\s-]+/g, '_')] ?? f.toLowerCase().replace(/[\s-]+/g, '_')) : undefined;
  if (fields?.some((f) => /phone|mobile/i.test(f))) throw new LocalRefusal('phone_not_supported', 'Phone numbers are not enriched through this plugin.', 'Remove phone and mobile from fields. Agentic ID here is for work identities: title, company, work email, firmographics.');
  const companyFieldOf = (f) => TO_COMPANY_FIELD[f] ?? f;
  const allowed = new Set([...(contacts.length || !hasCompanies ? PERSON_FIELDS : []), ...(hasCompanies ? [...COMPANY_FIELDS, ...Object.keys(TO_COMPANY_FIELD)] : [])]);
  const unknownFields = (fields ?? []).filter((f) => !allowed.has(f));
  if (unknownFields.length) throw new LocalRefusal('request.invalid', `Unknown field${unknownFields.length === 1 ? '' : 's'}: ${unknownFields.join(', ')}.`, `Allowed here: ${[...allowed].join(', ')}.`);
  if (!contacts.length && !hasCompanies) throw new LocalRefusal('nothing_to_enrich', skipped || companyHeld ? `None of the ${plural(skipped + companyHeld, 'entry', 'entries')} had a usable work identifier or company.` : 'Nothing to enrich: send contact, contacts, company or companies.', 'Each contact needs a work email, a LinkedIn profile URL, or a name with a company; each company a domain or a name.');
  const personFields = fields?.filter((f) => PERSON_FIELDS.includes(f));
  const companyFields = fields ? [...new Set(fields.map(companyFieldOf).filter((f) => COMPANY_FIELDS.includes(f)))] : undefined;
  if (contacts.length && fields && !personFields.length) throw new LocalRefusal('request.invalid', `None of ${fields.join(', ')} is about a person.`, `For people ask for: ${PERSON_FIELDS.join(', ')}. To enrich their companies, send the companies (domain or name) in "companies".`);
  if (hasCompanies && fields && !companyFields.length) throw new LocalRefusal('request.invalid', `None of ${fields.join(', ')} is about a company.`, `For companies ask for: ${COMPANY_FIELDS.join(', ')}.`);
  if (args.preview === true) {
    if (companies.length) throw new LocalRefusal('request.invalid', 'A preview takes one contact, a list of contacts, or one company.', 'For a file, use --dry-run: it prices every row on this machine.');
    if (contacts.length > RUN_MAX_ROWS) throw new LocalRefusal('request.invalid', `${contacts.length} contacts in one preview; the most is ${RUN_MAX_ROWS}.`, 'Preview a part of the list.');
    return withNotes(await client.enrich(compact({ ...(contacts.length === 1 && !args.contacts ? { contact: contacts[0] } : { contacts }), company, fields: contacts.length ? (company ? fields : personFields) : companyFields, preview: true, purpose: args.purpose, max_credits: args.max_credits })), notes);
  }
  const cap = capFor('enrich', { contacts, company, companies, fields, max_credits: args.max_credits });
  const est = estimate('enrich', { contacts, company, companies, fields });

  // The usual case: one call, inside the cap. The answer is passed on as it came.
  if (!companies.length && contacts.length <= 100 && cap >= est.max_credits) {
    const r = await settle(client, await client.enrich(compact({ ...(contacts.length === 1 && !args.contacts ? { contact: contacts[0] } : { contacts }), company, fields: contacts.length ? (company ? fields : personFields) : companyFields, purpose: args.purpose, max_credits: cap })));
    return withNotes(r, notes);
  }

  // Otherwise in steps, never sending more than the cap can pay for, keeping what each step got.
  let cost = { quoted_credits: 0, charged_credits: 0 };
  const results = [];
  const requestIds = [];
  let stopped;
  let sourceDown = false;
  const perPerson = est.per_person ?? 2;
  let sentCompany = false;
  for (let i = 0; i < contacts.length; ) {
    const left = cap - cost.charged_credits - (company && !sentCompany ? 1 : 0);
    const size = Math.min(100, Math.floor(left / perPerson), contacts.length - i);
    if (size < 1) {
      stopped = { error: 'cap_reached', message: `stopped after ${i} of ${contacts.length} contacts: the ${cap}-credit cap was reached` };
      break;
    }
    let r;
    try {
      r = await settle(client, await client.enrich(compact({ contacts: contacts.slice(i, i + size), company: sentCompany ? undefined : company, fields: company && !sentCompany ? fields : personFields, purpose: args.purpose, max_credits: cap - cost.charged_credits })));
    } catch (e) {
      if (!(e instanceof AgenticIdError) || requestIds.length === 0) throw e;
      stopped = { ...e.toJSON(), message: `stopped after ${i} of ${contacts.length} contacts: ${e.detail}` };
      break;
    }
    sentCompany = true;
    // Kept in the order sent, one entry per contact, so row i is always contact i.
    const got = r.results ?? [];
    for (let k = 0; k < size; k += 1) results.push(got[k] ?? { status: 'not_run', reason: 'no answer for this contact', charged: false });
    cost = sumCost(cost, r.cost);
    requestIds.push(r.request_id);
    sourceDown ||= r.source_unavailable === true;
    i += size;
    stopped = pausedStop(r, i, contacts.length, 'contacts');
    if (stopped) break;
  }
  if (company && !sentCompany && !stopped && !contacts.length) companies.unshift(company);

  // Companies, a few at a time. One credit is set aside for each before it is sent, so lookups
  // running side by side can never take the run past its cap.
  const companyResults = new Array(companies.length);
  if (companies.length && !stopped) {
    let inFlight = 0;
    let halted;
    let next = 0;
    const worker = async () => {
      while (next < companies.length && !halted) {
        if (cap - cost.charged_credits - inFlight < 1) {
          if (cap - cost.charged_credits < 1) {
            halted = { error: 'cap_reached', message: `stopped after ${companyResults.filter(Boolean).length} of ${companies.length} companies: the ${cap}-credit cap was reached` };
            return;
          }
          await new Promise((res) => setTimeout(res, 25));
          continue;
        }
        const k = next;
        next += 1;
        inFlight += 1;
        try {
          const r = await settle(client, await client.enrich(compact({ company: companies[k], fields: companyFields, purpose: args.purpose, max_credits: 1 })));
          cost = sumCost(cost, r.cost);
          requestIds.push(r.request_id);
          sourceDown ||= r.source_unavailable === true;
          const one = r.results?.[0] ?? r;
          companyResults[k] = compact({ ...companies[k], id: one.id, status: one.status ?? (one.fields?.length ? 'enriched' : 'not_found'), reason: one.reason, fields: one.fields });
        } catch (e) {
          if (!(e instanceof AgenticIdError)) throw e;
          // Money, auth and outage errors end the run; a bad company only fails that company.
          if ([401, 402, 403, 0].includes(e.status) || e.status >= 500) halted = { ...e.toJSON(), message: `stopped after ${companyResults.filter(Boolean).length} of ${companies.length} companies: ${e.detail}` };
          else companyResults[k] = { ...companies[k], status: 'error', reason: e.detail, charged: false };
        } finally {
          inFlight -= 1;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, companies.length) }, worker));
    // Nothing done at all and the first answer was an error: that error is the answer.
    if (halted && !requestIds.length && halted.error !== 'cap_reached') {
      const e = new AgenticIdError(halted.status, halted.error, halted.message.replace(/^stopped after [^:]+: /, ''), halted);
      if (halted.fix) e.fix = halted.fix;
      throw e;
    }
    stopped = halted;
  }
  for (let k = 0; k < companies.length; k += 1) companyResults[k] ??= { ...companies[k], status: 'not_run', reason: stopped?.error === 'cap_reached' ? 'the cap was reached first' : 'stopped before this company', charged: false };
  for (let k = results.length; k < contacts.length; k += 1) results.push({ status: 'not_run', reason: stopped?.error === 'cap_reached' ? 'the cap was reached first' : 'stopped before this contact', charged: false });
  if (stopped) notes.push(stopped.message);

  const enriched = results.filter((r) => r.fields?.length).length;
  const companiesEnriched = companyResults.filter((r) => r.fields?.length).length;
  const notRun = [...results, ...companyResults].filter((r) => r.status === 'not_run').length;
  const parts = [];
  if (contacts.length) parts.push(`${plural(contacts.length, 'contact')}: ${enriched} enriched`);
  if (companies.length) parts.push(`${plural(companies.length, 'company', 'companies')}: ${companiesEnriched} enriched`);
  return withNotes(
    compact({
      request_id: requestIds[0],
      request_ids: requestIds.length > 1 ? requestIds : undefined,
      summary: `${parts.join('; ')}. ${plural(cost.charged_credits, 'credit')} charged.${stopped ? ` Partial: ${notRun} not run (${stopped.error === 'cap_reached' ? `the ${cap}-credit cap was reached` : stopped.message.replace(/^stopped after [^:]+: /, '')}); nothing was charged for them.` : ''}${sourceDown ? ' Some answers are missing because a data source was unavailable; only answers that came back are charged.' : ''}`,
      cost,
      results: contacts.length ? results : undefined,
      company_results: companies.length ? companyResults : undefined,
      partial: stopped ? true : undefined,
      stopped,
      source_unavailable: sourceDown || undefined,
    }),
    notes,
  );
}

// ------------------------------------------------------------------ find
export async function find(client, args = {}) {
  const notes = [];
  const acct = args.account ?? {};
  const domain = cleanDomain(acct.domain ?? args.domain ?? '');
  const id = typeof acct.id === 'string' && acct.id.trim() ? acct.id.trim() : undefined;
  if (!domain && !id) throw new LocalRefusal('account_required', 'find works inside one known company: give account.domain or account.id.', 'To search people across companies, use discover with contact_filters.');
  if (domain && isPersonalDomain(domain)) throw new LocalRefusal('not_a_company', `${domain} is a mail provider, not a company.`, 'Give the company\'s own domain.');
  const roles = cleanList(args.roles);
  const seniority = Array.isArray(args.seniority) ? cleanList(args.seniority) : typeof args.seniority === 'string' && args.seniority.trim() ? args.seniority.trim() : undefined;
  if (!roles.length && !(Array.isArray(seniority) ? seniority.length : seniority)) throw new LocalRefusal('find.persona_unreadable', 'A person search needs a job title in roles, or a seniority.', 'Ask the user which roles matter, e.g. roles ["VP Marketing"], or seniority "director+".');
  // Up to 25 people answer in one call; more (up to 50,000) carry on as a run.
  const limit = Math.min(Math.max(Number.isFinite(Number(args.limit)) ? Math.trunc(Number(args.limit)) : 5, 1), RUN_MAX_TARGET);
  if (args.limit > RUN_MAX_TARGET) notes.push(`limit lowered to ${RUN_MAX_TARGET.toLocaleString('en-US')}, the most one search aims for`);
  const preview = args.preview === true;
  const body = compact({ account: compact({ id, domain }), roles, seniority, countries: args.countries ? cleanList(args.countries, cleanCountry) : undefined, limit, exclude_seen: args.exclude_seen, include_unconfirmed: typeof args.include_unconfirmed === 'boolean' ? args.include_unconfirmed : undefined, preview: preview || undefined, purpose: args.purpose, max_credits: capFor('find', { limit, max_credits: args.max_credits, preview }) });
  return withNotes(await client.find(body), notes);
}

// ------------------------------------------------------------------ discover
// Filter names people and agents reach for, mapped to the API's. Any other name is refused, never
// dropped: a filter that is silently left out buys a different list (all software companies,
// instead of the UK ones).
const ACCOUNT_FILTER_ALIASES = { industries: 'industry', countries: 'country', technology: 'technologies', tech: 'technologies', keyword: 'keywords', min_employees: 'employees_min', max_employees: 'employees_max', naics_codes: 'naics', sic_codes: 'sic' };
const ACCOUNT_FILTERS = ['industry', 'naics', 'sic', 'country', 'employees_min', 'employees_max', 'revenue_min', 'revenue_max', 'founded_from', 'founded_to', 'funding_stage', 'revenue_range', 'technologies', 'keywords', 'keywords_required'];
const CONTACT_FILTER_ALIASES = { job_titles: 'job_title', titles: 'job_title', title: 'job_title', roles: 'job_title', seniority: 'job_level', job_levels: 'job_level', country: 'countries', functions: 'job_function', job_functions: 'job_function' };
/** Industry codes: digits only, as strings (NAICS 2 to 6, SIC 2 to 4). Anything else is refused, never dropped. */
function codes(raw, what, min, max) {
  if (raw === undefined || raw === null) return undefined;
  const list = (Array.isArray(raw) ? raw : String(raw).split(',')).map((x) => String(x).trim()).filter(Boolean);
  const bad = list.filter((x) => !new RegExp(`^\\d{${min},${max}}$`).test(x));
  if (bad.length) throw new LocalRefusal('request.invalid', `${what} codes are ${min} to ${max} digits; not understood: ${bad.slice(0, 5).join(', ')}. Nothing was sent.`, `Give ${what} codes such as ${what === 'NAICS' ? '"621512", or "6215" for the whole group' : '"8071"'}.`);
  return [...new Set(list)];
}
function filterNames(raw, aliases, known, what) {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new LocalRefusal('request.invalid', `${what} must be an object.`, `Allowed keys: ${known.join(', ')}.`);
  const out = {};
  const unknown = [];
  for (const [k, v] of Object.entries(raw)) {
    const name = aliases[k] ?? k;
    if (!known.includes(name)) unknown.push(k);
    else out[name] = v;
  }
  if (unknown.length) throw new LocalRefusal('request.invalid', `Unknown ${what} key${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}. Nothing was sent.`, `Allowed: ${known.join(', ')}.`);
  return out;
}

export async function discover(client, args = {}) {
  const notes = [];
  const af = filterNames(args.account_filters, ACCOUNT_FILTER_ALIASES, ACCOUNT_FILTERS, 'account_filters') ?? {};
  const cf = filterNames(args.contact_filters, CONTACT_FILTER_ALIASES, ['job_title', 'job_level', 'job_function', 'countries', 'per_account', 'min_company_size', 'include_unconfirmed'], 'contact_filters');
  // A plain-language request, read into filters by the server (free). Filters given as well win.
  const ask = typeof args.ask === 'string' ? args.ask.trim().replace(/\s+/g, ' ') : undefined;
  if (args.ask !== undefined && (!ask || ask.length < 3 || ask.length > 500)) throw new LocalRefusal('request.invalid', 'ask must be a sentence of 3 to 500 characters.', 'Say what companies you want in plain words, for example "mid-size diagnostic imaging centres in Texas".');
  const min = af.employees_min;
  const max = af.employees_max;
  if (min !== undefined && max !== undefined && min > max) throw new LocalRefusal('request.invalid', `employees_min (${min}) is larger than employees_max (${max}).`, 'Swap them or drop one.');
  const account_filters = compact({ industry: cleanList(af.industry), naics: codes(af.naics, 'NAICS', 2, 6), sic: codes(af.sic, 'SIC', 2, 4), country: cleanList(af.country, cleanCountry), employees_min: min, employees_max: max, revenue_min: af.revenue_min, revenue_max: af.revenue_max, founded_from: af.founded_from, founded_to: af.founded_to, funding_stage: af.funding_stage, revenue_range: af.revenue_range, technologies: cleanList(af.technologies), keywords: cleanList(af.keywords), keywords_required: af.keywords_required });
  const contact_filters = cf ? compact({ job_title: cleanList(cf.job_title), job_level: Array.isArray(cf.job_level) ? cleanList(cf.job_level) : cf.job_level, job_function: Array.isArray(cf.job_function) ? cleanList(cf.job_function) : cf.job_function, countries: cleanList(cf.countries, cleanCountry), per_account: cf.per_account, min_company_size: cf.min_company_size, include_unconfirmed: typeof cf.include_unconfirmed === 'boolean' ? cf.include_unconfirmed : undefined }) : undefined;
  const hasContact = contact_filters && Object.keys(contact_filters).length > 0;
  if (!Object.keys(account_filters).length && !hasContact && !ask) throw new LocalRefusal('request.invalid', 'discover needs at least one filter, or a plain-language ask.', 'Give account_filters (industry, naics, country, employees_min/max, technologies, keywords) and optionally contact_filters, or ask in plain words.');
  if (hasContact && !contact_filters.job_title && !contact_filters.job_level) throw new LocalRefusal('find.persona_unreadable', 'contact_filters needs a job_title or a job_level.', 'Add the titles or seniority the user is after, or leave contact_filters out to get accounts only.');
  if (!ask && Object.keys(account_filters).length === 1 && account_filters.country) notes.push('a country on its own matches a very large number of companies; add an industry or a size range');
  // count_only is the old name for preview: both are free, and both are sent as given.
  const count_only = args.count_only === true;
  const preview = args.preview === true;
  const free = count_only || preview;
  let cap;
  try {
    cap = capFor('discover', { ...args, contact_filters: hasContact ? contact_filters : undefined, count_only, preview });
  } catch (e) {
    if (e instanceof LocalRefusal && e.code === 'cap_required') e.fix = 'Run it once with preview: true (free; count_only is the old name; in the CLI --preview) to see how many match and what it could cost, agree a budget with the user, then call again with max_credits.';
    throw e;
  }
  const body = compact({ ask, account_filters, contact_filters: hasContact ? contact_filters : undefined, max_accounts: args.max_accounts, exclude_seen: args.exclude_seen, min_trust: minTrust(args.min_trust), count_only: count_only || undefined, preview: preview || undefined, purpose: args.purpose, max_credits: free ? args.max_credits : cap });
  if (!body.account_filters && !ask) body.account_filters = {};
  return withNotes(await client.discover(body), notes);
}

// ------------------------------------------------------------------ lookalike
export async function lookalike(client, args = {}) {
  const notes = [];
  const raw = Array.isArray(args.seeds) ? args.seeds : typeof args.seeds === 'string' ? args.seeds.split(/[\s,;]+/) : [];
  const seeds = [];
  let bad = 0;
  for (const s of raw) {
    // A seed may be given as a work email or a URL: the company is its domain.
    const d = cleanDomain(typeof s === 'string' && s.includes('@') ? s.slice(s.lastIndexOf('@') + 1) : s);
    if (!d || isPersonalDomain(d)) bad += 1;
    else if (!seeds.includes(d)) seeds.push(d);
  }
  if (bad) notes.push(`${plural(bad, 'seed')} ignored (not a company domain)`);
  if (!seeds.length) throw new LocalRefusal('request.invalid', 'lookalike needs at least one company domain as a seed.', 'Ask the user for the domains of their best customers.');
  if (seeds.length > 50) {
    notes.push(`${seeds.length} seeds given; the first 50 were used`);
    seeds.length = 50;
  }
  if (seeds.length < 3) notes.push('fewer than 3 seeds: the shared profile is thin, so check `profile` before trusting the list');
  const body = compact({ seeds, max_accounts: args.max_accounts, exclude_seen: args.exclude_seen, min_trust: minTrust(args.min_trust), preview: args.preview === true ? true : undefined, purpose: args.purpose, max_credits: capFor('lookalike', args) });
  return withNotes(await client.lookalike(body), notes);
}

// ------------------------------------------------------------------ plans
const PAID_VERBS = ['validate', 'resolve', 'enrich', 'find', 'discover', 'lookalike'];

/**
 * Runs exactly what a preview quoted (its plan_id, good for 30 minutes). The plan holds the
 * request; only the cap is sent with it, and a cap is always needed: the preview said what it could cost.
 */
export async function runPlan(client, args = {}) {
  const verb = String(args.verb ?? '');
  if (!PAID_VERBS.includes(verb)) throw new LocalRefusal('request.invalid', `A plan runs one of ${PAID_VERBS.join(', ')}.`, 'Run the plan with the same command that previewed it.');
  const planId = typeof args.plan_id === 'string' ? args.plan_id.trim() : '';
  if (!PLAN_RE.test(planId)) throw new LocalRefusal('plan.not_found', `"${planId.slice(0, 40)}" is not a plan ID.`, 'A plan ID comes from a preview (--preview, or preview: true). Preview again for a new one.');
  if (!Number.isInteger(args.max_credits) || args.max_credits < 0) throw new LocalRefusal('cap_required', 'Running a plan needs max_credits: the preview said the most it could cost (credits_max).', 'Agree a budget with the user, then run the plan again with max_credits set to it.');
  const r = await client[verb]({ plan_id: planId, max_credits: args.max_credits });
  // Lists are followed to their end like any other call; a search's run is shown as a run.
  return ['validate', 'resolve', 'enrich'].includes(verb) ? settle(client, r) : r;
}

// ------------------------------------------------------------------ runs (all free)
const needRunId = (id) => {
  const s = typeof id === 'string' ? id.trim() : '';
  if (!RUN_ID_RE.test(s)) throw new LocalRefusal('run.not_found', `"${s.slice(0, 40)}" is not a run ID.`, 'A run ID comes from a call that carried on as a run; `agentic-id runs` lists them.');
  return s;
};

/** What a run's status means, in plain words, with what to do next. */
export function runStatusWords(r) {
  const id = r.run_id;
  const p = r.progress ?? {};
  const got = p.asked !== undefined ? `${p.delivered ?? 0} of ${p.asked} delivered` : p.parts ? `${p.parts.done} of ${p.parts.total} parts done` : '';
  switch (r.status) {
    case 'completed':
      return `Completed: everything asked for was delivered${got ? ` (${got})` : ''}.`;
    case 'exhausted': {
      const w = r.why_fewer;
      const left = w ? Object.entries(w.excluded ?? {}).map(([k, v]) => `${v} ${k.replace(/_/g, ' ')}`).join(', ') : '';
      return `Finished with fewer than asked (${w ? `${w.delivered} of ${w.asked} delivered` : got}).${w?.detail ? ` ${w.detail}` : ' Fewer exist that pass the checks.'}${left ? ` Left out: ${left}.` : ''}`;
    }
    case 'running':
      return `Running: more results are on the way${got ? ` (${got} so far)` : ''}.${r.waiting?.detail ? ` ${r.waiting.detail}` : ''}`;
    case 'paused':
      return r.reason === 'credits'
        ? `Paused: this workspace ran out of credits${got ? ` (${got})` : ''}. Buy more (agentic-id topup <credits>), then carry on: agentic-id runs resume ${id}`
        : r.reason === 'max_credits'
          ? `Paused: it reached its own credit cap${got ? ` (${got})` : ''}. To carry on, raise it: agentic-id runs resume ${id} --max-credits <a higher number>`
          : r.reason === 'source_cap'
            ? `Paused: it reached its budget for paid data${got ? ` (${got})` : ''}. To carry on with the same budget again: agentic-id runs resume ${id}`
            : `Paused${r.reason ? ` (${r.reason})` : ''}${got ? `, ${got}` : ''}. Carry on with: agentic-id runs resume ${id}`;
    case 'cancelled':
      return `Cancelled: it was stopped${got ? ` (${got})` : ''}. What was delivered stays delivered and charged; nothing more is spent.`;
    case 'failed':
      return `Failed: it could not run${r.error?.code ? ` (${r.error.code})` : ''}. Nothing more will come.`;
    default:
      return `Status: ${r.status}.`;
  }
}

const RUN_STATUSES = ['running', 'paused', 'finished'];
/** This workspace's runs, newest first. */
export async function runs(client, args = {}) {
  if (args.status !== undefined && !RUN_STATUSES.includes(args.status)) throw new LocalRefusal('request.invalid', `status is ${RUN_STATUSES.join(', ')}.`, 'Leave it out for every run.');
  const limit = args.limit === undefined ? undefined : Number(args.limit);
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 100)) throw new LocalRefusal('request.invalid', 'limit must be a whole number from 1 to 100.', 'Leave it out for the latest 20.');
  const r = await client.runs(compact({ status: args.status, limit }));
  const list = r.runs ?? [];
  return { summary: list.length ? `${plural(list.length, 'run')}${args.status ? ` ${args.status}` : ''}, newest first.` : `No runs${args.status ? ` ${args.status}` : ''} in this workspace.`, runs: list.map((x) => ({ ...x, in_words: runStatusWords(x) })) };
}

export async function runShow(client, args = {}) {
  const r = await client.run(needRunId(args.id));
  return { ...r, summary: runStatusWords(r) };
}

export async function runCancel(client, args = {}) {
  const r = await client.cancelRun(needRunId(args.id));
  return { ...r, summary: runStatusWords(r) };
}

export async function runResume(client, args = {}) {
  const id = needRunId(args.id);
  if (args.max_credits !== undefined && (!Number.isInteger(args.max_credits) || args.max_credits < 0)) throw new LocalRefusal('request.invalid', 'max_credits must be a whole number, 0 or more.', 'Give the new cap for the whole run, as a whole number of credits.');
  const cap = args.source_spend_cap_usd;
  if (cap !== undefined && (!Number.isFinite(cap) || cap < 0 || cap > 50)) throw new LocalRefusal('request.invalid', 'The paid-data budget is 0 to 50 USD.', 'Leave it out to give the run the same budget again.');
  const r = await client.resumeRun(id, compact({ max_credits: args.max_credits, source_spend_cap_usd: cap }));
  return { ...r, summary: runStatusWords(r) };
}

export async function runExport(client, args = {}) {
  const format = args.format ?? 'csv';
  if (!['csv', 'ndjson'].includes(format)) throw new LocalRefusal('request.invalid', 'format is csv or ndjson.', 'Leave it out for CSV.');
  const r = await client.exportRun(needRunId(args.id), format);
  return { ...r, summary: `A download link for every result of run ${r.run_id} as ${String(r.format ?? format).toUpperCase()}, good until ${String(r.expires_at ?? '').slice(0, 16).replace('T', ' ')} UTC. Anyone with the link can download this run's results until then: share it only with people who may see them.${r.note ? ` ${r.note}` : ''}` };
}

/**
 * Every result of a run that is ready, page by page. With `wait`, follows the run with long polls
 * until it is finished or paused. Reading again never charges again.
 */
export async function runResults(client, args = {}) {
  const id = needRunId(args.id);
  const records = [];
  let after = Number.isInteger(args.after) && args.after > 0 ? args.after : 0;
  let run;
  for (let pages = 0; pages < 100_000; pages += 1) {
    const page = await client.runResults(id, { after, wait: args.wait ? 20 : undefined });
    run = page.run;
    records.push(...(page.results ?? []));
    const moved = page.after !== undefined && page.after !== after;
    after = page.after ?? after;
    if (page.next === null) break;
    if (run?.status === 'paused') break;
    // Without --wait, stop once nothing new is ready: the run carries on by itself.
    if (!args.wait && !moved) break;
  }
  const finished = run && run.status !== 'running';
  return {
    run_id: id,
    run,
    summary: `${plural(records.length, 'result')} read from run ${id}. ${run ? runStatusWords(run) : ''}${!finished ? ` Read again later (from after ${after}) or add --wait to follow it to the end.` : ''} Reading results is free.`.trim(),
    results: records,
    after,
    finished: Boolean(finished),
  };
}

// ------------------------------------------------------------------ API keys
/** This workspace's API keys: prefix, name and dates; the key itself is never shown again. Free. */
export async function keys(client) {
  const r = await client.keys();
  const list = r.keys ?? [];
  const active = list.filter((k) => !k.revoked_at).length;
  return { summary: list.length ? `${plural(active, 'active key')}${list.length > active ? `, ${list.length - active} revoked` : ''}. Only the first characters of each key are shown; the key itself was shown once, when it was made.` : 'No API keys in this workspace yet. Make one with: agentic-id keys create --name <label>', keys: list };
}

/** Keys are made and revoked by a signed-in user only: refused here, before anything is sent, when a key is in use. */
function needSignIn(client) {
  if (client.authMode === 'key' || (client.authMode === undefined && client.apiKey)) {
    const e = new LocalRefusal('auth.sign_in_required', 'Only a signed-in user can make or revoke API keys, and this command is using an API key.', 'Run `agentic-id login`, and unset AGENTIC_ID_API_KEY (or AGENTIC_ID_API_KEY_FILE) for this command: a configured key is used instead of a sign-in.');
    e.status = 403;
    throw e;
  }
}

/** A new API key for this workspace. The answer holds the key once; it is never shown again. */
export async function createKey(client, args = {}) {
  const name = args.name === undefined ? undefined : String(args.name).trim();
  if (name !== undefined && (name.length < 1 || name.length > 64)) throw new LocalRefusal('request.invalid', 'A key name is 1 to 64 characters.', 'Give a short label such as "laptop" or "ci", or leave it out.');
  needSignIn(client);
  const r = await client.createKey(compact({ name }));
  return { ...r, summary: `API key "${r.name ?? name ?? 'api key'}" made (${r.prefix}).` };
}

/** Revoke a key by its prefix. It stops working within 30 seconds. */
export async function revokeKey(client, args = {}) {
  const prefix = typeof args.prefix === 'string' ? args.prefix.trim() : '';
  // A whole key pasted here would be sent in the address and land in logs: refused, and never repeated.
  if (!KEY_PREFIX_RE.test(prefix)) throw new LocalRefusal('request.invalid', prefix.length > 28 ? 'That looks like a whole key, not its prefix, so it was not sent.' : 'That is not a key prefix.', 'Give the prefix `agentic-id keys` shows, such as ic-live-AbC12_x. Never paste a whole key into a command.');
  needSignIn(client);
  const r = await client.revokeKey(prefix);
  return { ...r, prefix: r.prefix ?? prefix, summary: `Key ${r.prefix ?? prefix} revoked. It stops working within 30 seconds.` };
}

// ------------------------------------------------------------------ free reads
const needId = (id) => {
  const s = typeof id === 'string' ? id.trim() : '';
  if (!ID_RE.test(s)) throw new LocalRefusal('not_an_agentic_id', `"${s.slice(0, 40)}" is not an Agentic ID.`, 'Agentic IDs start with ic- and come from resolve, find or discover. Resolve the email or domain first.');
  return s;
};
export const facts = (client, args = {}) => client.facts(needId(args.id));
export const ledger = (client, args = {}) => client.ledger(needId(args.id));

/** Is the plugin set up? Never throws: says what is wrong and how to fix it. */
export async function status(client) {
  const mode = client.authMode ?? (client.apiKey ? 'key' : undefined);
  const base = { client: CLIENT, server_url: client.baseUrl, key_configured: Boolean(client.apiKey), signed_in: mode === 'signin', auth: mode ?? 'none' };
  if (!mode) {
    // Check the address first: a mistyped server URL is not something signing in can fix.
    const p = typeof client.probe === 'function' ? await client.probe() : { ok: true };
    if (!p.ok) return { ...base, ok: false, reachable: false, error: p.code, summary: p.detail, fix: new AgenticIdError(0, p.code, p.detail).fix };
  }
  if (!mode) return { ...base, ok: false, reachable: true, summary: 'Not signed in and no API key is configured.', fix: 'Sign the user in now: call agentic_id_login (it opens the browser and returns a link to show them). In a terminal: `agentic-id login`. Or they set an API key in the plugin options (Claude Code: /plugin, agentic-id, Configure).' };
  try {
    const me = await client.me();
    const how = mode === 'signin' ? 'signed in' : `key ${me.key_prefix}…`;
    // Credits ride along, so "am I connected and what can I spend" is one call.
    let credits;
    try {
      credits = typeof client.workspace === 'function' ? (await client.workspace())?.credits : undefined;
    } catch {
      /* the connection is fine; the balance is a bonus */
    }
    return {
      ...base,
      ok: true,
      summary: `Connected to ${client.baseUrl} as workspace ${me.workspace_id} (${how}).${credits ? ` ${credits.available} credits available.` : ''}`,
      workspace_id: me.workspace_id,
      key_prefix: me.key_prefix,
      scopes: me.scopes,
      contact_values: me.scopes?.includes('pii:read') ? 'readable' : 'emails in full; phones and LinkedIn partly hidden',
      ...(credits ? { credits_available: credits.available, credits_held: credits.held } : {}),
      more: 'agentic_id_workspace shows spend by tool and recent charges.',
    };
  } catch (e) {
    if (!(e instanceof AgenticIdError)) throw e;
    return { ...base, ok: false, summary: e.detail, ...e.toJSON() };
  }
}

// Sign-in runs in a small helper process of its own, not inside this server: Claude Code stops the
// server when a conversation ends, and a sign-in the user finishes a moment later in the browser
// must still be stored. The helper waits up to 5 minutes for the browser, stores the session and exits.
let helper;

// The agentic-id command the helper runs: cli/agentic-id, the same file the npm package installs.
export const CLI_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'agentic-id');

function startLoginHelper(baseUrl, env) {
  const dir = env.AGENTIC_ID_CONFIG_DIR?.trim() || join(homedir(), '.agentic-id');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const logFile = join(dir, 'login.log');
  writeFileSync(logFile, '', { mode: 0o600 }); // the helper's own words only: a link, then "Signed in"
  const fd = openSync(logFile, 'a', 0o600);
  const child = spawn(process.execPath, [CLI_SCRIPT, 'login'], {
    detached: true,
    stdio: ['ignore', fd, fd],
    env: { PATH: env.PATH ?? process.env.PATH, HOME: env.HOME ?? process.env.HOME, AGENTIC_ID_URL: baseUrl, AGENTIC_ID_CONFIG_DIR: dir, ...(env.AGENTIC_ID_NO_BROWSER ? { AGENTIC_ID_NO_BROWSER: env.AGENTIC_ID_NO_BROWSER } : {}) },
  });
  child.unref();
  closeSync(fd);
  return { logFile, startedAt: Date.now(), baseUrl };
}

const readLog = (h) => {
  try {
    return readFileSync(h.logFile, 'utf8');
  } catch {
    return '';
  }
};

/**
 * Sign in or out from inside Claude Code. The browser opens on the sign-in page; this returns at
 * once with the link, and the session is stored when the browser comes back, even if this
 * conversation has ended by then. Free.
 */
export async function signIn(client, args = {}) {
  const action = args.action ?? 'login';
  const env = client.env ?? process.env;
  if (action === 'logout') {
    helper = undefined;
    const was = await logout(client.baseUrl, { env, fetchImpl: client.fetch });
    return { signed_in: false, summary: was ? 'Signed out on this machine and on the server.' : 'There was no sign-in for this server.', ...(client.apiKey ? { note: 'An API key is still configured and is being used.' } : {}) };
  }
  if (action !== 'login') throw new LocalRefusal('request.invalid', 'action must be login or logout.', 'Leave it out to sign in.');
  if (client.authMode === 'signin') {
    helper = undefined;
    const s = await status(client);
    return { signed_in: s.ok && s.auth !== 'none', summary: s.ok ? `Signed in. ${s.summary}` : s.summary, ...(s.workspace_id ? { workspace_id: s.workspace_id } : {}) };
  }
  const waiting = helper && helper.baseUrl === client.baseUrl && Date.now() - helper.startedAt < 5 * 60_000;
  if (!waiting) helper = startLoginHelper(client.baseUrl, env);
  // The helper prints the link within a second or two (discovery and client registration first).
  let link;
  let log = '';
  for (let i = 0; i < 60; i += 1) {
    log = readLog(helper);
    link = log.match(/https?:\/\/\S+\/oauth\/authorize\?\S+/)?.[0];
    if (link || /fix:|does not offer sign-in|Could not reach|failed/i.test(log)) break;
    await new Promise((r) => setTimeout(r, 150));
  }
  if (!link) {
    const said = log.trim().split('\n').filter(Boolean);
    helper = undefined;
    throw new LocalRefusal('signin_failed', said[0] ?? 'Sign-in could not be started.', said.find((l) => /fix:/.test(l))?.replace(/^\s*fix:\s*/, '') ?? 'Check the server address in the plugin options, or use an API key.');
  }
  return {
    signed_in: false,
    status: 'waiting_for_browser',
    link,
    summary: `${env.AGENTIC_ID_NO_BROWSER ? 'Open the link in a browser on this machine' : 'The sign-in page should have opened in the browser; if it did not, open the link'}. The link works for 5 minutes. Once the page says you are signed in, it is stored on this machine even if this conversation has ended; ask again and I will confirm. On a machine with no browser, use an API key instead.`,
    ...(client.apiKey ? { note: 'An API key is configured and takes precedence over a sign-in until it is removed from the plugin options.' } : {}),
  };
}

/** When the current UTC day began, in this machine's own time: "05:30 today" or "17:00 yesterday". */
function utcDayStartLocal(now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const hhmm = `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`;
  const sameLocalDay = start.getFullYear() === now.getFullYear() && start.getMonth() === now.getMonth() && start.getDate() === now.getDate();
  return `${hhmm} ${sameLocalDay ? 'today' : 'yesterday'}`;
}

const credit = (n) => `${n} credit${n === 1 ? '' : 's'}`;

/** Who this workspace is and what it can spend, with the latest charges when asked. Free. */
export async function workspace(client, args = {}) {
  const recent = args.recent === undefined ? 10 : Number(args.recent);
  if (!Number.isInteger(recent) || recent < 0 || recent > 200) throw new LocalRefusal('request.invalid', 'recent must be a whole number from 0 to 200.', 'Leave it out for the last 10 movements.');
  const [w, c] = await Promise.all([client.workspace(), client.credits(recent)]);
  const top = c.spent.by_tool.slice(0, 3).map((t) => `${t.tool} ${t.credits}`).join(', ');
  return {
    workspace_id: w.workspace_id,
    signed_in_as: w.signed_in_as,
    credits: w.credits,
    spent: c.spent,
    recent: c.recent,
    // What each charge was for: the ID delivered, the tool, the credits. A company carries its name
    // or domain; a person is an ID only.
    delivered: (c.recent_ids ?? []).map((d) => ({ ...d, charged: d.credits > 0 })),
    delivered_note: 'An entry with 0 credits was free (an ID already held): do not count it as a charge.',
    // The latest credit purchases, when the server reports them (older servers do not).
    ...(Array.isArray(c.topups) ? { topups: c.topups } : {}),
    times_are: 'UTC',
    utc_today: new Date().toISOString().slice(0, 10),
    contributes: w.contributes,
    allowed_purposes: w.allowed_purposes,
    region: w.region,
    ids_held: w.ids_held,
    contact_values: w.scopes?.includes('pii:read') ? 'readable' : 'emails in full; phones and LinkedIn partly hidden',
    summary: `Workspace ${w.workspace_id}: ${credit(w.credits.available)} available${w.credits.held ? ` (${w.credits.held} held by running calls)` : ''}. Spent ${c.spent.today} today, counted since ${utcDayStartLocal()} on this machine's clock (the day is the UTC day ${new Date().toISOString().slice(0, 10)}, whatever the local date), ${c.spent.last_30_days} in 30 days${top ? ` (${top})` : ''}. ${w.ids_held} ID${w.ids_held === 1 ? '' : 's'} held. ${w.contributes ? 'Contributing: identifiers it sends help everyone resolve, and re-resolving an ID it holds is free.' : 'Private: identifiers it sends stay in this workspace.'}`,
  };
}

/**
 * Buy credits: asks the server for a payment link. Nothing is charged here and nothing is opened:
 * the user opens the link and pays there; the credits land seconds after. Free to ask.
 */
export async function topup(client, args = {}) {
  const credits = typeof args.credits === 'string' && /^\s*\d+\s*$/.test(args.credits) ? Number(args.credits) : args.credits;
  if (!Number.isInteger(credits) || credits <= 0) throw new LocalRefusal('request.invalid', 'credits must be a whole number above 0.', 'Say how many credits to buy, for example 1000 (one credit is $0.05).');
  for (const k of ['success_url', 'cancel_url']) {
    if (args[k] !== undefined && !/^https:\/\/\S+$/i.test(String(args[k]))) throw new LocalRefusal('request.invalid', `${k} must be an https:// address.`, `Leave ${k} out, or give a full https:// address.`);
  }
  const r = await client.topup(compact({ credits, success_url: args.success_url, cancel_url: args.cancel_url }));
  const usd = typeof r.amount_usd === 'number' ? ` ($${r.amount_usd.toFixed(2)})` : '';
  return {
    ...r,
    summary: r.summary ?? `A payment page for ${credit(r.credits ?? credits)}${usd} is ready. Open the link to pay.`,
    note: 'Nothing is charged until the payment page is paid. The credits land seconds after payment: check the balance with agentic-id workspace (or the credits tool). Never say the payment went through before the balance shows it.',
  };
}

const OUTCOMES = ['bounced', 'replied', 'wrong_person', 'confirmed'];
const REPORT_FIELDS = ['work_email', 'title', 'company_domain'];
const OUTCOME_ALIASES = { bounce: 'bounced', hard_bounce: 'bounced', reply: 'replied', responded: 'replied', wrong: 'wrong_person', 'wrong person': 'wrong_person', not_them: 'wrong_person', confirm: 'confirmed', crm_confirmed: 'confirmed', correct: 'confirmed' };

function cleanReport(r, where = '') {
  const outcome = OUTCOME_ALIASES[String(r?.outcome ?? '').trim().toLowerCase()] ?? String(r?.outcome ?? '').trim().toLowerCase();
  const field = FIELD_ALIASES?.[String(r?.field ?? 'work_email').trim().toLowerCase()] ?? String(r?.field ?? 'work_email').trim().toLowerCase();
  if (!OUTCOMES.includes(outcome)) throw new LocalRefusal('request.invalid', `${where}outcome must be one of ${OUTCOMES.join(', ')}.`, 'bounced: the email bounced. replied: they answered. wrong_person: it reached someone else. confirmed: your CRM confirms the value.');
  if (!REPORT_FIELDS.includes(field)) throw new LocalRefusal(/phone|personal/.test(field) ? 'personal_data' : 'request.invalid', `${where}field must be one of ${REPORT_FIELDS.join(', ')}.`, 'Report on the work email, the title or the company domain. Phone numbers and personal emails are not handled here.');
  return { id: needId(r?.id), field, outcome };
}

/**
 * Tell Agentic ID what happened after a value was used. One report (id, field, outcome) or up to
 * 200 in `reports`. Free. A bounced or wrong-person value is no longer served to this workspace;
 * nothing reported here is shown to another workspace.
 */
export async function report(client, args = {}) {
  const list = Array.isArray(args.reports) ? args.reports : args.id !== undefined ? [args] : [];
  if (!list.length) throw new LocalRefusal('request.invalid', 'Nothing to report.', 'Give id, field and outcome, or a "reports" list of them.');
  if (list.length > 200) throw new LocalRefusal('request.invalid', `${list.length} reports in one call.`, 'Send at most 200 at a time.');
  // One report: a mistake is refused outright. A list: a bad row is marked and the rest still go.
  const bad = [];
  const cleaned = [];
  list.forEach((r, i) => {
    try {
      cleaned.push(cleanReport(r, list.length > 1 ? `Report ${i + 1}: ` : ''));
    } catch (e) {
      if (list.length === 1 || !(e instanceof LocalRefusal)) throw e;
      bad.push({ id: String(r?.id ?? '').slice(0, 40), field: r?.field, outcome: r?.outcome, recorded: false, error: e.code, note: e.detail ?? e.message });
    }
  });
  if (!cleaned.length) throw new LocalRefusal('request.invalid', `None of the ${list.length} reports could be read.`, bad[0]?.note ?? 'Each needs an Agentic ID (ic-...) and an outcome.');
  // The same (id, field) twice: the last word wins, sent once.
  const unique = [...new Map(cleaned.map((r) => [`${r.id}\n${r.field}`, r])).values()];
  const results = [...bad];
  let stopped;
  for (const r of unique) {
    try {
      const out = await client.feedback(r);
      results.push({ ...r, recorded: out.recorded !== false, note: out.summary });
    } catch (e) {
      if (!(e instanceof AgenticIdError)) throw e;
      // One bad row does not sink the rest; an auth problem or an outage does.
      if (e.status === 401 || e.status === 403 || e.status === 0 || e.status >= 500) {
        if (results.length === bad.length) throw e;
        stopped = e.toJSON();
        break;
      }
      results.push({ ...r, recorded: false, error: e.code ?? `http_${e.status}`, note: e.detail });
    }
  }
  const ok = results.filter((r) => r.recorded).length;
  const counts = Object.fromEntries(OUTCOMES.map((o) => [o, results.filter((r) => r.recorded && r.outcome === o).length]).filter(([, n]) => n));
  return {
    summary: `${ok} of ${list.length} outcome${list.length === 1 ? '' : 's'} recorded${Object.keys(counts).length ? ` (${Object.entries(counts).map(([o, n]) => `${n} ${o}`).join(', ')})` : ''}. Nothing charged.${stopped ? ` Stopped early: ${stopped.message}` : ''}`,
    cost: { quoted_credits: 0, charged_credits: 0 },
    recorded: ok,
    results,
    ...(cleaned.length !== unique.length ? { input_notes: [`${cleaned.length - unique.length} repeated report(s) for the same ID and field were sent once.`] } : {}),
    ...(stopped ? { stopped, not_sent: unique.length - (results.length - bad.length) } : {}),
  };
}

// The operation behind each paid tool, so an estimate can check its arguments the same way the call would.
const PLANNED = { validate, resolve, resolve_many: resolveMany, enrich, find, discover, lookalike };
class PlanStop extends Error {}
// A client that stops the operation at its first request: everything before it (cleaning, local
// refusals, the cap) has run, and nothing is sent.
const planClient = new Proxy({}, { get: () => async () => { throw new PlanStop(); } });

/**
 * What a planned call could cost. The arguments are checked exactly as the call itself would check
 * them, so an estimate never reports "0 credits" for a call that would be refused: an argument the
 * tool does not take, or input with nothing usable in it, is refused here too.
 */
export async function estimateCall(_client, args = {}, catalog) {
  const tool = String(args.tool ?? '').replace(/^agentic_id_/, '');
  const planned = args.arguments ?? {};
  const est = estimate(tool, planned);
  if (!est || !PLANNED[tool]) throw new LocalRefusal('request.invalid', `Unknown tool "${args.tool}".`, 'Use one of: validate, resolve, resolve_many, enrich, find, discover, lookalike.');
  if (typeof planned !== 'object' || Array.isArray(planned)) throw new LocalRefusal('request.invalid', 'arguments must be an object: the arguments you would pass to the tool.', 'Pass the same arguments you would send to the tool.');
  const schema = catalog?.get(`agentic_id_${tool}`)?.inputSchema;
  if (schema) {
    const unknown = Object.keys(planned).filter((k) => !(k in schema.properties));
    if (unknown.length) {
      const byId = unknown.some((k) => /^(id|ids|agentic_id)$/i.test(k));
      throw new LocalRefusal('request.invalid', `agentic_id_${tool} does not take ${unknown.join(', ')}, so this call would be refused. Nothing was estimated.`, byId && tool === 'enrich' ? 'enrich takes what you know (a work email, a LinkedIn URL, a name with a company, or a company domain), not an Agentic ID. For what Agentic ID already holds on an ID, use agentic_id_facts.' : `Allowed: ${Object.keys(schema.properties).join(', ')}.`);
    }
  }
  const asked = Number(planned.max_accounts);
  if ((tool === 'discover' || tool === 'lookalike') && asked > RUN_MAX_TARGET) throw new LocalRefusal('request.invalid', `${asked} accounts in one search; the most is ${RUN_MAX_TARGET.toLocaleString('en-US')}.`, `Ask for at most ${RUN_MAX_TARGET.toLocaleString('en-US')}. More than 500 carry on as a run.`);
  // Run the call's own checks with a client that sends nothing. A refusal there is the answer.
  try {
    await PLANNED[tool](planClient, { ...planned, max_credits: planned.max_credits ?? 100000 });
  } catch (e) {
    if (!(e instanceof PlanStop)) throw e;
  }
  if (!est.free && !(est.max_credits > 0)) throw new LocalRefusal('request.invalid', `Nothing in these arguments can be ${tool === 'enrich' ? 'enriched' : 'priced'}, so the call would be refused.`, 'Check the arguments against the tool, then estimate again.');
  return { tool, ...est, summary: est.free ? `Free: ${est.arithmetic}.` : `At most ${est.max_credits} credits: ${est.arithmetic}. Only results are charged; misses are free.`, auto_capped: !est.free && est.max_credits <= AUTO_CAP };
}
