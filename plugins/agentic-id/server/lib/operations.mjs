// The operations behind both the MCP tools and the CLI. Each one cleans its input on this machine,
// refuses what should never be sent, sets a credit cap, makes the call (in batches when the list is
// longer than the API takes), and returns the API's answer with `input_notes` for anything it
// changed or held back.
import { AgenticIdError, CLIENT } from './client.mjs';
import { AUTO_CAP, estimate } from './estimate.mjs';
import { chunk, cleanCountry, cleanDomain, cleanEmails, cleanIdentifiers, cleanList, identityKey, isPersonalDomain } from './guards.mjs';

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

/** The cap to send. Small calls are capped at their own estimate; larger ones need the caller to say a number. */
function capFor(tool, args) {
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
  const cap = capFor('validate', { emails: send, max_credits: args.max_credits });
  let cost = { quoted_credits: 0, charged_credits: 0 };
  const results = [];
  const requestIds = [];
  let domainResult;
  let stopped;
  const batches = send.length ? chunk(send, 1000) : [[]];
  for (const [i, batch] of batches.entries()) {
    const left = cap === undefined ? undefined : cap - cost.charged_credits;
    if (batch.length && left !== undefined && left <= 0) {
      stopped = `stopped after ${results.length} addresses: the ${cap}-credit cap was reached`;
      break;
    }
    const r = await client.validate(compact({ emails: batch, domain: i === 0 ? domain : undefined, purpose: args.purpose, max_credits: left }));
    results.push(...(r.results ?? []));
    cost = sumCost(cost, r.cost);
    requestIds.push(r.request_id);
    domainResult ??= r.domain;
    if (batches.length === 1) return withNotes({ ...r, summary: held.length ? `${r.summary} Plus ${held.length} rejected on this machine without being sent.` : r.summary, results: [...(r.results ?? []), ...held] }, notes);
  }
  if (stopped) notes.push(stopped);
  const tally = {};
  for (const r of [...results, ...held]) tally[r.verdict] = (tally[r.verdict] ?? 0) + 1;
  return withNotes(
    compact({
      request_id: requestIds[0],
      request_ids: requestIds,
      summary: `${plural(results.length + held.length, 'email')} checked in ${plural(requestIds.length, 'batch', 'batches')}: ${Object.entries(tally).map(([k, v]) => `${v} ${k}`).join(', ')}. ${plural(cost.charged_credits, 'credit')} charged.`,
      cost,
      results: [...results, ...held],
      domain: domainResult,
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
  const body = compact({ identifiers, kind: args.kind, spend: args.spend === true ? true : undefined, purpose: args.purpose, max_credits: capFor('resolve', args) });
  return withNotes(await client.resolve(body), all);
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
    if (r.key && !byKey.has(r.key)) byKey.set(r.key, r);
  }
  const unique = [...byKey.values()];
  const cap = capFor('resolve_many', { records: unique, max_credits: args.max_credits });
  let cost = { quoted_credits: 0, charged_credits: 0 };
  let halted;
  const answers = new Map();
  const queue = [...unique];
  const worker = async () => {
    for (let r = queue.shift(); r; r = queue.shift()) {
      if (halted) return;
      if (cap - cost.charged_credits < 1) {
        halted = { error: 'cap_reached', message: `stopped: the ${cap}-credit cap was reached` };
        return;
      }
      try {
        const a = await client.resolve(compact({ identifiers: r.identifiers, kind: args.kind, spend: args.spend === true ? true : undefined, purpose: args.purpose, max_credits: 1 }));
        cost = sumCost(cost, a.cost);
        answers.set(r.key, compact({ id: a.id, outcome: a.outcome, matched_on: a.matched_on, confidence: a.confidence, reason: a.reason }));
      } catch (e) {
        if (!(e instanceof AgenticIdError)) throw e;
        // Money, auth and outage errors end the whole run; a bad row only fails that row.
        if ([401, 402, 0].includes(e.status) || e.status >= 500) halted = e.toJSON();
        else answers.set(r.key, { outcome: 'error', error: e.code ?? `http_${e.status}`, reason: e.detail });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, unique.length) }, worker));

  const out = rows.map((r) => {
    if (r.empty) return { row: r.row, outcome: 'skipped', reason: r.dropped.map((d) => `${d.field}: ${d.reason}`).join('; ') || 'no identifier' };
    const first = byKey.get(r.key);
    const a = answers.get(r.key) ?? { outcome: 'not_run', reason: halted?.message ?? 'stopped before this row' };
    return compact({ row: r.row, ...a, repeat_of_row: first.row !== r.row ? first.row : undefined });
  });
  const counts = {};
  for (const r of out) counts[r.outcome] = (counts[r.outcome] ?? 0) + 1;
  const byId = new Map();
  for (const r of out) if (r.id) byId.set(r.id, [...(byId.get(r.id) ?? []), r.row]);
  const sameId = [...byId.entries()].filter(([, v]) => v.length > 1).map(([id, v]) => ({ id, rows: v }));
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
export async function enrich(client, args = {}) {
  const notes = [];
  const people = [...(Array.isArray(args.contacts) ? args.contacts : []), ...(args.contact ? [args.contact] : [])].map((c) => cleanIdentifiers(c));
  const skipped = people.filter((p) => p.empty).length;
  const seen = new Set();
  const contacts = [];
  for (const p of people.filter((x) => !x.empty)) {
    const key = identityKey(p.identifiers) ?? JSON.stringify(p.identifiers);
    if (seen.has(key)) continue;
    seen.add(key);
    contacts.push(p.identifiers);
  }
  const repeats = people.length - skipped - contacts.length;
  if (skipped) notes.push(`${plural(skipped, 'contact')} had no usable work identifier and ${skipped === 1 ? 'was' : 'were'} not sent`);
  if (repeats) notes.push(`${plural(repeats, 'repeated contact')} enriched once`);
  let company;
  if (args.company) {
    const domain = cleanDomain(args.company.domain ?? args.company.website ?? '');
    if (domain && isPersonalDomain(domain)) notes.push(`${domain} is a mail provider, not the person's company; it was not sent`);
    else company = compact({ domain, name: typeof args.company.name === 'string' ? args.company.name.trim() : undefined });
    if (company && !Object.keys(company).length) company = undefined;
  }
  const fields = args.fields ? cleanList(args.fields, (f) => FIELD_ALIASES[f.toLowerCase().replace(/[\s-]+/g, '_')] ?? f.toLowerCase().replace(/[\s-]+/g, '_')) : undefined;
  if (fields?.some((f) => /phone|mobile/i.test(f))) throw new LocalRefusal('phone_not_supported', 'Phone numbers are not enriched through this plugin.', 'Remove phone and mobile from fields. Agentic ID here is for work identities: title, company, work email, firmographics.');
  const allowed = new Set([...(contacts.length || !company ? PERSON_FIELDS : []), ...(company ? COMPANY_FIELDS : [])]);
  const unknownFields = (fields ?? []).filter((f) => !allowed.has(f));
  if (unknownFields.length) throw new LocalRefusal('request.invalid', `Unknown field${unknownFields.length === 1 ? '' : 's'}: ${unknownFields.join(', ')}.`, `Allowed here: ${[...allowed].join(', ')}.`);
  if (!contacts.length && !company) throw new LocalRefusal('nothing_to_enrich', skipped ? `None of the ${plural(skipped, 'contact')} had a usable work identifier.` : 'Nothing to enrich: send contact, contacts or company.', 'Each contact needs a work email, a LinkedIn profile URL, or a name with a company.');
  const cap = capFor('enrich', { contacts, company, fields, max_credits: args.max_credits });
  if (contacts.length <= 100) {
    const r = await client.enrich(compact({ ...(contacts.length === 1 && !args.contacts ? { contact: contacts[0] } : { contacts }), company, fields, purpose: args.purpose, max_credits: cap }));
    return withNotes(r, notes);
  }
  let cost = { quoted_credits: 0, charged_credits: 0 };
  const results = [];
  const requestIds = [];
  for (const [i, batch] of chunk(contacts, 100).entries()) {
    const left = cap - cost.charged_credits;
    if (left <= 0) {
      notes.push(`stopped after ${results.length} contacts: the ${cap}-credit cap was reached`);
      break;
    }
    const r = await client.enrich(compact({ contacts: batch, company: i === 0 ? company : undefined, fields, purpose: args.purpose, max_credits: left }));
    results.push(...(r.results ?? []));
    cost = sumCost(cost, r.cost);
    requestIds.push(r.request_id);
  }
  const enriched = results.filter((r) => r.fields?.length).length;
  return withNotes({ request_id: requestIds[0], request_ids: requestIds, summary: `${plural(results.length, 'contact')} in ${plural(requestIds.length, 'batch', 'batches')}: ${enriched} enriched. ${plural(cost.charged_credits, 'credit')} charged.`, cost, results }, notes);
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
  const limit = Math.min(Math.max(Number.isFinite(Number(args.limit)) ? Math.trunc(Number(args.limit)) : 5, 1), 25);
  if (args.limit > 25) notes.push('limit lowered to 25, the most one find call returns; call again for more (people already delivered are skipped)');
  const body = compact({ account: compact({ id, domain }), roles, seniority, countries: args.countries ? cleanList(args.countries, cleanCountry) : undefined, limit, exclude_seen: args.exclude_seen, purpose: args.purpose, max_credits: capFor('find', { limit, max_credits: args.max_credits }) });
  return withNotes(await client.find(body), notes);
}

// ------------------------------------------------------------------ discover
export async function discover(client, args = {}) {
  const notes = [];
  const af = args.account_filters ?? {};
  const cf = args.contact_filters;
  const min = af.employees_min;
  const max = af.employees_max;
  if (min !== undefined && max !== undefined && min > max) throw new LocalRefusal('request.invalid', `employees_min (${min}) is larger than employees_max (${max}).`, 'Swap them or drop one.');
  const account_filters = compact({ industry: cleanList(af.industry), country: cleanList(af.country, cleanCountry), employees_min: min, employees_max: max, technologies: cleanList(af.technologies), keywords: cleanList(af.keywords), keywords_required: af.keywords_required });
  const contact_filters = cf ? compact({ job_title: cleanList(cf.job_title), job_level: Array.isArray(cf.job_level) ? cleanList(cf.job_level) : cf.job_level, countries: cleanList(cf.countries, cleanCountry), per_account: cf.per_account, min_company_size: cf.min_company_size }) : undefined;
  const hasContact = contact_filters && Object.keys(contact_filters).length > 0;
  if (!Object.keys(account_filters).length && !hasContact) throw new LocalRefusal('request.invalid', 'discover needs at least one filter.', 'Give account_filters (industry, country, employees_min/max, technologies, keywords) and optionally contact_filters.');
  if (hasContact && !contact_filters.job_title && !contact_filters.job_level) throw new LocalRefusal('find.persona_unreadable', 'contact_filters needs a job_title or a job_level.', 'Add the titles or seniority the user is after, or leave contact_filters out to get accounts only.');
  if (Object.keys(account_filters).length === 1 && account_filters.country) notes.push('a country on its own matches a very large number of companies; add an industry or a size range');
  const count_only = args.count_only === true;
  let cap;
  try {
    cap = capFor('discover', { ...args, contact_filters: hasContact ? contact_filters : undefined, count_only });
  } catch (e) {
    if (e instanceof LocalRefusal && e.code === 'cap_required') e.fix = 'Run it once with count_only: true (free) to see how many match, agree a budget with the user, then call again with max_credits.';
    throw e;
  }
  const body = compact({ account_filters, contact_filters: hasContact ? contact_filters : undefined, max_accounts: args.max_accounts, exclude_seen: args.exclude_seen, count_only: count_only || undefined, purpose: args.purpose, max_credits: count_only ? undefined : cap });
  if (!body.account_filters) body.account_filters = {};
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
  const body = compact({ seeds, max_accounts: args.max_accounts, exclude_seen: args.exclude_seen, purpose: args.purpose, max_credits: capFor('lookalike', args) });
  return withNotes(await client.lookalike(body), notes);
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
  if (!mode) return { ...base, ok: false, summary: 'Not signed in and no API key is configured.', fix: 'Run `agentic-id login` to sign in with your iCustomer account, or set an API key in the plugin options (Claude Code: /plugin, agentic-id, Configure) or AGENTIC_ID_API_KEY.' };
  try {
    const me = await client.me();
    const how = mode === 'signin' ? 'signed in' : `key ${me.key_prefix}…`;
    return { ...base, ok: true, summary: `Connected to ${client.baseUrl} as workspace ${me.workspace_id} (${how}).`, workspace_id: me.workspace_id, key_prefix: me.key_prefix, scopes: me.scopes, contact_values: me.scopes?.includes('pii:read') ? 'readable' : 'masked (this caller has no pii:read scope)' };
  } catch (e) {
    if (!(e instanceof AgenticIdError)) throw e;
    return { ...base, ok: false, summary: e.detail, ...e.toJSON() };
  }
}

export function estimateCall(_client, args = {}) {
  const tool = String(args.tool ?? '').replace(/^agentic_id_/, '');
  const est = estimate(tool, args.arguments ?? {});
  if (!est) throw new LocalRefusal('request.invalid', `Unknown tool "${args.tool}".`, 'Use one of: validate, resolve, resolve_many, enrich, find, discover, lookalike.');
  return { tool, ...est, summary: est.free ? `Free: ${est.arithmetic}.` : `At most ${est.max_credits} credits: ${est.arithmetic}. Only results are charged; misses are free.`, auto_capped: !est.free && est.max_credits <= AUTO_CAP };
}
