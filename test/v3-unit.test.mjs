// Unit tests for the V3 layer the plugin ships: input guards, estimates, CSV, the operations
// (against a fake API client) and the CLI. No network.
//   node --test test/v3-unit.test.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer as createHttp } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { main } from '../cli/cli.mjs';
import { AgenticId, AgenticIdError, keyFromEnv, urlFromEnv } from '../cli/lib/client.mjs';
import { mapColumns, parseCsv, toCsv } from '../cli/lib/csv.mjs';
import { estimate } from '../cli/lib/estimate.mjs';
import { cleanCountry, cleanDomain, cleanEmail, cleanEmails, cleanIdentifiers, cleanLinkedin, cleanList, looksLikePhone } from '../cli/lib/guards.mjs';
import * as ops from '../cli/lib/operations.mjs';

/** A stand-in for the API client: records every call, answers from `replies` (a function per verb). */
function fake(replies = {}) {
  const calls = [];
  const verb = (name) => async (body) => {
    calls.push({ verb: name, body });
    const r = replies[name];
    return typeof r === 'function' ? r(body, calls.filter((c) => c.verb === name).length) : r ?? { request_id: `req_${calls.length}`, summary: `${name} ok`, cost: { quoted_credits: 0, charged_credits: 0 }, results: [] };
  };
  return { calls, apiKey: 'k', baseUrl: 'http://fake', validate: verb('validate'), resolve: verb('resolve'), enrich: verb('enrich'), find: verb('find'), discover: verb('discover'), lookalike: verb('lookalike'), facts: verb('facts'), ledger: verb('ledger'), me: verb('me'), workspace: verb('workspace'), credits: verb('credits'), feedback: verb('feedback'), topup: verb('topup'), runs: verb('runs'), run: verb('run'), runResults: verb('runResults'), runReply: verb('runReply'), cancelRun: verb('cancelRun'), resumeRun: verb('resumeRun'), exportRun: verb('exportRun'), keys: verb('keys'), createKey: verb('createKey'), revokeKey: verb('revokeKey'), followRun: verb('followRun') };
}
const refused = async (fn) => {
  try {
    await fn();
  } catch (e) {
    assert.ok(e instanceof AgenticIdError, `expected a refusal, got ${e}`);
    return e;
  }
  assert.fail('expected a refusal');
};

// ------------------------------------------------------------------ guards
// Tests never write to the real ~/.agentic-id (the usage log, the remembered server address).
process.env.AGENTIC_ID_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'aid-unit-cfg-'));

test('emails: what people paste is tidied', () => {
  assert.equal(cleanEmail('Jane Doe <Jane.Doe@Acme.io>').email, 'jane.doe@acme.io');
  assert.equal(cleanEmail('mailto:jane@acme.io?subject=hi').email, 'jane@acme.io');
  assert.equal(cleanEmail(' JANE@ACME.IO; ').email, 'jane@acme.io');
  assert.equal(cleanEmail('jane​@acme.io').email, 'jane@acme.io', 'zero-width characters from a copy-paste are removed');
  assert.equal(cleanEmail('jane+news@acme.co.uk').ok, true);
});

test('emails: malformed, personal, shared and test addresses are told apart', () => {
  for (const bad of ['', 'jane', 'jane@', '@acme.io', 'jane@@acme.io', 'jane@acme', 'ja ne@acme.io', 'jane..doe@acme.io']) assert.equal(cleanEmail(bad).ok, false, bad);
  assert.equal(cleanEmail('me@gmail.com').reason, 'personal_email');
  assert.equal(cleanEmail('me@GoogleMail.com').reason, 'personal_email');
  assert.equal(cleanEmail('sales@acme.io').role, true);
  assert.equal(cleanEmail('jane@acme.io').role, false);
  assert.equal(cleanEmail('test@acme.io').warning, 'looks_like_test_data');
  assert.equal(cleanEmail('jane@example.com').warning, 'looks_like_test_data');
});

test('email lists: repeats once, personal never sent, counts kept', () => {
  const r = cleanEmails(['a@acme.io', 'A@Acme.io', 'b@gmail.com', 'nope', '', 'c@acme.io']);
  assert.deepEqual(r.send, ['a@acme.io', 'c@acme.io']);
  assert.equal(r.duplicates, 1);
  assert.deepEqual(r.held.map((h) => h.reason), ['personal_email_not_b2b', 'email_malformed']);
  assert.deepEqual(cleanEmails('a@acme.io, b@acme.io;c@acme.io\nd@acme.io').send.length, 4, 'a pasted string is split');
});

test('domains: URLs, www, paths, ports, case, trailing dots, international names', () => {
  assert.equal(cleanDomain('https://www.Acme.io/about?x=1#y'), 'acme.io');
  assert.equal(cleanDomain('acme.io/'), 'acme.io');
  assert.equal(cleanDomain('ACME.IO.'), 'acme.io');
  assert.equal(cleanDomain('http://acme.io:8080/x'), 'acme.io');
  assert.equal(cleanDomain('shop.acme.co.uk'), 'shop.acme.co.uk');
  assert.equal(cleanDomain('münchen.de'), 'xn--mnchen-3ya.de');
  for (const bad of ['', 'acme', 'jane@acme.io', 'not a domain', 'http://', '192.168.1.1', 'acme..io']) assert.equal(cleanDomain(bad), undefined, bad);
});

test('LinkedIn: one shape, no tracking, person vs company, internal links refused', () => {
  assert.deepEqual(cleanLinkedin('linkedin.com/in/Jane-Doe-123/?utm_source=x'), { ok: true, kind: 'person', url: 'https://www.linkedin.com/in/jane-doe-123' });
  assert.equal(cleanLinkedin('https://uk.linkedin.com/in/jane-doe/details/experience/').url, 'https://www.linkedin.com/in/jane-doe');
  assert.equal(cleanLinkedin('https://www.linkedin.com/company/acme/about/').kind, 'company');
  assert.equal(cleanLinkedin('https://www.linkedin.com/sales/lead/ACwAAA,NAME').reason, 'not_a_public_profile_url');
  assert.equal(cleanLinkedin('https://twitter.com/jane').reason, 'not_linkedin');
  assert.equal(cleanLinkedin('https://evil-linkedin.com/in/jane').reason, 'not_linkedin');
  assert.equal(cleanLinkedin('https://www.linkedin.com/feed/').reason, 'not_a_profile_url');
});

test('phones are recognised so they can be kept out', () => {
  for (const p of ['+1 (555) 010-0199', '020 7946 0000', '5550100199']) assert.equal(looksLikePhone(p), true, p);
  for (const p of ['Jane Doe', '2024', 'acme.io']) assert.equal(looksLikePhone(p), false, p);
});

test('countries and lists', () => {
  assert.equal(cleanCountry('UK'), 'GB');
  assert.equal(cleanCountry('usa'), 'US');
  assert.equal(cleanCountry('gb'), 'GB');
  assert.equal(cleanCountry('Germany'), 'Germany', 'full names are left for the server to read');
  assert.deepEqual(cleanList('CTO, cto; VP Eng\n'), ['CTO', 'VP Eng']);
  assert.deepEqual(cleanList(['a', '', ' a ', 'b']), ['a', 'b']);
});

test('identifiers: spreadsheet names accepted, consumer data dropped with a reason', () => {
  const r = cleanIdentifiers({ work_email: 'Jane@Acme.io', first_name: 'Jane', last_name: 'Doe', company: ' Acme  Inc ', website: 'https://acme.io/', phone: '+1 555 0100' });
  assert.deepEqual(r.identifiers, { email: 'jane@acme.io', name: 'Jane Doe', company_name: 'Acme Inc', company_domain: 'acme.io' });
  assert.deepEqual(r.dropped, [{ field: 'phone', reason: 'phone_numbers_are_not_sent' }]);
  const p = cleanIdentifiers({ email: 'jane@gmail.com', domain: 'gmail.com' });
  assert.equal(p.empty, true);
  assert.deepEqual(p.dropped.map((d) => d.reason), ['personal_email', 'personal_mail_provider_is_not_a_company']);
  assert.equal(cleanIdentifiers({ name: '+1 555 010 0199' }).empty, true, 'a phone in the name column is not a name');
  assert.equal(cleanIdentifiers({ linkedin: 'https://www.linkedin.com/company/acme' }).empty, true, 'a company page is not a person');
});

// ------------------------------------------------------------------ estimate
test('estimates follow the rate card', () => {
  assert.equal(estimate('validate', { emails: ['a', 'b', 'c'] }).max_credits, 3);
  assert.equal(estimate('validate', { domain: 'acme.io' }).free, true);
  assert.equal(estimate('resolve', {}).max_credits, 1);
  assert.equal(estimate('enrich', { contacts: [{}, {}], company: {} }).max_credits, 5);
  assert.equal(estimate('find', {}).max_credits, 10, 'default limit 5 x 2');
  assert.equal(estimate('find', { limit: 25 }).max_credits, 50);
  assert.equal(estimate('discover', { count_only: true }).free, true);
  assert.equal(estimate('discover', {}).max_credits, 25);
  assert.equal(estimate('discover', { max_accounts: 50, contact_filters: { per_account: 2 } }).max_credits, 250);
  assert.equal(estimate('lookalike', { max_accounts: 10 }).max_credits, 10);
  assert.equal(estimate('nope', {}), undefined);
});

// ------------------------------------------------------------------ csv
test('csv: quotes, embedded newlines, CRLF, BOM, semicolons', () => {
  const a = parseCsv('﻿Name,Note\r\n"Doe, Jane","said ""hi""\nthen left"\r\n\r\nBob,x\r\n');
  assert.deepEqual(a.rows, [{ Name: 'Doe, Jane', Note: 'said "hi"\nthen left' }, { Name: '', Note: '' }, { Name: 'Bob', Note: 'x' }], 'a blank row is kept, so row numbers hold');
  assert.deepEqual([a.bom, a.eol], [true, '\r\n']);
  const b = parseCsv('Email;Firma\na@acme.io;Acme GmbH\n');
  assert.equal(b.delimiter, ';');
  assert.equal(b.rows[0].Firma, 'Acme GmbH');
  assert.equal(parseCsv('').rows.length, 0);
  assert.equal(parseCsv('Email\na@acme.io').rows.length, 1, 'no trailing newline');
});

test('csv: output is safe to open in a spreadsheet and round-trips', () => {
  const out = toCsv(['a', 'b'], [{ a: '=HYPERLINK("x")', b: 'x,y' }, { a: -5, b: '@cmd' }, { a: 'plain', b: undefined }]);
  assert.equal(out, `a,b\n"'=HYPERLINK(""x"")","x,y"\n-5,'@cmd\nplain,\n`);
  assert.deepEqual(parseCsv(toCsv(['x'], [{ x: 'line1\nline2' }])).rows, [{ x: 'line1\nline2' }]);
});

test('csv: columns are found by the names exports really use', () => {
  const m = mapColumns(['Email Address', 'First Name', 'Last Name', 'Account Name', 'Website', 'Person Linkedin Url', 'Stage']);
  assert.deepEqual(m, { email: 'Email Address', linkedin_url: 'Person Linkedin Url', first_name: 'First Name', last_name: 'Last Name', company_name: 'Account Name', company_domain: 'Website' });
  assert.equal(mapColumns(['Kontakt'], { email: 'kontakt' }).email, 'Kontakt');
  assert.throws(() => mapColumns(['a'], { email: 'missing' }), /No column "missing"/);
});

// ------------------------------------------------------------------ operations
test('validate: only work emails are sent, the answer covers every input', async () => {
  const c = fake({ validate: (b) => ({ request_id: 'req_1', summary: '1 email checked: 1 valid. 1 credit charged.', cost: { quoted_credits: 1, charged_credits: 1 }, results: b.emails.map((email) => ({ email, verdict: 'valid', role: false })) }) });
  const r = await ops.validate(c, { emails: ['Jane <jane@acme.io>', 'jane@acme.io', 'x@gmail.com', 'bad'] });
  assert.deepEqual(c.calls[0].body, { emails: ['jane@acme.io'], max_credits: 1 });
  assert.deepEqual(r.results.map((x) => x.verdict), ['valid', 'rejected', 'rejected']);
  assert.equal(r.input_notes.length, 2);
  assert.match(r.summary, /Plus 2 rejected on this machine/);
});

test('validate: nothing but personal addresses makes no call at all', async () => {
  const c = fake();
  const r = await ops.validate(c, { emails: ['a@gmail.com', 'b@yahoo.com'] });
  assert.equal(c.calls.length, 0);
  assert.equal(r.cost.charged_credits, 0);
  assert.equal(r.results.length, 2);
  assert.equal((await refused(() => ops.validate(c, {}))).code, 'request.invalid');
});

test('validate: a long list goes in batches of 1,000 and stops at the cap', async () => {
  const emails = Array.from({ length: 2500 }, (_, i) => `p${i}@acme.io`);
  const c = fake({ validate: (b) => ({ request_id: 'r', summary: '', cost: { quoted_credits: b.emails.length, charged_credits: Math.min(b.emails.length, b.max_credits) }, results: b.emails.map((email) => ({ email, verdict: 'valid', role: false })) }) });
  assert.equal((await refused(() => ops.validate(c, { emails }))).code, 'cap_required', 'a 2,500-credit call is not sent without a cap');
  const r = await ops.validate(c, { emails, max_credits: 1500 });
  // Never more addresses in a batch than the cap has left to pay for (Vicky #12): the second batch is 500, not 1,000.
  assert.deepEqual(c.calls.map((x) => [x.body.emails.length, x.body.max_credits]), [[1000, 1500], [500, 500]]);
  assert.equal(r.cost.charged_credits, 1500);
  assert.match(r.input_notes.at(-1), /cap was reached/);
  assert.equal(r.partial, true);
  assert.equal(r.not_checked, 1000);
  assert.equal(r.results.filter((x) => x.verdict === 'not_checked').length, 1000);
  assert.match(r.summary, /Partial: 1000 not checked/);
});

test('resolve: cleaned, capped at 1, and refused locally when it cannot work', async () => {
  const c = fake({ resolve: { request_id: 'r', summary: 'known', cost: { quoted_credits: 1, charged_credits: 0 }, id: 'ic-abc123', outcome: 'known' } });
  const r = await ops.resolve(c, { identifiers: { email: 'JANE@Acme.io', company_domain: 'https://acme.io/x', phone: '+1 555 0100' } });
  assert.deepEqual(c.calls[0].body, { identifiers: { email: 'jane@acme.io', company_domain: 'acme.io' }, max_credits: 1 });
  assert.match(r.input_notes[0], /phone was not sent/);
  assert.equal((await refused(() => ops.resolve(c, { identifiers: { email: 'x@gmail.com' } }))).code, 'nothing_to_resolve');
  assert.equal((await refused(() => ops.resolve(c, { identifiers: { name: 'John Smith' } }))).code, 'name_alone');
  assert.equal(c.calls.length, 1, 'refusals never reach the API');
});

test('resolve_many: repeats paid once, duplicates grouped, personal rows skipped, cap honoured', async () => {
  const ids = { 'jane@acme.io': 'ic-jane00', 'https://www.linkedin.com/in/jane-doe': 'ic-jane00', 'bob@acme.io': 'ic-bob000' };
  const c = fake({ resolve: (b) => ({ request_id: 'r', summary: '', cost: { quoted_credits: 1, charged_credits: 1 }, id: ids[b.identifiers.email ?? b.identifiers.linkedin_url], outcome: 'known' }) });
  const r = await ops.resolveMany(c, { records: [{ email: 'jane@acme.io' }, { email: 'Jane@Acme.io' }, { linkedin_url: 'linkedin.com/in/Jane-Doe?x=1' }, { email: 'bob@acme.io' }, { email: 'me@gmail.com' }], max_credits: 10 });
  assert.equal(c.calls.length, 3);
  assert.equal(r.cost.charged_credits, 3);
  assert.deepEqual(r.rows.map((x) => x.outcome), ['known', 'known', 'known', 'known', 'skipped']);
  assert.equal(r.rows[1].repeat_of_row, 1);
  assert.deepEqual(r.same_id, [{ id: 'ic-jane00', rows: [1, 2, 3] }]);

  const tight = fake({ resolve: () => ({ cost: { quoted_credits: 1, charged_credits: 1 }, id: 'ic-x00000', outcome: 'new' }) });
  const t = await ops.resolveMany(tight, { records: Array.from({ length: 6 }, (_, i) => ({ email: `p${i}@acme.io` })), max_credits: 2 }, { concurrency: 1 });
  assert.equal(tight.calls.length, 2);
  assert.equal(t.counts.not_run, 4);
  assert.equal(t.stopped.error, 'cap_reached');
});

test('resolve_many: a bad row fails alone; no credits or an outage stops the run', async () => {
  const c = fake({ resolve: (b) => { if (b.identifiers.email === 'bad@acme.io') throw new AgenticIdError(400, 'request.invalid', 'nope'); return { cost: { quoted_credits: 1, charged_credits: 1 }, id: 'ic-ok0000', outcome: 'new' }; } });
  const r = await ops.resolveMany(c, { records: [{ email: 'bad@acme.io' }, { email: 'ok@acme.io' }], max_credits: 5 }, { concurrency: 1 });
  assert.deepEqual(r.rows.map((x) => x.outcome), ['error', 'new']);
  const broke = fake({ resolve: () => { throw new AgenticIdError(402, 'credits.insufficient', 'empty wallet'); } });
  const s = await ops.resolveMany(broke, { records: [{ email: 'a@acme.io' }, { email: 'b@acme.io' }, { email: 'c@acme.io' }], max_credits: 5 }, { concurrency: 1 });
  assert.equal(broke.calls.length, 1, 'it does not keep hitting an empty wallet');
  assert.equal(s.stopped.error, 'credits.insufficient');
  assert.equal((await refused(() => ops.resolveMany(c, { records: Array.from({ length: 501 }, () => ({ email: 'a@acme.io' })) }))).code, 'too_many_rows');
});

test('enrich: phone is refused, empties are skipped, repeats go once, big lists are capped', async () => {
  const c = fake({ enrich: (b) => ({ request_id: 'r', summary: 'ok', cost: { quoted_credits: 2, charged_credits: 2 }, results: (b.contacts ?? [b.contact]).map(() => ({ status: 'enriched', reason: '', fields: [] })) }) });
  assert.equal((await refused(() => ops.enrich(c, { contact: { email: 'a@acme.io' }, fields: ['title', 'mobile_phone'] }))).code, 'phone_not_supported');
  assert.equal((await refused(() => ops.enrich(c, { contacts: [{ email: 'a@gmail.com' }] }))).code, 'nothing_to_enrich');
  const r = await ops.enrich(c, { contacts: [{ email: 'a@acme.io' }, { email: 'A@acme.io' }, { email: 'x@gmail.com' }], fields: 'title, work_email' });
  assert.deepEqual(c.calls[0].body, { contacts: [{ email: 'a@acme.io' }], fields: ['title', 'work_email'], max_credits: 2 });
  assert.equal(r.input_notes.length, 2);
  assert.equal((await refused(() => ops.enrich(c, { contacts: Array.from({ length: 20 }, (_, i) => ({ email: `p${i}@acme.io` })) }))).code, 'cap_required');
  await ops.enrich(c, { company: { domain: 'https://www.acme.io' } });
  assert.deepEqual(c.calls.at(-1).body, { company: { domain: 'acme.io' }, max_credits: 1 });
});

test('find: needs a company and a persona; the limit and cap are bounded', async () => {
  const c = fake();
  assert.equal((await refused(() => ops.find(c, { roles: ['CTO'] }))).code, 'account_required');
  assert.equal((await refused(() => ops.find(c, { account: { domain: 'gmail.com' }, roles: ['CTO'] }))).code, 'not_a_company');
  assert.equal((await refused(() => ops.find(c, { account: { domain: 'acme.io' } }))).code, 'find.persona_unreadable');
  assert.equal((await refused(() => ops.find(c, { account: { domain: 'acme.io' }, roles: ['CTO'], limit: 20 }))).code, 'cap_required');
  await ops.find(c, { account: { domain: 'https://Acme.io/team' }, roles: 'CTO, VP Eng', countries: ['UK'], limit: 3 });
  assert.deepEqual(c.calls[0].body, { account: { domain: 'acme.io' }, roles: ['CTO', 'VP Eng'], countries: ['GB'], limit: 3, max_credits: 6 });
  // More than 25 people carry on as a run on the server: the limit is sent as asked, up to 50,000.
  await ops.find(c, { account: { domain: 'acme.io' }, seniority: 'director+', limit: 99, max_credits: 50 });
  assert.equal(c.calls[1].body.limit, 99);
  const r = await ops.find(c, { account: { domain: 'acme.io' }, seniority: 'director+', limit: 60000, max_credits: 50 });
  assert.equal(c.calls[2].body.limit, 50000);
  assert.match(r.input_notes[0], /lowered to 50,000/);
});

test('discover: count_only is free and never capped; a real run points to it first', async () => {
  const c = fake();
  await ops.discover(c, { account_filters: { country: ['UK', 'uk'], industry: 'software' }, count_only: true });
  assert.deepEqual(c.calls[0].body, { account_filters: { industry: ['software'], country: ['GB'] }, count_only: true });
  const e = await refused(() => ops.discover(c, { account_filters: { country: ['GB'] } }));
  assert.equal(e.code, 'cap_required');
  assert.match(e.fix, /count_only/);
  assert.equal((await refused(() => ops.discover(c, {}))).code, 'request.invalid');
  assert.equal((await refused(() => ops.discover(c, { account_filters: { employees_min: 500, employees_max: 50 } }))).code, 'request.invalid');
  assert.equal((await refused(() => ops.discover(c, { account_filters: { country: ['GB'] }, contact_filters: { per_account: 2 } }))).code, 'find.persona_unreadable');
  await ops.discover(c, { account_filters: { country: ['GB'] }, max_accounts: 5 });
  assert.equal(c.calls.at(-1).body.max_credits, 5, 'a small run is capped at its own estimate');
});

test('lookalike: seeds may be URLs or work emails; junk is ignored and said', async () => {
  const c = fake();
  const r = await ops.lookalike(c, { seeds: ['https://www.acme.io/', 'jane@globex.com', 'acme.io', 'gmail.com', 'not a domain'], max_accounts: 5 });
  assert.deepEqual(c.calls[0].body, { seeds: ['acme.io', 'globex.com'], max_accounts: 5, max_credits: 5 });
  assert.match(r.input_notes.join(' '), /2 seeds ignored.*fewer than 3 seeds/);
  assert.equal((await refused(() => ops.lookalike(c, { seeds: ['gmail.com'] }))).code, 'request.invalid');
});

test('facts and ledger take only an Agentic ID', async () => {
  const c = fake();
  assert.equal((await refused(() => ops.facts(c, { id: 'jane@acme.io' }))).code, 'not_an_agentic_id');
  assert.equal((await refused(() => ops.ledger(c, {}))).code, 'not_an_agentic_id');
  await ops.facts(c, { id: ' ic-1VcQFNN5zwWguwAUaHEBNk ' });
  assert.equal(c.calls[0].body, 'ic-1VcQFNN5zwWguwAUaHEBNk');
});

test('status never throws: no key, a bad key and an outage each say what to do', async () => {
  assert.match((await ops.status({ baseUrl: 'http://x', apiKey: undefined })).fix, /plugin options/);
  const bad = await ops.status({ baseUrl: 'http://x', apiKey: 'k', me: async () => { throw new AgenticIdError(401, 'auth.invalid_key', 'bad key'); } });
  assert.equal(bad.ok, false);
  assert.equal(bad.error, 'auth.invalid_key');
  const ok = await ops.status({ baseUrl: 'http://x', apiKey: 'k', me: async () => ({ workspace_id: 'ws_1', scopes: ['pii:read'], key_prefix: 'ic-dev-abc' }) });
  assert.equal(ok.contact_values, 'readable');
});

test('workspace: one answer with credits, spend and how it shares', async () => {
  const c = fake({
    workspace: { workspace_id: 'ws_1', signed_in_as: 'account', scopes: [], credits: { balance: 90, held: 5, available: 85 }, contributes: false, allowed_purposes: ['b2b_outbound'], region: 'us', ids_held: 1 },
    credits: { workspace_id: 'ws_1', credits: { balance: 90, held: 5, available: 85 }, spent: { today: 4, last_30_days: 10, by_tool: [{ tool: 'enrich', credits: 8, calls: 4 }, { tool: 'resolve', credits: 2, calls: 2 }] }, recent: [] },
  });
  const w = await ops.workspace(c, {});
  assert.equal(c.calls.find((x) => x.verb === 'credits').body, 10, 'asks for the last 10 by default');
  assert.match(w.summary, /85 credits available \(5 held by running calls\)\. Spent 4 today, counted since \d\d:\d\d (today|yesterday) on this machine's clock \(the day is the UTC day \d{4}-\d\d-\d\d, whatever the local date\), 10 in 30 days \(enrich 8, resolve 2\)\. 1 ID held\. Private/);
  assert.equal(w.contact_values, 'emails in full; phones and LinkedIn partly hidden');
  assert.deepEqual(w.delivered, []);
  await assert.rejects(() => ops.workspace(c, { recent: 500 }), /recent/);
});

test('report: aliases are read, repeats sent once, a bad row is marked and the rest still go, phones are refused', async () => {
  const c = fake({ feedback: (b) => { if (b.id === 'ic-nothld0') throw new AgenticIdError(404, 'feedback.not_held', 'not held'); return { recorded: true, summary: 'ok' }; } });
  const one = await ops.report(c, { id: ' ic-abc1234 ', outcome: 'Bounce' });
  assert.deepEqual(c.calls[0].body, { id: 'ic-abc1234', field: 'work_email', outcome: 'bounced' });
  assert.match(one.summary, /1 of 1 outcome recorded \(1 bounced\)\. Nothing charged/);
  await assert.rejects(() => ops.report(c, { id: 'ic-abc1234', outcome: 'exploded' }), /outcome must be one of/);
  await assert.rejects(() => ops.report(c, { id: 'ic-abc1234', outcome: 'bounced', field: 'mobile_phone' }), (e) => e.code === 'personal_data');
  await assert.rejects(() => ops.report(c, {}), /Nothing to report/);
  const many = await ops.report(c, { reports: [{ id: 'ic-abc1234', outcome: 'replied' }, { id: 'ic-abc1234', outcome: 'confirmed' }, { id: 'ic-nothld0', outcome: 'bounced' }, { id: 'nope', outcome: 'bounced' }, { id: 'ic-zzz9999', outcome: 'meh' }] });
  assert.equal(many.recorded, 1);
  assert.deepEqual(many.results.map((r) => [r.id, r.recorded, r.error]), [['nope', false, 'not_an_agentic_id'], ['ic-zzz9999', false, 'request.invalid'], ['ic-abc1234', true, undefined], ['ic-nothld0', false, 'feedback.not_held']]);
  assert.match(many.summary, /1 of 5 outcomes recorded \(1 confirmed\)/);
  assert.match(many.input_notes[0], /repeated report/);
  const down = fake({ feedback: () => { throw new AgenticIdError(503, 'service.unavailable', 'down'); } });
  await assert.rejects(() => ops.report(down, { reports: [{ id: 'ic-abc1234', outcome: 'replied' }, { id: 'ic-abc1235', outcome: 'replied' }] }), (e) => e.status === 503);
});

test('status carries the credits, so "am I connected and what can I spend" is one call', async () => {
  const c = fake({ me: { workspace_id: 'ws_1', scopes: [], key_prefix: 'ic-dev-x' }, workspace: { credits: { balance: 40, held: 2, available: 38 } } });
  const s = await ops.status(c);
  assert.equal(s.credits_available, 38);
  assert.match(s.summary, /38 credits available/);
  const noBalance = await ops.status({ baseUrl: 'http://x', apiKey: 'k', me: async () => ({ workspace_id: 'ws_1', scopes: [], key_prefix: 'p' }), workspace: async () => { throw new AgenticIdError(503, 'service.unavailable', 'down'); } });
  assert.equal(noBalance.ok, true, 'a missing balance does not make the connection look broken');
});

test('the server address is remembered for the command-line tool, and only the address', async () => {
  const { mkdtempSync, readFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { rememberUrl, urlFromEnv, DEFAULT_URL } = await import('../cli/lib/client.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'aid-url-'));
  assert.equal(urlFromEnv({ AGENTIC_ID_CONFIG_DIR: dir }), DEFAULT_URL);
  assert.equal(rememberUrl({ AGENTIC_ID_CONFIG_DIR: dir, AGENTIC_ID_URL: 'https://api.example.test/', AGENTIC_ID_API_KEY: 'ic-dev-secret' }), true);
  assert.equal(urlFromEnv({ AGENTIC_ID_CONFIG_DIR: dir }), 'https://api.example.test');
  assert.doesNotMatch(readFileSync(join(dir, 'server.json'), 'utf8'), /secret/);
  assert.equal(urlFromEnv({ AGENTIC_ID_CONFIG_DIR: dir, AGENTIC_ID_URL: 'http://other.test' }), 'http://other.test', 'the environment wins');
  assert.equal(rememberUrl({ AGENTIC_ID_CONFIG_DIR: dir, AGENTIC_ID_URL: '${user_config.api_url}' }), false, 'an unfilled option is not remembered');
});

test('resolve_many never goes past its cap, even with lookups running side by side', async () => {
  let charged = 0;
  const slow = fake({ resolve: async () => { await new Promise((r) => setTimeout(r, 15)); charged += 1; return { cost: { quoted_credits: 1, charged_credits: 1 }, id: `ic-row${charged}00`, outcome: 'new' }; } });
  const r = await ops.resolveMany(slow, { records: Array.from({ length: 12 }, (_, i) => ({ email: `p${i}@acme.io` })), max_credits: 3 });
  assert.equal(charged, 3, 'exactly the cap, not cap + workers');
  assert.equal(r.cost.charged_credits, 3);
  assert.ok(r.cost.quoted_credits <= 3, 'the quote is never above the cap');
  assert.equal(r.stopped.error, 'cap_reached');
  assert.equal(r.rows.filter((x) => x.outcome === 'not_run').length, 9);
});

test('resolve_many: a row that cannot identify anyone is skipped, not sent and not a crash', async () => {
  const c = fake({ resolve: () => ({ cost: { quoted_credits: 1, charged_credits: 1 }, id: 'ic-abc1234', outcome: 'known' }) });
  const r = await ops.resolveMany(c, { records: [{ email: 'jane@acme.io' }, { name: 'Sam Home', email: 'sam@gmail.com' }, { name: 'Only A Name' }], max_credits: 5 });
  assert.equal(c.calls.length, 1);
  assert.deepEqual(r.rows.map((x) => x.outcome), ['known', 'skipped', 'skipped']);
  assert.match(r.rows[1].reason, /not enough to identify: name alone \(held back: email\)/);
});

test('free-mail providers under any country ending are held back', () => {
  for (const e of ['a@yahoo.de', 'a@hotmail.fr', 'a@outlook.de', 'a@live.co.uk', 'a@gmx.at', 'a@yahoo.com.br', 'a@icloud.com']) assert.equal(cleanEmail(e).ok, false, e);
  for (const e of ['a@acme.io', 'a@mailchimp.com', 'a@outlook-consulting.de', 'a@livepeer.org']) assert.equal(cleanEmail(e).ok, true, e);
});

test('csv: nothing is lost on the way through', () => {
  const src = '﻿email,note,email,phone\r\n  spaced@acme.io  ,"a, b",second@acme.io,+1 555 0100\r\n\r\nx@acme.io,=SUM(A1),,-42\r\nextra@acme.io,n,,,overflow\r\n';
  const sheet = parseCsv(src);
  assert.equal(sheet.rows.length, 4, 'the blank row is a row');
  assert.equal(sheet.header.length, 5, 'a cell beyond the header gets a column');
  const out = toCsv(sheet.header, sheet.rows, sheet.delimiter, sheet);
  assert.ok(out.startsWith('﻿email,note,email,phone,\r\n'), 'BOM, both email columns and CRLF are kept');
  assert.match(out, /"  spaced@acme\.io  ","a, b",second@acme\.io,\+1 555 0100,/, 'cell text is untouched and a phone number is not turned into text');
  assert.match(out, /x@acme\.io,'=SUM\(A1\),,-42,/, 'a formula is neutralised, a negative number is not');
  assert.match(out, /extra@acme\.io,n,,,overflow\r\n$/);
  assert.equal(parseCsv(out).rows.length, 4, 'and it reads back the same');
});

test('cli files: the input is never overwritten, unread email columns stop a paid run, a cap stop exits 3', async () => {
  const { symlinkSync } = await import('node:fs');
  const dir = mkdtempSync(join(tmpdir(), 'aid-cli-'));
  const file = join(dir, 'in.csv');
  const original = 'Kontakt;Firma;Web\nada@alpha-synthetic.com;Alpha;alpha-synthetic.com\nbo@beta-synthetic.com;Beta;beta-synthetic.com\ncy@gamma-synthetic.com;Gamma;gamma-synthetic.com\n';
  writeFileSync(file, original);
  const client = fake({ resolve: () => ({ cost: { quoted_credits: 1, charged_credits: 1 }, id: `ic-id${Math.random().toString(36).slice(2, 8)}0`, outcome: 'new' }) });
  // The same file under another spelling or through a link is still the same file.
  const link = join(dir, 'link.csv');
  symlinkSync(file, link);
  for (const out of [file, link, join(dir, '.', 'in.csv')]) {
    const r = await cli(['resolve', '--file', file, '--out', out, '--max-credits', '5', '--email-column', 'Kontakt'], client);
    assert.equal(r.code, 1, out);
    assert.match(r.err, /must not be the input file/);
  }
  assert.equal(client.calls.length, 0);
  assert.equal(readFileSync(file, 'utf8'), original);
  const dry = await cli(['resolve', '--file', file, '--dry-run'], client);
  assert.match(dry.err, /Columns used: company from "Firma", company domain from "Web"\. Warning: "Kontakt" \(column 1\) holds email addresses/);
  const paid = await cli(['resolve', '--file', file, '--max-credits', '5', '--out', join(dir, 'x.csv')], client);
  assert.equal(paid.code, 1, 'a paid run does not go ahead matching people on their company alone');
  assert.match(paid.err, /Name it with --email-column "Kontakt"/);
  assert.equal(client.calls.length, 0);
  assert.match((await cli(['resolve', '--file', file, '--column', 'nope', '--dry-run'], client)).err, /No column "nope"/);
  assert.equal((await cli(['resolve', '--file', file, '--limit-rows', '0', '--dry-run'], client)).code, 1);
  const noOut = await cli(['resolve', '--file', file, '--max-credits', '2', '--json', '--email-column', 'Kontakt'], client);
  assert.equal(noOut.code, 1, 'with --json the rows need a file to go to');
  assert.equal(client.calls.length, 0);
  assert.equal(JSON.parse((await cli(['resolve', '--file', file, '--dry-run', '--json', '--email-column', 'Kontakt'], client)).out).to_send, 3);
  const out = join(dir, 'out.csv');
  const capped = await cli(['resolve', '--file', file, '--max-credits', '2', '--out', out, '--json', '--email-column', 'Kontakt'], client);
  assert.equal(capped.code, 3, 'stopped by the cap');
  const summary = JSON.parse(capped.out);
  assert.equal(summary.cost.charged_credits, 2);
  assert.equal(summary.cap_reached, true);
  const rows = parseCsv(readFileSync(out, 'utf8')).rows;
  assert.equal(rows.filter((x) => x.resolve_outcome === 'not_run').length, 1, 'the file holds what was done');
  assert.match(rows.find((x) => x.resolve_outcome === 'not_run').resolve_note, /cap/);
  assert.equal(readFileSync(file, 'utf8'), original);
});

test('cli files: two email columns are both read, and skipped rows say why', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'aid-cli2-'));
  const file = join(dir, 'two.csv');
  writeFileSync(file, 'email,name,email\nada@alpha-synthetic.com,Ada,\n,Bo,bo@beta-synthetic.com\n,Cy Home,cy@gmail.com\n,Only Name,\n');
  const client = fake({
    validate: (b) => ({ request_id: 'r', summary: 'checked.', cost: { quoted_credits: 2, charged_credits: 2 }, results: b.emails.map((email) => ({ email, verdict: 'valid' })) }),
    resolve: (b) => ({ cost: { quoted_credits: 1, charged_credits: 1 }, id: `ic-${b.identifiers.email.slice(0, 3)}00000`, outcome: 'new' }),
  });
  const v = join(dir, 'v.csv');
  const rv = await cli(['validate', '--file', file, '--max-credits', '5', '--out', v], client);
  assert.deepEqual(client.calls[0].body.emails, ['ada@alpha-synthetic.com', 'bo@beta-synthetic.com'], 'the second email column is read; the personal one is not sent');
  assert.match(rv.err, /1 address was not sent \(1 personal, 0 malformed or disposable\)/);
  assert.deepEqual(parseCsv(readFileSync(v, 'utf8')).rows.map((x) => x.email_verdict), ['valid', 'valid', 'rejected', '']);
  const o = join(dir, 'o.csv');
  await cli(['resolve', '--file', file, '--max-credits', '5', '--out', o], client);
  const rows = parseCsv(readFileSync(o, 'utf8')).rows;
  assert.deepEqual(rows.map((x) => x.resolve_outcome), ['new', 'new', 'skipped', 'skipped']);
  assert.match(rows[2].resolve_note, /not enough to identify/);
  // (the summary names the rows without an ID, so nobody has to guess which)
  assert.ok(rows[3].resolve_note.length > 0, 'a skipped row always says why');
  assert.doesNotMatch(rows[2].resolve_note, /gmail|cy@/, 'the note never repeats the held-back value');
});

test('cli files: a refused key stops the run with exit 2 and writes nothing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'aid-401-'));
  const file = join(dir, 'in.csv');
  writeFileSync(file, 'email\na@alpha-synthetic.com\nb@beta-synthetic.com\n');
  const out = join(dir, 'out.csv');
  const denied = fake({ resolve: () => { throw new AgenticIdError(401, 'auth.invalid_key', 'refused'); } });
  const r = await cli(['resolve', '--file', file, '--max-credits', '5', '--out', out], denied);
  assert.equal(r.code, 2);
  const { existsSync } = await import('node:fs');
  assert.equal(existsSync(out), false);
});

// ------------------------------------------------------------------ the HTTP client
async function withApi(handler, run) {
  const seen = [];
  const srv = createHttp((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d)).on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body: body ? JSON.parse(body) : undefined });
      handler(req, res, seen.length);
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    return await run(`http://127.0.0.1:${srv.address().port}`, seen);
  } finally {
    srv.closeAllConnections?.();
    srv.close();
  }
}
const json = (res, status, body, headers = {}) => res.writeHead(status, { 'content-type': status >= 400 ? 'application/problem+json' : 'application/json', ...headers }).end(JSON.stringify(body));

test('client: a paid call carries one idempotency key across its retries; a GET carries none', async () => {
  await withApi(
    (req, res, n) => {
      if (req.url === '/v1/me') return json(res, 200, { workspace_id: 'ws_1', scopes: [], key_prefix: 'ic-dev-x' });
      if (n === 1) return json(res, 503, { code: 'service.unavailable', detail: 'recovering', sent: false, retryAfterSeconds: 0.2 }, { 'retry-after': '0' });
      if (n === 2) return json(res, 409, { code: 'idempotency.in_progress', detail: 'still running', retryAfterSeconds: 0.2 }, { 'retry-after': '0' });
      return json(res, 200, { request_id: 'r', id: 'ic-abc123', outcome: 'known', cost: { quoted_credits: 1, charged_credits: 1 } });
    },
    async (baseUrl, seen) => {
      const c = new AgenticId({ apiKey: 'k', baseUrl });
      const r = await c.resolve({ identifiers: { company_domain: 'acme.io' } });
      assert.equal(r.id, 'ic-abc123');
      const keys = seen.map((x) => x.headers['idempotency-key']);
      assert.equal(keys.length, 3);
      assert.match(keys[0], /^[0-9a-f-]{36}$/);
      assert.ok(keys.every((k) => k === keys[0]), 'every retry of one call uses the same key');
      await c.resolve({ identifiers: { company_domain: 'acme.io' } });
      assert.notEqual(seen[3].headers['idempotency-key'], keys[0], 'a new call gets a new key');
      await c.me();
      assert.equal(seen[4].headers['idempotency-key'], undefined);
    },
  );
});

test('client: a fault that may have charged is not retried, and the error carries the request ID', async () => {
  await withApi(
    (req, res) => json(res, 503, { code: 'service.unavailable', detail: 'down', request_id: 'req_abc' }),
    async (baseUrl, seen) => {
      const e = await refused(() => new AgenticId({ apiKey: 'k', baseUrl }).enrich({ contact: { email: 'a@acme.io' }, max_credits: 2 }));
      assert.equal(seen.length, 1, 'a 503 without sent: false is reported, not replayed');
      assert.equal(e.toJSON().request_id, 'req_abc');
    },
  );
  await withApi(
    (req, res, n) => (n === 1 ? json(res, 504, { code: 'service.timeout', detail: 'slow', ambiguous: true }, { 'retry-after': '0' }) : json(res, 200, { request_id: 'r', results: [] })),
    async (baseUrl, seen) => {
      await new AgenticId({ apiKey: 'k', baseUrl }).enrich({ contact: { email: 'a@acme.io' }, max_credits: 2 });
      assert.equal(seen.length, 2, 'a timeout inside the API is asked again once, with the same key');
      assert.equal(seen[0].headers['idempotency-key'], seen[1].headers['idempotency-key']);
    },
  );
});

test('client: Bearer key, problem details become a refusal with a fix', async () => {
  await withApi(
    (req, res) => (req.url === '/v1/me' ? json(res, 200, { workspace_id: 'ws_1', scopes: [], key_prefix: 'ic-dev-x' }) : json(res, 402, { code: 'credits.insufficient', detail: 'Not enough credits.', available: 3 })),
    async (baseUrl, seen) => {
      const c = new AgenticId({ apiKey: 'secret-key', baseUrl: `${baseUrl}/` });
      assert.equal((await c.me()).workspace_id, 'ws_1');
      assert.equal(seen[0].headers.authorization, 'Bearer secret-key');
      assert.match(seen[0].headers['x-agentic-id-client'], /^agentic-id-plugin\//);
      const e = await refused(() => c.enrich({ contact: { email: 'a@acme.io' }, max_credits: 2 }));
      assert.deepEqual([e.status, e.code, e.toJSON().available_credits], [402, 'credits.insufficient', 3]);
      assert.match(e.fix, /do not retry/);
      assert.doesNotMatch(JSON.stringify(e.toJSON()), /secret-key|a@acme\.io/, 'an error never carries the key or the input');
    },
  );
});

test('client: a 429 is retried once after the wait; other failures are not replayed', async () => {
  await withApi(
    (req, res, n) => (n === 1 ? json(res, 429, { code: 'rate_limited', detail: 'slow down', retryAfterSeconds: 0 }, { 'retry-after': '0' }) : json(res, 200, { ok: true })),
    async (baseUrl, seen) => {
      assert.deepEqual(await new AgenticId({ apiKey: 'k', baseUrl }).resolve({ identifiers: {} }), { ok: true });
      assert.equal(seen.length, 2);
    },
  );
  await withApi(
    (_req, res) => json(res, 503, { code: 'service.unavailable', detail: 'down' }),
    async (baseUrl, seen) => {
      const e = await refused(() => new AgenticId({ apiKey: 'k', baseUrl }).find({}));
      assert.equal(e.status, 503);
      assert.equal(seen.length, 1, 'a paid POST is never sent twice on a server error');
    },
  );
});

test('client: no key, an unreachable server and a slow one are told apart', async () => {
  // No credential and nothing at the address: the address is the problem, not the sign-in (Vicky #3).
  const typo = await refused(() => new AgenticId({ apiKey: '', baseUrl: 'http://127.0.0.1:9' }).me());
  assert.equal(typo.code, 'unreachable');
  assert.match(typo.detail, /Cannot reach the Agentic ID server at http:\/\/127\.0\.0\.1:9/);
  assert.doesNotMatch(`${typo.detail} ${typo.fix}`, /Not signed in/);
  // No credential and a real server: then it is the sign-in.
  await withApi(
    (_req, res) => { res.writeHead(401, { 'content-type': 'application/problem+json' }); res.end(JSON.stringify({ code: 'auth.missing_key', detail: 'No credential.' })); },
    async (baseUrl, seen) => {
      assert.equal((await refused(() => new AgenticId({ apiKey: '', baseUrl, env: { AGENTIC_ID_CONFIG_DIR: mkdtempSync(join(tmpdir(), 'aid-nosess-')) } }).me())).code, 'auth.missing_key');
      assert.equal(seen[0].headers.authorization, undefined, 'the check sends no credential');
    },
  );
  assert.equal((await refused(() => new AgenticId({ apiKey: 'k', baseUrl: 'http://127.0.0.1:9' }).resolve({}))).code, 'unreachable');
  await withApi(
    () => {},
    async (baseUrl) => assert.equal((await refused(() => new AgenticId({ apiKey: 'k', baseUrl, timeoutMs: 80 }).discover({}))).code, 'timeout'),
  );
});

test('client: an unset plugin option is not mistaken for a key or a URL', () => {
  assert.equal(keyFromEnv({ AGENTIC_ID_API_KEY: '${user_config.api_key}' }), undefined);
  assert.equal(keyFromEnv({ AGENTIC_ID_API_KEY: '  ' }), undefined);
  const empty = mkdtempSync(join(tmpdir(), 'aid-nourl-'));
  assert.equal(urlFromEnv({ AGENTIC_ID_URL: '${user_config.api_url}', AGENTIC_ID_CONFIG_DIR: empty }), 'https://agenticid.icustomer.ai', 'with nothing set, the hosted service');
  assert.equal(urlFromEnv({ AGENTIC_ID_URL: 'http://127.0.0.1:3100' }), 'http://127.0.0.1:3100', 'a local stack is still one setting away');
  assert.equal(urlFromEnv({ AGENTIC_ID_URL: 'https://api.example.test/' }), 'https://api.example.test');
  const dir = mkdtempSync(join(tmpdir(), 'aid-key-'));
  writeFileSync(join(dir, 'key'), 'Agentic ID key: from-a-file\n');
  assert.equal(keyFromEnv({ AGENTIC_ID_API_KEY_FILE: join(dir, 'key') }), 'from-a-file');
});

// ------------------------------------------------------------------ CLI
async function cli(argv, client = fake()) {
  const out = [];
  const err = [];
  const code = await main(argv, { out: (s) => out.push(s), err: (s) => err.push(s) }, client);
  return { code, out: out.join('\n'), err: err.join('\n'), client };
}

test('cli: help, version, unknown commands and bad flags', async () => {
  assert.equal((await cli([])).code, 1);
  assert.match((await cli(['--help'])).out, /agentic-id <command>/);
  assert.match((await cli(['--version'])).out, /^agentic-id-plugin\/\d/);
  assert.equal((await cli(['frobnicate'])).code, 1);
  assert.equal((await cli(['find', 'acme.io', '--nope'])).code, 1);
  assert.match((await cli(['find', 'acme.io', '--role', 'CTO', '--limit', 'ten'])).err, /--limit needs a whole number/);
});

test('cli: flags become the same arguments the tools take', async () => {
  const d = await cli(['discover', '--country', 'UK,de', '--industry', 'software', '--min', '100', '--max', '2000', '--title', 'CTO', '--per-account', '2', '--max-accounts', '10', '--max-credits', '50']);
  assert.deepEqual(d.client.calls[0].body, { account_filters: { industry: ['software'], country: ['GB', 'DE'], employees_min: 100, employees_max: 2000 }, contact_filters: { job_title: ['CTO'], per_account: 2 }, max_accounts: 10, max_credits: 50 });
  const e = await cli(['enrich', '--domain', 'acme.io']);
  assert.deepEqual(e.client.calls[0].body, { company: { domain: 'acme.io' }, max_credits: 1 });
  const p = await cli(['enrich', '--email', 'jane@acme.io', '--fields', 'title,work_email']);
  assert.deepEqual(p.client.calls[0].body, { contact: { email: 'jane@acme.io' }, fields: ['title', 'work_email'], max_credits: 2 });
});

test('unconfirmed people: shown flagged by default, left out with --confirmed-only or include_unconfirmed false', async () => {
  const c = fake();
  await ops.find(c, { account: { domain: 'acme.io' }, roles: ['CTO'], include_unconfirmed: false });
  assert.equal(c.calls[0].body.include_unconfirmed, false);
  await ops.find(c, { account: { domain: 'acme.io' }, roles: ['CTO'] });
  assert.equal('include_unconfirmed' in c.calls[1].body, false, 'left to the API default when not given');
  await ops.discover(c, { account_filters: { country: ['GB'] }, contact_filters: { job_title: ['CTO'], include_unconfirmed: false }, max_credits: 10 });
  assert.equal(c.calls[2].body.contact_filters.include_unconfirmed, false);
  const f = await cli(['find', 'acme.io', '--role', 'CTO', '--confirmed-only']);
  assert.equal(f.client.calls[0].body.include_unconfirmed, false);
  const d = await cli(['discover', '--country', 'GB', '--title', 'CTO', '--confirmed-only', '--max-credits', '10']);
  assert.equal(d.client.calls[0].body.contact_filters.include_unconfirmed, false);
  const people = [
    { id: 'ic-a', account_id: 'ic-c', name: 'Ann Lee', title: 'CTO', email: 'ann@acme.io', level: 'corroborated', employment: { status: 'confirmed', level: 'corroborated' } },
    { id: 'ic-b', account_id: 'ic-c', name: 'Bo Ray', title: 'CTO', email: 'bo@acme.io', level: 'claimed', employment: { status: 'unconfirmed', level: 'claimed', flag: 'unconfirmed: claimed by Apollo, not found on the company website' } },
  ];
  const shown = await cli(['find', 'acme.io', '--role', 'CTO'], fake({ find: { summary: '2 people found at acme.io. 4 credits charged.', people, excluded: {}, rejected: [] } }));
  assert.match(shown.out, /Bo Ray[^\n]*\n\s+! unconfirmed: claimed by Apollo/);
  assert.doesNotMatch(shown.out, /Ann Lee[^\n]*\n\s+!/);
});

test('status says emails come back in full, other contact values partly hidden', async () => {
  const s = await ops.status(fake({ me: { workspace_id: 'ws_1', scopes: [], key_prefix: 'p' }, workspace: { credits: { available: 1 } } }));
  assert.match(s.contact_values, /emails in full/);
});

test('cli: exit codes say what went wrong', async () => {
  assert.equal((await cli(['resolve', '--email', 'x@gmail.com'])).code, 1, 'bad input, nothing sent');
  assert.equal((await cli(['discover', '--country', 'GB'])).code, 3, 'needs a cap');
  const fail = (status, code) => fake({ resolve: () => { throw new AgenticIdError(status, code, 'x'); } });
  assert.equal((await cli(['resolve', '--domain', 'acme.io'], fail(401, 'auth.invalid_key'))).code, 2);
  assert.equal((await cli(['resolve', '--domain', 'acme.io'], fail(402, 'credits.insufficient'))).code, 3);
  assert.equal((await cli(['resolve', '--domain', 'acme.io'], fail(400, 'request.invalid'))).code, 4);
  assert.equal((await cli(['resolve', '--domain', 'acme.io'], fail(503, 'service.unavailable'))).code, 5);
  assert.equal((await cli(['resolve', '--domain', 'acme.io'], fail(0, 'unreachable'))).code, 5);
});

test('cli: --dry-run shows the request and sends nothing; estimate is free', async () => {
  const r = await cli(['find', 'acme.io', '--role', 'CTO', '--limit', '3', '--dry-run']);
  assert.equal(r.client.calls.length, 0);
  assert.match(r.out, /"max_credits": 6/);
  assert.match((await cli(['estimate', 'discover', '--max-accounts', '50', '--title', 'CTO', '--per-account', '2'])).out, /At most 250 credits/);
  assert.match((await cli(['estimate', 'discover', '--count'])).out, /^Free/);
});

test('cli: a CSV is validated in one call and written back with verdict columns', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'aid-csv-'));
  const file = join(dir, 'leads.csv');
  writeFileSync(file, 'Email Address,Company\n"Jane <jane@acme.io>",Acme\njane@acme.io,Acme\nme@gmail.com,Home\n,NoEmail\nbroken@,Bad\n');
  const client = fake({ validate: (b) => ({ request_id: 'r', summary: '1 email checked: 1 valid. 1 credit charged.', cost: { quoted_credits: 1, charged_credits: 1 }, results: b.emails.map((email) => ({ email, verdict: 'valid', role: false })) }) });
  assert.equal((await cli(['validate', '--file', file], client)).code, 3, 'a file run without --max-credits is refused, as a budget matter');
  assert.equal(client.calls.length, 0);
  assert.match((await cli(['validate', '--file', file, '--dry-run'], client)).err, /5 rows, 4 with an email, 1 distinct work addresses to check \(not sent: 1 repeat, 1 personal, 1 malformed or disposable\)\. At most 1 credits .*Columns used: email from "Email Address", company from "Company"/);
  const out = join(dir, 'out.csv');
  const r = await cli(['validate', '--file', file, '--max-credits', '5', '--out', out], client);
  assert.equal(r.code, 0);
  assert.deepEqual(client.calls[0].body, { emails: ['jane@acme.io'], max_credits: 5 });
  assert.deepEqual(parseCsv(readFileSync(out, 'utf8')).rows.map((x) => [x.email_verdict, x.email_reason]), [['valid', ''], ['valid', ''], ['rejected', 'personal_email_not_b2b'], ['', ''], ['rejected', 'email_malformed']]);
});

test('cli: a CSV is resolved with duplicates marked, and enriched with level columns', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'aid-csv-'));
  const file = join(dir, 'crm.csv');
  writeFileSync(file, 'email;linkedin;company\njane@acme.io;;Acme\n;linkedin.com/in/jane-doe;Acme\nbob@acme.io;;Acme\n');
  const ids = { 'jane@acme.io': 'ic-jane00', 'https://www.linkedin.com/in/jane-doe': 'ic-jane00', 'bob@acme.io': 'ic-bob000' };
  const client = fake({
    resolve: (b) => ({ cost: { quoted_credits: 1, charged_credits: 1 }, id: ids[b.identifiers.email ?? b.identifiers.linkedin_url], outcome: 'known' }),
    enrich: (b) => ({ request_id: 'r', summary: '3 enriched. 6 credits charged.', cost: { quoted_credits: 6, charged_credits: 6 }, results: b.contacts.map((c2, i) => ({ id: `ic-p${i}0000`, status: 'enriched', reason: '', fields: [{ field: 'title', value: `Title ${i}`, level: i ? 'claimed' : 'verified', source: 's' }] })) }),
  });
  const r = await cli(['resolve', '--file', file, '--max-credits', '10'], client);
  const rows = parseCsv(r.out).rows;
  assert.deepEqual(rows.map((x) => [x.agentic_id, x.same_id_as_row]), [['ic-jane00', ''], ['ic-jane00', '1'], ['ic-bob000', '']]);
  assert.match(r.err, /2 distinct IDs, 1 duplicate rows/);
  const e = await cli(['enrich', '--file', file, '--fields', 'title', '--max-credits', '10'], client);
  assert.deepEqual(parseCsv(e.out).rows.map((x) => [x.aid_title, x.aid_title_level]), [['Title 0', 'verified'], ['Title 1', 'claimed'], ['Title 2', 'claimed']]);
  assert.equal((await cli(['find', '--file', file, '--max-credits', '1'], client)).code, 1);
  assert.match((await cli(['validate', '--file', join(dir, 'missing.csv'), '--max-credits', '1'], client)).err, /No such file/);
});

// ------------------------------------------------------------------ session budget hook
test('enrich: field names are checked and old names are mapped', async () => {
  const c = fake();
  await ops.enrich(c, { contact: { email: 'a@acme.io' }, fields: ['Job Title', 'email', 'company'] });
  assert.deepEqual(c.calls[0].body.fields, ['title', 'work_email', 'company_name']);
  const e = await refused(() => ops.enrich(c, { contact: { email: 'a@acme.io' }, fields: ['salary'] }));
  assert.match(e.detail, /Unknown field: salary/);
  assert.match(e.fix, /work_email/);
  assert.equal((await refused(() => ops.enrich(c, { company: { domain: 'acme.io' }, fields: ['title'] }))).code, 'request.invalid', 'a person field on a company is caught');
  await ops.enrich(c, { company: { domain: 'acme.io' }, fields: ['employee_size', 'industry'] });
  assert.deepEqual(c.calls.at(-1).body.fields, ['employees', 'industry']);
});

// ------------------------------------------------------------------ Vicky's test report (0.5.2)
// One test per item that is code. Synthetic data only.
const { shieldReply, shieldProblem, isSourceFailure, leaksSource } = await import('../cli/lib/shield.mjs');
const { companyNameProblem } = await import('../cli/lib/guards.mjs');
const { decodeText, sniffDelimiter, FORMULA_START } = await import('../cli/lib/csv.mjs');

test('shield (#4 #7 #8): vendor names, plans, provider counts and a source\'s bill never reach the user', () => {
  const r = shieldReply({
    request_id: 'req_1',
    summary: 'About 1,637 match at Treg. 4 sources failed.',
    cost: { quoted_credits: 0, charged_credits: 0 },
    total_at_provider: 1637,
    provider: 'treg',
    plan: [{ provider: 'treg', why: 'applies countries; we check size' }],
    accounts: [{ id: 'ic-x', name: 'Acme Synthetic', domain: 'acme-synthetic.com', source: 'treg', fields: [{ field: 'title', value: 'CTO', lineage: 'provider-a' }] }],
  });
  const text = JSON.stringify(r);
  assert.equal(leaksSource(text), false, text);
  assert.doesNotMatch(text, /treg|provider-a|total_at_provider|sources failed/i);
  assert.equal(r.total_matching, 1637);
  assert.deepEqual(r.plan, [{ why: 'applies countries; we check size' }]);
  assert.equal(r.accounts[0].name, 'Acme Synthetic', 'values about a company are left as they came');
  assert.equal(r.accounts[0].source, 'data_source');
  assert.equal(r.source_unavailable, true);
  // A source's billing message is replaced, and says nothing was charged.
  const bill = shieldReply({ summary: 'Payment required: your Treg balance is $0.', cost: { charged_credits: 0 }, results: [] });
  assert.match(bill.summary, /data source .* unavailable.*Nothing was charged/i);
  assert.doesNotMatch(JSON.stringify(bill), /treg|\$0|payment required/i);
  // An ordinary answer passes through untouched.
  const plain = { summary: '2 accounts delivered. 2 credits charged.', cost: { charged_credits: 2 }, accounts: [{ id: 'ic-a', name: 'Treg Holdings Synthetic' }] };
  assert.deepEqual(shieldReply(plain), plain, 'a company that happens to share a vendor name, in a value, is not touched');
});

test('shield (#4 #5 #6): a source\'s 402 is "a data source was unavailable"; our own wallet stays a wallet error', async () => {
  assert.equal(isSourceFailure('provider.error', 'x', 502), true);
  assert.equal(isSourceFailure(undefined, 'Upstream returned 402 Payment Required', 502), true);
  assert.equal(isSourceFailure('credits.insufficient', 'Not enough credits.', 402), false);
  assert.equal(isSourceFailure('request.invalid', 'domain is required', 400), false);
  assert.match(shieldProblem({ detail: 'treg: insufficient balance' }).detail, /data source/);
  assert.equal(shieldProblem({ detail: 'Not enough credits: balance is $0.' }, { ownWallet: true }).detail, 'Not enough credits: balance is $0.');
  await withApi(
    (req, res) => (req.url === '/v1/validate' ? json(res, 402, { code: 'upstream.payment_required', detail: 'Treg: payment required, account balance $0', request_id: 'req_v' }) : json(res, 402, { code: 'credits.insufficient', detail: 'Not enough credits.', available: 0 })),
    async (baseUrl) => {
      const c = new AgenticId({ apiKey: 'k', baseUrl });
      const e = await refused(() => c.validate({ emails: ['ada@acme-synthetic.com'], max_credits: 1 }));
      assert.deepEqual([e.status, e.code], [503, 'source.unavailable']);
      assert.equal(e.toJSON().request_id, 'req_v');
      assert.doesNotMatch(JSON.stringify(e.toJSON()) + e.fix, /treg|payment required|\$0|402/i);
      assert.match(e.detail, /Nothing was charged/);
      const own = await refused(() => c.enrich({ contact: { email: 'ada@acme-synthetic.com' }, max_credits: 2 }));
      assert.equal(own.code, 'credits.insufficient', 'the user\'s own wallet is still reported as such');
    },
  );
});

test('server address (#3): a typo, a non-Agentic server and a bad URL are not "not signed in"', async () => {
  const env = { AGENTIC_ID_CONFIG_DIR: mkdtempSync(join(tmpdir(), 'aid-probe-')) };
  const typo = await ops.status(new AgenticId({ apiKey: '', baseUrl: 'http://127.0.0.1:9', env }));
  assert.deepEqual([typo.ok, typo.reachable, typo.error], [false, false, 'unreachable']);
  assert.doesNotMatch(`${typo.summary} ${typo.fix}`, /Not signed in|agentic_id_login/);
  assert.match(typo.fix, /server URL/);
  const bad = await ops.status(new AgenticId({ apiKey: '', baseUrl: 'agenticid.icustomer', env }));
  assert.equal(bad.error, 'bad_url');
  await withApi(
    (_req, res) => res.writeHead(200, { 'content-type': 'text/html' }).end('<html>parked domain</html>'),
    async (baseUrl) => {
      const s = await ops.status(new AgenticId({ apiKey: '', baseUrl, env }));
      assert.equal(s.error, 'not_agentic_id');
      assert.equal((await refused(() => new AgenticId({ apiKey: '', baseUrl, env }).resolve({}))).code, 'not_agentic_id');
    },
  );
  await withApi(
    (_req, res) => json(res, 401, { code: 'auth.missing_key', detail: 'No credential.' }),
    async (baseUrl) => {
      const s = await ops.status(new AgenticId({ apiKey: '', baseUrl, env }));
      assert.deepEqual([s.ok, s.reachable], [false, true]);
      assert.match(s.fix, /agentic_id_login/, 'a real server with no sign-in still says to sign in');
    },
  );
});

test('company field (#11): an email, a phone number or a mail provider in "company" is never sent', async () => {
  for (const [v, why] of [['jane.doe@gmail.com', 'personal_email_in_company_field'], ['sales@acme-synthetic.com', 'email_in_company_field'], ['+1 (415) 555-0100', 'phone_numbers_are_not_sent'], ['0049 30 1234567', 'phone_numbers_are_not_sent'], ['gmail.com', 'personal_mail_provider_is_not_a_company'], ['Gmail', 'personal_mail_provider_is_not_a_company'], ['Yahoo Mail', 'personal_mail_provider_is_not_a_company']]) {
    assert.equal(companyNameProblem(v), why, v);
  }
  for (const ok of ['Acme Synthetic GmbH', '3M', 'Studio 54 Synthetic', '"Müller & Söhne"']) assert.equal(companyNameProblem(ok), undefined, ok);
  const r = cleanIdentifiers({ name: '"Ada Lovelace"', company: 'ada@gmail.com' });
  assert.equal(r.identifiers.name, 'Ada Lovelace', 'quotes around a name are removed');
  assert.equal(r.identifiers.company_name, undefined);
  assert.deepEqual(r.dropped, [{ field: 'company_name', reason: 'personal_email_in_company_field' }]);
  const c = fake({ resolve: (b) => ({ cost: { quoted_credits: 1, charged_credits: 1 }, id: 'ic-p', outcome: 'new', b }) });
  await ops.resolveMany(c, { records: [{ name: 'Ada Lovelace', company: '+44 20 7946 0000', domain: 'acme-synthetic.com' }], max_credits: 2 });
  assert.doesNotMatch(JSON.stringify(c.calls), /7946|\+44/, 'the phone number never left this machine');
});

test('validate (#12): a cap smaller than the list checks what it can and says the rest were not checked', async () => {
  const c = fake({ validate: (b) => ({ request_id: 'r', summary: 'ok', cost: { quoted_credits: b.emails.length, charged_credits: b.emails.length }, results: b.emails.map((email) => ({ email, verdict: 'valid', charged: true })) }) });
  const emails = Array.from({ length: 5 }, (_, i) => `p${i}@acme-synthetic.com`);
  const r = await ops.validate(c, { emails, max_credits: 3 });
  assert.deepEqual(c.calls.map((x) => x.body.emails.length), [3], 'never sends more than the cap can pay for');
  assert.equal(r.partial, true);
  assert.equal(r.not_checked, 2);
  assert.equal(r.results.filter((x) => x.verdict === 'not_checked' && x.reason === 'cap_reached' && x.charged === false).length, 2);
  assert.match(r.summary, /Partial: 2 not checked/);
  assert.doesNotMatch(r.summary, /^5 emails checked/);
});

test('validate (#13): a batch failing part way keeps what was done and says why it stopped', async () => {
  const c = fake({ validate: (b, n) => { if (n === 2) throw new AgenticIdError(503, 'source.unavailable', 'A data source Agentic ID relies on was unavailable.'); return { request_id: `r${n}`, cost: { quoted_credits: b.emails.length, charged_credits: b.emails.length }, results: b.emails.map((email) => ({ email, verdict: 'valid' })) }; } });
  const emails = Array.from({ length: 1500 }, (_, i) => `p${i}@acme-synthetic.com`);
  const r = await ops.validate(c, { emails, max_credits: 1500 });
  assert.equal(r.partial, true);
  assert.equal(r.cost.charged_credits, 1000);
  assert.equal(r.stopped.error, 'source.unavailable');
  assert.equal(r.results.filter((x) => x.verdict === 'not_checked' && x.reason === 'stopped_early').length, 500);
});

test('enrich (#12 #13): a cap or an error part way leaves a partial answer, not "done" and not an error', async () => {
  const ok = (b, n) => ({ request_id: `r${n}`, cost: { quoted_credits: b.contacts.length * 2, charged_credits: b.contacts.length * 2 }, results: b.contacts.map(() => ({ status: 'enriched', fields: [{ field: 'title', value: 'CTO', level: 'claimed' }] })) });
  const contacts = Array.from({ length: 5 }, (_, i) => ({ email: `p${i}@acme-synthetic.com` }));
  const capped = await ops.enrich(fake({ enrich: ok }), { contacts, max_credits: 6 });
  assert.equal(capped.partial, true);
  assert.equal(capped.cost.charged_credits, 6);
  assert.deepEqual(capped.results.map((x) => x.status), ['enriched', 'enriched', 'enriched', 'not_run', 'not_run']);
  assert.match(capped.summary, /Partial: 2 not run/);
  const many = Array.from({ length: 150 }, (_, i) => ({ email: `p${i}@acme-synthetic.com` }));
  const broke = fake({ enrich: (b, n) => { if (n === 2) throw new AgenticIdError(402, 'credits.insufficient', 'Not enough credits.', { available: 0 }); return ok(b, n); } });
  const r = await ops.enrich(broke, { contacts: many, max_credits: 400 });
  assert.equal(r.partial, true);
  assert.equal(r.cost.charged_credits, 200);
  assert.equal(r.stopped.error, 'credits.insufficient');
  assert.equal(r.results.filter((x) => x.status === 'not_run').length, 50);
});

test('enrich (#14): companies are enriched as companies, at 1 credit each, and a cap stops part way', async () => {
  const c = fake({ enrich: (b) => ({ request_id: 'r', cost: { quoted_credits: 1, charged_credits: 1 }, results: [{ id: `ic-${b.company.domain}`, status: 'enriched', fields: [{ field: 'industry', value: 'Software' }] }] }) });
  assert.equal(estimate('enrich', { companies: [{ domain: 'a-synthetic.com' }, { domain: 'b-synthetic.com' }] }).max_credits, 2);
  const r = await ops.enrich(c, { companies: ['a-synthetic.com', { domain: 'b-synthetic.com' }, { domain: 'gmail.com' }], max_credits: 5 });
  assert.equal(r.company_results.length, 2);
  assert.equal(r.cost.charged_credits, 2);
  assert.ok(c.calls.every((x) => x.body.company && !x.body.contacts), 'each company goes as a company');
  assert.match(JSON.stringify(r), /1 company had no usable domain or name and was not sent/);
  // A "contact" with only a company on it, from a company list, is a company too.
  const c2 = fake({ enrich: c.enrich === undefined ? undefined : (b) => ({ request_id: 'r', cost: { quoted_credits: 1, charged_credits: 1 }, results: [{ status: 'enriched', fields: [{ field: 'industry', value: 'Software' }] }] }) });
  const r2 = await ops.enrich(c2, { contacts: [{ company: 'Acme Synthetic', domain: 'acme-synthetic.com' }, { company_domain: 'beta-synthetic.com' }, { company_domain: 'gamma-synthetic.com' }], max_credits: 2 });
  assert.equal(c2.calls.length, 2, 'the cap of 2 pays for 2 companies');
  assert.equal(r2.partial, true);
  assert.equal(r2.company_results.filter((x) => x.status === 'not_run').length, 1);
  assert.equal(r2.cost.charged_credits, 2);
});

test('csv (#17): UTF-16 and Windows-1252 exports, a sep= line, quoted separators and German headers', () => {
  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('E-Mail-Adresse\tFirma\r\nada@acme-synthetic.com\tAcme\r\n', 'utf16le')]);
  const a = parseCsv(decodeText(utf16).text);
  assert.equal(a.delimiter ?? a.sep ?? '\t', '\t');
  assert.equal(mapColumns(a.header).email !== undefined, true);
  const cp = Buffer.from([...Buffer.from('Vorname;Nachname;Unternehmen;Gesch'), 0xe4, ...Buffer.from('ftliche E-Mail\nJ'), 0xfc, ...Buffer.from('rgen;M'), 0xfc, ...Buffer.from('ller;Acme;j@acme-synthetic.com\n')]);
  const d = decodeText(cp);
  assert.equal(d.encoding, 'windows-1252');
  const b = parseCsv(d.text);
  const m = mapColumns(b.header);
  assert.ok(m.email && m.first_name && m.last_name && m.company_name, JSON.stringify(m));
  assert.equal(b.rows[0][b.header[0]], 'Jürgen');
  const s = parseCsv('sep=;\nName;Email\n"Doe, Jane";jane@acme-synthetic.com\n');
  assert.equal(s.sep, ';');
  assert.equal(s.rows[0].Name, 'Doe, Jane');
  assert.match(toCsv(s.header, s.rows, ';', { sep: ';' }), /^sep=;\n/);
  assert.equal(sniffDelimiter('"Name, Full";Email;Company', ['"Doe, J";j@a.io;A']), ';');
  assert.equal(sniffDelimiter('a|b|c'), '|');
});

test('csv (#10 #17): formulas are neutralised, also after spaces and in full-width form; numbers are not', () => {
  for (const f of ['=HYPERLINK("x")', ' =1+1', '　@SUM(A1)', '＝cmd', '+cmd|x', '-1+cmd', '\tx']) assert.ok(FORMULA_START.test(f), f);
  const out = toCsv(['v'], [{ v: ' =1+1' }, { v: '＋1' }, { v: '+1 415 555 0100' }, { v: '-42.5' }, { v: 'Acme' }]);
  assert.deepEqual(out.trim().split('\n').slice(1), ["' =1+1", "'＋1", '+1 415 555 0100', '-42.5', 'Acme']);
});

test('file runs (#10 #13): a source failure part way writes the file, marks the rest and leaks nothing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'aid-vicky-'));
  const file = join(dir, 'in.csv');
  writeFileSync(file, `email\n${Array.from({ length: 1200 }, (_, i) => `p${i}@acme-synthetic.com`).join('\n')}\n`);
  const client = fake({ validate: (b, n) => { if (n === 2) throw new AgenticIdError(503, 'source.unavailable', 'A data source Agentic ID relies on was unavailable, so nothing came back for this. Nothing was charged for it.'); return { request_id: `r${n}`, cost: { quoted_credits: b.emails.length, charged_credits: b.emails.length }, results: b.emails.map((email) => ({ email, verdict: 'valid' })) }; } });
  const out = join(dir, 'out.csv');
  const r = await cli(['validate', '--file', file, '--max-credits', '1200', '--out', out, '--json'], client);
  assert.notEqual(r.code, 0, 'a partial run does not exit as done');
  const rows = parseCsv(readFileSync(out, 'utf8')).rows;
  assert.equal(rows.length, 1200, 'the file holds every row');
  assert.equal(rows.filter((x) => x.email_verdict === 'valid').length, 1000);
  assert.equal(rows.filter((x) => x.email_verdict === 'not_checked').length, 200);
  assert.equal(leaksSource(readFileSync(out, 'utf8') + r.out + r.err), false);
  assert.equal(JSON.parse(r.out).partial, true);
});

test('resolve file run (#10): a source that is down writes no vendor text into the file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'aid-vicky2-'));
  const file = join(dir, 'in.csv');
  writeFileSync(file, 'email\nada@acme-synthetic.com\nbo@beta-synthetic.com\n');
  const client = fake({ resolve: () => { throw new AgenticIdError(503, 'source.unavailable', 'A data source Agentic ID relies on was unavailable, so nothing came back for this. Nothing was charged for it.'); } });
  const out = join(dir, 'out.csv');
  const r = await cli(['resolve', '--file', file, '--max-credits', '5', '--out', out], client);
  assert.equal(r.code, 5);
  const text = (await import('node:fs')).existsSync(out) ? readFileSync(out, 'utf8') : '';
  assert.equal(leaksSource(text + r.err + r.out), false);
});

test('discover: a filter under another name is mapped, an unknown one is refused, never silently dropped', async () => {
  const c = fake({ discover: { request_id: 'r', summary: 'About 812 match.', cost: { quoted_credits: 0, charged_credits: 0 }, total_matching: 812, accounts: [] } });
  await ops.discover(c, { account_filters: { industries: ['software'], countries: ['gb'] }, count_only: true });
  assert.deepEqual(c.calls[0].body.account_filters, { industry: ['software'], country: ['GB'] });
  const e = await refused(() => ops.discover(c, { account_filters: { industry: ['software'], region: 'EMEA' }, count_only: true }));
  assert.equal(e.code, 'request.invalid');
  assert.match(e.detail, /Unknown account_filters key: region/);
  assert.equal(c.calls.length, 1, 'nothing was sent for the refused call');
  await ops.discover(c, { account_filters: { industry: ['software'] }, contact_filters: { titles: ['CTO'] }, count_only: true });
  assert.deepEqual(c.calls[1].body.contact_filters, { job_title: ['CTO'] });
});

test('docs: slash commands are written with the plugin prefix, as Claude Code shows them', async () => {
  const { readdirSync, statSync } = await import('node:fs');
  const root = new URL('../', import.meta.url).pathname;
  const commands = readdirSync(join(root, 'plugins/agentic-id/commands')).map((f) => f.replace(/\.md$/, ''));
  const short = new RegExp(`(?<!agentic-id:)/(${commands.join('|')})\\b`);
  const walk = (d) => readdirSync(d).flatMap((n) => (n === '.git' || n === 'node_modules' ? [] : statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
  const bad = walk(root).filter((f) => /\.(md|json|mjs)$/.test(f) && !f.includes('/test/') && !/_tools\.json$/.test(f)).filter((f) => short.test(readFileSync(f, 'utf8')));
  assert.deepEqual(bad, [], `short command names in: ${bad.join(', ')}`);
});

test('npm package: one version everywhere, and it ships every file the agentic-id command loads', async () => {
  const { existsSync, statSync } = await import('node:fs');
  const { dirname, relative, resolve } = await import('node:path');
  const { CLIENT } = await import('../cli/lib/client.mjs');
  const root = new URL('../', import.meta.url).pathname;
  const read = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));
  const pkg = read('package.json');
  const version = read('plugins/agentic-id/.claude-plugin/plugin.json').version;
  assert.equal(pkg.name, 'agentic-id');
  assert.equal(pkg.version, version, 'package.json and plugin.json carry the same version');
  assert.equal(read('.claude-plugin/marketplace.json').plugins[0].version, version);
  assert.equal(CLIENT, `agentic-id-plugin/${version}`);
  assert.equal(pkg.type, undefined, 'no "type": an extensionless bin under "type": "module" fails on Node 18');
  const bin = join(root, pkg.bin['agentic-id']);
  assert.ok(existsSync(bin), 'bin target exists');
  assert.ok(statSync(bin).mode & 0o111, 'bin target is executable');
  const shipped = (f) => pkg.files.some((p) => (p.endsWith('/') ? f.startsWith(p) : f === p));
  // Walk every relative import from the command, so a new module can't be left out of the package.
  const seen = new Set();
  const walk = (file) => {
    const rel = relative(root, file);
    if (seen.has(rel)) return;
    seen.add(rel);
    for (const [, spec] of readFileSync(file, 'utf8').matchAll(/(?:from\s+|import\()\s*['"](\.{1,2}\/[^'"]+)['"]/g)) walk(resolve(dirname(file), spec));
  };
  walk(bin);
  const missing = [...seen].filter((f) => !shipped(f));
  assert.deepEqual(missing, [], `not in package.json "files": ${missing.join(', ')}`);
});

test('the sign-in helper runs a command that exists (cli/agentic-id)', async () => {
  const { existsSync } = await import('node:fs');
  const { CLI_SCRIPT } = await import('../cli/lib/operations.mjs');
  assert.ok(existsSync(CLI_SCRIPT), CLI_SCRIPT);
});

// ------------------------------------------------------------------ buying credits
const TOPUP = { summary: 'A payment page for 1000 credits ($50.00) is ready.', topup_id: 'tu_1', url: 'https://pay.example/c/abc', credits: 1000, amount_usd: 50, expires_at: '2026-11-26T10:00:00Z' };

test('topup: a whole number above 0, checked before anything is sent', async () => {
  const c = fake({ topup: TOPUP });
  for (const bad of [0, -5, 1.5, 'ten', undefined, NaN]) {
    const e = await refused(() => ops.topup(c, { credits: bad }));
    assert.equal(e.local, true, String(bad));
  }
  await refused(() => ops.topup(c, { credits: 100, success_url: 'http://insecure.example' }));
  assert.equal(c.calls.length, 0, 'nothing sent for bad input');
  const t = await ops.topup(c, { credits: '1000' });
  assert.deepEqual(c.calls[0].body, { credits: 1000 });
  assert.equal(t.url, TOPUP.url);
  assert.match(t.note, /Nothing is charged until/);
});

test('cli topup: prints the summary and the link, never opens it; bad numbers exit 1', async () => {
  const ok = await cli(['topup', '1000'], fake({ topup: TOPUP }));
  assert.equal(ok.code, 0);
  assert.deepEqual(ok.client.calls[0], { verb: 'topup', body: { credits: 1000 } });
  assert.match(ok.out, /payment page for 1000 credits/);
  assert.match(ok.out, /pay here: https:\/\/pay\.example\/c\/abc/);
  assert.match(ok.out, /Nothing is charged until you pay/);
  const alias = await cli(['buy-credits', '500', '--json'], fake({ topup: { ...TOPUP, credits: 500, summary: undefined, amount_usd: 25 } }));
  assert.equal(JSON.parse(alias.out).url, TOPUP.url);
  assert.match(JSON.parse(alias.out).summary, /500 credits \(\$25\.00\)/);
  for (const bad of [[], ['0'], ['-3'], ['1.5'], ['lots']]) {
    const r = await cli(['topup', ...bad]);
    assert.equal(r.code, 1, bad.join(' '));
    assert.equal(r.client.calls.length, 0);
    if (bad[0] !== '-3') assert.match(r.err, /whole number of credits/); // '-3' reads as a flag: still exit 1, nothing sent
  }
  assert.match((await cli(['--help'])).out, /topup\s+<credits>/);
});

test('client topup: POST /v1/credits/topup; 400 and 503 topup.unavailable are refusals, payment words are not scrubbed', async () => {
  await withApi(
    (req, res) => {
      if (req.method !== 'POST' || req.url !== '/v1/credits/topup') return json(res, 404, { code: 'not_found', detail: 'no' });
      return json(res, 200, { ...TOPUP, summary: 'Open the payment page to pay. Payment required before credits are added.' });
    },
    async (baseUrl, seen) => {
      const r = await cli(['topup', '1000'], new AgenticId({ apiKey: 'k', baseUrl }));
      assert.equal(r.code, 0, r.err);
      assert.deepEqual(seen[0].body, { credits: 1000 });
      assert.match(seen[0].headers['idempotency-key'], /^[0-9a-f-]{36}$/);
      assert.match(r.out, /Payment required before credits are added/, 'the wallet\'s own payment words are kept');
    },
  );
  await withApi(
    (req, res) => json(res, 400, { code: 'request.invalid', detail: 'credits must be between 100 and 200000.', issues: [{ path: 'credits', message: 'too small' }] }),
    async (baseUrl, seen) => {
      const r = await cli(['topup', '5'], new AgenticId({ apiKey: 'k', baseUrl }));
      assert.equal(r.code, 4);
      assert.equal(seen.length, 1);
      assert.match(r.err, /refused \(400 request\.invalid\)[\s\S]*credits: too small/);
    },
  );
  await withApi(
    (req, res) => json(res, 503, { code: 'topup.unavailable', detail: 'Buying credits is not set up on this server.' }),
    async (baseUrl, seen) => {
      const r = await cli(['topup', '1000'], new AgenticId({ apiKey: 'k', baseUrl }));
      assert.equal(r.code, 4, 'a server that cannot sell credits is a refusal, not an outage');
      assert.equal(seen.length, 1, 'not retried');
      assert.match(r.err, /topup\.unavailable[\s\S]*fix: .*iCustomer account/);
    },
  );
});

test('workspace: recent top-ups shown when the server sends them, ignored when it does not', async () => {
  const base = {
    workspace: { workspace_id: 'ws_1', scopes: [], credits: { balance: 1090, held: 0, available: 1090 }, contributes: false, ids_held: 0 },
    credits: { credits: { available: 1090 }, spent: { today: 0, last_30_days: 0, by_tool: [] }, recent: [] },
  };
  const old = await cli(['workspace'], fake(base));
  assert.equal(old.code, 0);
  assert.doesNotMatch(old.out, /credits bought/);
  const topups = [
    { topup_id: 'tu_2', credits: 1000, amount_usd: 50, status: 'paid', created_at: '2026-11-25T09:00:00Z', paid_at: '2026-11-25T09:01:00Z' },
    { topup_id: 'tu_1', credits: 500, amount_usd: 25, status: 'expired', created_at: '2026-11-24T08:00:00Z' },
  ];
  const now = await cli(['workspace'], fake({ ...base, credits: { ...base.credits, topups } }));
  assert.match(now.out, /credits bought/);
  assert.match(now.out, /2026-11-25 09:01\s+\+1000 credits\s+\$50\.00\s+paid\s+tu_2/);
  assert.match(now.out, /2026-11-24 08:00\s+\+500 credits\s+\$25\.00\s+expired\s+tu_1/);
  assert.deepEqual((await ops.workspace(fake({ ...base, credits: { ...base.credits, topups } }))).topups, topups);
});

// ------------------------------------------------------------------ preview, plans, plain-language asks
const PLAN = '3f2b8c1e-0a4d-4e8f-9b6a-1c2d3e4f5a6b';
const RUN = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const PREVIEW = { summary: 'About 812 companies match.', preview: true, plan_id: PLAN, expires_at: '2026-11-25T10:30:00Z', quote: { credits_max: 200, results_expected: 200, runs_as: 'inline' } };

test('preview: free on every paid call, no cap needed, and it says how to run the plan', async () => {
  const c = fake({ discover: PREVIEW, find: PREVIEW, enrich: PREVIEW, lookalike: PREVIEW, validate: PREVIEW, resolve: PREVIEW });
  await ops.discover(c, { account_filters: { country: ['GB'] }, max_accounts: 2000, preview: true });
  assert.deepEqual(c.calls[0].body, { account_filters: { country: ['GB'] }, max_accounts: 2000, preview: true });
  await ops.find(c, { account: { domain: 'acme.io' }, roles: ['CTO'], limit: 400, preview: true });
  assert.equal(c.calls[1].body.preview, true);
  assert.equal('max_credits' in c.calls[1].body, false, 'a preview needs no cap');
  await ops.lookalike(c, { seeds: ['acme.io'], max_accounts: 900, preview: true });
  await ops.enrich(c, { contacts: Array.from({ length: 300 }, (_, i) => ({ email: `p${i}@acme.io` })), preview: true });
  assert.equal(c.calls.at(-1).body.contacts.length, 300, 'one preview call, not batches');
  await ops.validate(c, { emails: ['a@acme.io', 'b@acme.io'], preview: true });
  assert.deepEqual(c.calls.at(-1).body, { emails: ['a@acme.io', 'b@acme.io'], preview: true });
  assert.equal(estimate('find', { limit: 400, preview: true }).free, true);
  const r = await cli(['discover', '--country', 'GB', '--max-accounts', '2000', '--preview']);
  assert.equal(r.code, 0, 'a preview needs no --max-credits, however big the ask');
  const shown = await cli(['discover', '--country', 'GB', '--max-accounts', '200', '--preview'], fake({ discover: PREVIEW }));
  assert.equal(shown.code, 0, shown.err);
  assert.match(shown.out, /could cost at most 200 credits, about 200 results; it would answer in one call/);
  assert.match(shown.out, new RegExp(`agentic-id discover --plan ${PLAN} --max-credits 200`));
  // --count is the old name: it still sends count_only, which the server reads as a preview.
  const count = await cli(['discover', '--country', 'GB', '--count']);
  assert.equal(count.client.calls[0].body.count_only, true);
});

test('plan: runs exactly what a preview quoted, needs a cap, and only the plan and cap are sent', async () => {
  const c = fake({ discover: { request_id: 'r', summary: '200 accounts delivered. 200 credits charged.', cost: { quoted_credits: 200, charged_credits: 200 }, accounts: [] } });
  const ok = await cli(['discover', '--plan', PLAN, '--max-credits', '200'], c);
  assert.equal(ok.code, 0, ok.err);
  assert.deepEqual(c.calls[0].body, { plan_id: PLAN, max_credits: 200 });
  const noCap = await cli(['discover', '--plan', PLAN]);
  assert.equal(noCap.code, 3);
  assert.match(noCap.err, /needs max_credits/);
  assert.equal(noCap.client.calls.length, 0);
  const bad = await cli(['find', '--plan', 'not-a-plan', '--max-credits', '5']);
  assert.equal(bad.code, 1);
  assert.equal(bad.client.calls.length, 0);
  assert.equal((await cli(['validate', '--file', 'x.csv', '--preview'])).code, 1, 'no preview for a file run: --dry-run prices it');
  // An expired plan comes back with a fresh one to run.
  const expired = fake({ discover: () => { throw new AgenticIdError(409, 'plan.expired', 'The plan is more than 30 minutes old.', { preview: { plan_id: PLAN, quote: { credits_max: 150 } } }); } });
  const e = await cli(['discover', '--plan', PLAN, '--max-credits', '200'], expired);
  assert.equal(e.code, 4);
  assert.match(e.err, new RegExp(`fresh plan: ${PLAN} \\(at most 150 credits\\)`));
});

test('discover: a plain-language ask, NAICS and SIC codes, and a minimum trust grade', async () => {
  const c = fake();
  const r = await cli(['discover', 'mid-size', 'diagnostic imaging centres in Texas', '--preview'], c);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(c.calls[0].body, { ask: 'mid-size diagnostic imaging centres in Texas', preview: true });
  const both = await cli(['discover', '--ask', 'imaging centres', '--country', 'US', '--naics', '621512,6215', '--sic', '8071', '--min-trust', 'b', '--max-accounts', '5']);
  assert.deepEqual(both.client.calls[0].body, { ask: 'imaging centres', account_filters: { naics: ['621512', '6215'], sic: ['8071'], country: ['US'] }, max_accounts: 5, min_trust: 'B', max_credits: 5 });
  for (const bad of [['discover', '--ask', 'hi', '--preview'], ['discover', '--naics', 'imaging', '--preview'], ['discover', '--sic', '12345', '--preview'], ['lookalike', 'acme.io', '--min-trust', 'E']]) {
    const x = await cli(bad);
    assert.equal(x.code, 1, bad.join(' '));
    assert.equal(x.client.calls.length, 0, bad.join(' '));
  }
  const l = await cli(['lookalike', 'acme.io', 'globex.com', '--min-trust', 'A', '--max-accounts', '5']);
  assert.equal(l.client.calls[0].body.min_trust, 'A');
  // How the ask was read, and every reading when it could mean more than one search.
  const intent = { ask: 'imaging in Texas', read_as: 'Diagnostic imaging centres in Texas, US', readings: [{ read_as: 'Diagnostic imaging centres in Texas, US', account_filters: { naics: ['621512'] } }, { read_as: 'Imaging software companies in Texas', account_filters: { industry: ['software'] } }], account_filters: { naics: ['621512'] } };
  const read = await cli(['discover', 'imaging in Texas', '--preview'], fake({ discover: { ...PREVIEW, intent, filters_read_as: [{ field: 'industry', given: 'imaging', read_as: 'NAICS 621512' }] } }));
  assert.match(read.out, /read "imaging in Texas" as: Diagnostic imaging centres in Texas, US/);
  assert.match(read.out, /2\. Imaging software companies in Texas/);
  assert.match(read.out, /"imaging" \(industry\) read as NAICS 621512/);
  // Not previewed, an ask with several readings is refused by the server, nothing charged: the readings are shown.
  const amb = fake({ discover: () => { throw new AgenticIdError(409, 'intent.ambiguous', 'That ask can be read 2 ways, so nothing was run or charged.', { readings: intent.readings }); } });
  const a = await cli(['discover', 'imaging in Texas', '--max-credits', '25'], amb);
  assert.equal(a.code, 4);
  assert.match(a.err, /1\. Diagnostic imaging centres[\s\S]*2\. Imaging software[\s\S]*fix: .*--preview/);
});

test('accounts and people show industry, NAICS, the size check and Agentic ID\'s trust verdict as given', async () => {
  const accounts = [
    { id: 'ic-a1', domain: 'acme-imaging.com', country: 'US', industry: 'Diagnostic imaging', naics: ['621512'], employees: { min: 51, max: 200 }, size_check: 'single', charged: true, trust: { grade: 'C', score: 55, summary: 'Size rests on one source.', rubric: 'v1' } },
    { id: 'ic-a2', domain: 'globex-scan.com', country: 'US', industry: 'Diagnostic imaging', employees: { min: 201, max: 500 }, size_check: 'confirmed', charged: true, trust: { grade: 'A', score: 95, summary: 'Identity verified; key fields corroborated.', rubric: 'v1' } },
  ];
  const contacts = [{ id: 'ic-p1', name: 'Ann Lee', title: 'CTO', email: 'ann@acme-imaging.com', level: 'corroborated', trust: { grade: 'B', summary: 'Title and employer corroborated.' } }];
  const r = await cli(['discover', '--naics', '621512', '--max-accounts', '2'], fake({ discover: { summary: '2 accounts delivered. 2 credits charged.', cost: { quoted_credits: 2, charged_credits: 2 }, accounts, contacts, excluded: { below_min_trust: 3 }, rejected: [] } }));
  assert.match(r.out, /acme-imaging\.com\s+US\s+51-200\s+Diagnostic imaging\s+\[C\]/);
  assert.match(r.out, /NAICS 621512 · size from one source only · trust C: Size rests on one source\./);
  assert.match(r.out, /globex-scan\.com[^\n]*\[A\]\n\s+trust A: Identity verified/);
  assert.match(r.out, /Ann Lee[^\n]*\[B\]\n\s+trust B: Title and employer corroborated\./);
  assert.match(r.out, /left out: 3 below_min_trust/);
});

// ------------------------------------------------------------------ runs
const RUN_LINKS = { self: `/v1/runs/${RUN}`, results: `/v1/runs/${RUN}/results`, stream: `/v1/runs/${RUN}/stream`, cancel: `/v1/runs/${RUN}/cancel`, resume: `/v1/runs/${RUN}/resume`, export: `/v1/runs/${RUN}/export` };
const runOf = (over = {}) => ({ run_id: RUN, type: 'discover', status: 'running', progress: { asked: 2000, delivered: 2, parts: { total: 4, done: 1, failed: 0, waiting: 2, running: 1 } }, credits: { charged: 2, max: 2000 }, created_at: '2026-11-25T09:00:00Z', links: RUN_LINKS, ...over });

test('a big search carries on as a run: its ID, its first results and how to follow it', async () => {
  const accepted = { ...runOf(), summary: `2 results so far, about 1,998 more on the way. Read the rest at /v1/runs/${RUN}/results?after=3, follow /v1/runs/${RUN}/stream, or export it when it is done.`, results: [{ type: 'account', domain: 'acme.io', country: 'GB', trust: { grade: 'B', summary: 'ok' } }], next: `/v1/runs/${RUN}/results?after=3` };
  const r = await cli(['discover', '--country', 'GB', '--industry', 'software', '--max-accounts', '2000', '--max-credits', '2000'], fake({ discover: accepted }));
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /2 results so far, about 1,998 more on the way\./);
  assert.doesNotMatch(r.out, /\/v1\/runs/, 'the CLI says its own commands, not API paths');
  assert.match(r.out, new RegExp(`carries on as run ${RUN}\\. Running: more results are on the way \\(2 of 2000 delivered so far\\)`));
  assert.match(r.out, /acme\.io\s+GB/);
  assert.match(r.out, new RegExp(`agentic-id runs results ${RUN} --out discover\\.csv --wait`));
  assert.match(r.out, new RegExp(`agentic-id runs cancel ${RUN}`));
  const paused = await cli(['find', 'acme.io', '--role', 'CTO', '--limit', '100', '--max-credits', '10'], fake({ find: { ...runOf({ type: 'find', status: 'paused', reason: 'credits' }), summary: 'Paused with 0 results so far.', results: [], next: null } }));
  assert.equal(paused.code, 3, 'out of credits is a budget matter');
  assert.match(paused.out, /ran out of credits[\s\S]*agentic-id topup[\s\S]*agentic-id runs resume/);
  assert.equal(JSON.parse((await cli(['lookalike', 'acme.io', '--max-accounts', '900', '--max-credits', '900', '--json'], fake({ lookalike: { ...runOf({ type: 'lookalike' }), summary: 's', results: [], next: null } }))).out).run_id, RUN);
});

test('run status in plain words: completed, exhausted, running, paused, cancelled, failed', () => {
  assert.match(ops.runStatusWords(runOf({ status: 'completed', progress: { asked: 10, delivered: 10 } })), /^Completed: everything asked for was delivered \(10 of 10 delivered\)/);
  assert.match(ops.runStatusWords(runOf({ status: 'exhausted', why_fewer: { asked: 500, delivered: 312, excluded: { below_min_trust: 40, size_unconfirmed: 8 }, detail: 'Too few passed the checks.' } })), /fewer than asked \(312 of 500 delivered\)\. Too few passed the checks\. Left out: 40 below min trust, 8 size unconfirmed\./);
  assert.match(ops.runStatusWords(runOf({ waiting: { reason: 'daily_source_budget', until: 'x', detail: 'Waiting: it carries on by itself after midnight UTC.' } })), /Running[\s\S]*carries on by itself/);
  assert.match(ops.runStatusWords(runOf({ status: 'paused', reason: 'max_credits' })), /own credit cap[\s\S]*--max-credits/);
  assert.match(ops.runStatusWords(runOf({ status: 'paused', reason: 'source_cap' })), /budget for paid data/);
  assert.match(ops.runStatusWords(runOf({ status: 'cancelled' })), /stays delivered and charged; nothing more is spent/);
  assert.match(ops.runStatusWords(runOf({ status: 'failed', error: { code: 'refused' } })), /could not run \(refused\)/);
});

test('lists worked through in parts: a part that carries on as a run is followed to its end', async () => {
  const reply = { request_id: 'r', run_id: RUN, run_status: 'completed', summary: '2 emails checked.', cost: { quoted_credits: 2, charged_credits: 2 }, results: [{ email: 'a@acme.io', verdict: 'valid' }, { email: 'b@acme.io', verdict: 'invalid' }] };
  const c = fake({ validate: { ...runOf({ type: 'validate' }), summary: 's', results: [], next: 'x' }, followRun: reply });
  const r = await ops.validate(c, { emails: ['a@acme.io', 'b@acme.io'], max_credits: 2 });
  assert.equal(c.calls.find((x) => x.verb === 'followRun').body, RUN);
  assert.deepEqual(r.results.map((x) => x.verdict), ['valid', 'invalid']);
  // A part whose run paused (credits ran out) stops the list there, marked partial.
  const p = fake({ validate: { ...runOf({ type: 'validate' }), summary: 's', results: [], next: 'x' }, followRun: { ...reply, run_status: 'paused', results: reply.results.slice(0, 1), cost: { quoted_credits: 1, charged_credits: 1 } } });
  const emails = Array.from({ length: 1001 }, (_, i) => `p${i}@acme.io`);
  const part = await ops.validate(p, { emails, max_credits: 2000 });
  assert.equal(part.partial, true);
  assert.match(part.summary, /the run paused/);
  assert.equal(p.calls.filter((x) => x.verb === 'validate').length, 1, 'no further batches after a pause');
});

test('client: paid calls ask to wait 20 seconds; a run is followed with long polls, then its reply', async () => {
  let page = 0;
  await withApi(
    (req, res) => {
      if (req.url === '/v1/validate') return json(res, 202, { ...runOf({ type: 'validate' }), summary: 's', results: [], next: 'x' });
      if (req.url.startsWith(`/v1/runs/${RUN}/results`)) {
        page += 1;
        return json(res, 200, { run: runOf({ type: 'validate', status: page < 2 ? 'running' : 'completed' }), results: [], after: page, next: page < 2 ? `/v1/runs/${RUN}/results?after=${page}` : null });
      }
      if (req.url === `/v1/runs/${RUN}/reply`) return json(res, 200, { request_id: 'r', run_id: RUN, run_status: 'completed', summary: '1 email checked.', cost: { quoted_credits: 1, charged_credits: 1 }, results: [{ email: 'a@acme.io', verdict: 'valid' }] });
      return json(res, 404, { code: 'not_found', detail: req.url });
    },
    async (baseUrl, seen) => {
      const r = await cli(['validate', 'a@acme.io'], new AgenticId({ apiKey: 'k', baseUrl }));
      assert.equal(r.code, 0, r.err);
      assert.match(r.out, /valid\s+a@acme\.io/);
      assert.equal(seen[0].headers.prefer, 'wait=20');
      assert.deepEqual(seen.map((x) => x.url.split('?')[0]), ['/v1/validate', `/v1/runs/${RUN}/results`, `/v1/runs/${RUN}/results`, `/v1/runs/${RUN}/reply`]);
      assert.equal(seen[1].headers.prefer, 'wait=20', 'a long poll, never a tight loop');
      assert.match(seen[2].url, /after=1/);
    },
  );
});

test('cli runs: list, show, results to a CSV, cancel, resume and export, all over the API', async () => {
  let results = 0;
  await withApi(
    (req, res) => {
      const u = req.url;
      if (u.startsWith('/v1/runs?')) return json(res, 200, { runs: [runOf(), runOf({ run_id: 'b'.repeat(8) + RUN.slice(8), status: 'exhausted', type: 'find', progress: { asked: 50, delivered: 12, parts: { total: 1, done: 1, failed: 0, waiting: 0, running: 0 } }, why_fewer: { asked: 50, delivered: 12, excluded: {} } })] });
      if (u === `/v1/runs/${RUN}`) return json(res, 200, runOf({ status: 'paused', reason: 'credits' }));
      if (u.startsWith(`/v1/runs/${RUN}/results`)) {
        results += 1;
        const recs = results === 1 ? [{ type: 'account', domain: 'acme.io', country: 'GB', naics: ['5112'], employees: { min: 51, max: 200 }, trust: { grade: 'B', summary: 'Key fields corroborated.' } }] : [{ type: 'account', domain: 'globex.com', country: 'GB', tags: ['a', 'b'] }];
        return json(res, 200, { run: runOf({ status: results === 1 ? 'running' : 'completed' }), results: recs, after: results, next: results === 1 ? 'more' : null });
      }
      if (u === `/v1/runs/${RUN}/cancel`) return json(res, 200, runOf({ status: 'cancelled' }));
      if (u === `/v1/runs/${RUN}/resume`) return json(res, 200, runOf());
      if (u.startsWith(`/v1/runs/${RUN}/export`)) return json(res, 200, { run_id: RUN, url: `https://example.test/v1/runs/${RUN}/download?sig=abc`, format: 'csv', expires_at: '2026-11-25T11:00:00Z' });
      if (u.startsWith('/v1/runs/')) return json(res, 404, { code: 'run.not_found', detail: 'No run with that ID in this workspace.' });
      return json(res, 404, { code: 'not_found', detail: u });
    },
    async (baseUrl, seen) => {
      const c = new AgenticId({ apiKey: 'k', baseUrl });
      const list = await cli(['runs', '--status', 'running', '--limit', '5'], c);
      assert.equal(list.code, 0, list.err);
      assert.equal(seen[0].url, '/v1/runs?status=running&limit=5');
      assert.match(list.out, new RegExp(`${RUN}\\s+discover\\s+running\\s+2/2000`));
      assert.match(list.out, /find\s+exhausted\s+12\/50/);
      const show = await cli(['runs', 'show', RUN], c);
      assert.equal(show.code, 3, 'paused for credits is a budget matter');
      assert.match(show.out, /ran out of credits/);
      assert.equal((await cli(['runs', RUN], c)).code, 3, 'runs <id> is runs show <id>');
      const dir = mkdtempSync(join(tmpdir(), 'aid-runs-'));
      const out = join(dir, 'r.csv');
      const got = await cli(['runs', 'results', RUN, '--out', out, '--wait'], c);
      assert.equal(got.code, 0, got.err);
      const csv = readFileSync(out, 'utf8');
      assert.match(csv.split('\n')[0], /^type,domain,country,naics,employees_min,employees_max,trust_grade,trust_summary,tags/);
      assert.match(csv, /account,acme\.io,GB,5112,51,200,B,Key fields corroborated\./);
      assert.match(csv, /account,globex\.com,GB,,,,,,a; b/);
      assert.match(got.out, /2 results read/);
      assert.equal(seen.filter((x) => x.url.includes('/results')).every((x) => x.headers.prefer === 'wait=20'), true);
      const cancel = await cli(['runs', 'cancel', RUN], c);
      assert.match(cancel.out, /Cancelled/);
      assert.equal(seen.at(-1).method, 'POST');
      await cli(['runs', 'resume', RUN, '--max-credits', '3000', '--source-cap', '10'], c);
      assert.deepEqual(seen.at(-1).body, { max_credits: 3000, source_spend_cap_usd: 10 });
      const exp = await cli(['runs', 'export', RUN], c);
      assert.match(exp.out, /download link[\s\S]*Anyone with the link[\s\S]*https:\/\/example\.test/);
      const n = seen.length;
      const bad = await cli(['runs', 'show', 'not-a-run'], c);
      assert.equal(bad.code, 1);
      assert.equal(seen.length, n, 'nothing sent for a bad ID');
      assert.equal((await cli(['runs', 'resume', RUN, '--source-cap', '99'], c)).code, 1);
      const missing = await cli(['runs', 'show', RUN.replace(/^9/, '1')], c);
      assert.equal(missing.code, 4);
      assert.match(missing.err, /run\.not_found[\s\S]*agentic-id runs/);
    },
  );
  assert.equal((await cli(['runs', 'frobnicate', RUN])).code, 1);
  assert.equal((await cli(['runs', 'cancel'])).code, 1);
});

// ------------------------------------------------------------------ API keys
const signedIn = (replies) => Object.assign(fake(replies), { apiKey: undefined, authMode: 'signin' });
const SECRET = ['ic', 'live', 'unit0test0secret0value'].join('-'); // built here so no key-shaped text sits in the repo

test('keys: listed by prefix only; made once and shown once, to a signed-in user', async () => {
  const list = await cli(['keys'], fake({ keys: { keys: [{ prefix: 'ic-live-AbC1', name: 'laptop', created_at: '2026-11-20T09:00:00Z' }, { prefix: 'ic-live-XyZ9', name: 'ci', created_at: '2026-11-01T09:00:00Z', revoked_at: '2026-11-10T09:00:00Z' }] } }));
  assert.equal(list.code, 0, list.err);
  assert.match(list.out, /1 active key, 1 revoked/);
  assert.match(list.out, /ic-live-AbC1\s+laptop\s+made 2026-11-20 09:00 UTC/);
  assert.match(list.out, /ic-live-XyZ9[^\n]*revoked 2026-11-10/);
  const made = signedIn({ createKey: { key: SECRET, prefix: 'ic-live-unit', name: 'laptop', created_at: '2026-11-25T09:00:00Z' } });
  const r = await cli(['keys', 'create', '--name', 'laptop'], made);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(made.calls[0], { verb: 'createKey', body: { name: 'laptop' } });
  assert.equal(r.out.split(SECRET).length - 1, 1, 'the key is printed exactly once');
  assert.match(r.out, /Copy it now: it will not be shown again/);
  assert.equal(r.err.includes(SECRET), false);
  const j = await cli(['keys', 'create', '--json'], signedIn({ createKey: { key: SECRET, prefix: 'ic-live-unit', name: 'api key', created_at: 'x' } }));
  assert.equal(JSON.parse(j.out).key, SECRET);
  assert.equal((await cli(['keys', 'create', '--name', 'x'.repeat(65)], signedIn())).code, 1);
});

test('keys: an API key cannot make or revoke keys: refused before sending, exit 2, with how to sign in', async () => {
  const keyed = fake();
  const r = await cli(['keys', 'create'], keyed);
  assert.equal(r.code, 2);
  assert.equal(keyed.calls.length, 0, 'nothing sent');
  assert.match(r.err, /signed-in user[\s\S]*fix: Run `agentic-id login`/);
  assert.equal((await cli(['keys', 'revoke', 'ic-live-AbC1'], keyed)).code, 2);
  // The server says the same when it is asked anyway (a sign-in it does not take as one).
  const srv = signedIn({ createKey: () => { throw new AgenticIdError(403, 'auth.sign_in_required', 'Only a signed-in user can make or revoke API keys.'); } });
  const s403 = await cli(['keys', 'create'], srv);
  assert.equal(s403.code, 2);
  assert.match(s403.err, /refused \(403 auth\.sign_in_required\)[\s\S]*agentic-id login/);
});

test('keys revoke: by prefix over DELETE; a whole key is never sent; an unknown prefix exits 4', async () => {
  const c = signedIn({ revokeKey: { revoked: true, prefix: 'ic-live-AbC1' } });
  const r = await cli(['keys', 'revoke', 'ic-live-AbC1'], c);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Key ic-live-AbC1 revoked\. It stops working within 30 seconds\./);
  const whole = await cli(['keys', 'revoke', SECRET + 'x'.repeat(20)], signedIn());
  assert.equal(whole.code, 1);
  assert.equal(whole.client.calls.length, 0);
  assert.match(whole.err, /looks like a whole key/);
  assert.equal(whole.err.includes(SECRET), false, 'the key is not repeated back');
  assert.equal((await cli(['keys', 'revoke'], signedIn())).code, 1);
  await withApi(
    (req, res) => (req.method === 'DELETE' && req.url === '/v1/keys/ic-live-AbC1' ? json(res, 200, { revoked: true, prefix: 'ic-live-AbC1' }) : json(res, 404, { code: 'key.not_found', detail: 'No active key ic-live-Nope in this workspace.' })),
    async (baseUrl, seen) => {
      const api = new AgenticId({ apiKey: 'k', baseUrl });
      Object.defineProperty(api, 'authMode', { value: 'signin' });
      assert.equal((await cli(['keys', 'revoke', 'ic-live-AbC1'], api)).code, 0);
      assert.equal(seen[0].method, 'DELETE');
      const nf = await cli(['keys', 'revoke', 'ic-live-Nope'], api);
      assert.equal(nf.code, 4);
      assert.match(nf.err, /key\.not_found[\s\S]*agentic-id keys/);
    },
  );
});
