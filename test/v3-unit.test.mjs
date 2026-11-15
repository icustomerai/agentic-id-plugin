// Unit tests for the V3 layer the plugin ships: input guards, estimates, CSV, the operations
// (against a fake API client), the MCP server's protocol handling and the CLI. No network.
//   node --test test/v3-unit.test.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer as createHttp } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { main } from '../plugins/agentic-id/server/cli.mjs';
import { AgenticId, AgenticIdError, keyFromEnv, urlFromEnv } from '../plugins/agentic-id/server/lib/client.mjs';
import { mapColumns, parseCsv, toCsv } from '../plugins/agentic-id/server/lib/csv.mjs';
import { estimate } from '../plugins/agentic-id/server/lib/estimate.mjs';
import { cleanCountry, cleanDomain, cleanEmail, cleanEmails, cleanIdentifiers, cleanLinkedin, cleanList, looksLikePhone } from '../plugins/agentic-id/server/lib/guards.mjs';
import * as ops from '../plugins/agentic-id/server/lib/operations.mjs';
import { TOOLS } from '../plugins/agentic-id/server/lib/tools.mjs';
import { createServer } from '../plugins/agentic-id/server/mcp.mjs';

/** A stand-in for the API client: records every call, answers from `replies` (a function per verb). */
function fake(replies = {}) {
  const calls = [];
  const verb = (name) => async (body) => {
    calls.push({ verb: name, body });
    const r = replies[name];
    return typeof r === 'function' ? r(body, calls.filter((c) => c.verb === name).length) : r ?? { request_id: `req_${calls.length}`, summary: `${name} ok`, cost: { quoted_credits: 0, charged_credits: 0 }, results: [] };
  };
  return { calls, apiKey: 'k', baseUrl: 'http://fake', validate: verb('validate'), resolve: verb('resolve'), enrich: verb('enrich'), find: verb('find'), discover: verb('discover'), lookalike: verb('lookalike'), facts: verb('facts'), ledger: verb('ledger'), me: verb('me'), workspace: verb('workspace'), credits: verb('credits'), feedback: verb('feedback') };
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
  const r = await ops.find(c, { account: { domain: 'acme.io' }, seniority: 'director+', limit: 99, max_credits: 50 });
  assert.equal(c.calls[1].body.limit, 25);
  assert.match(r.input_notes[0], /lowered to 25/);
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
  assert.equal(w.contact_values, 'masked');
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
  const { rememberUrl, urlFromEnv, DEFAULT_URL } = await import('../plugins/agentic-id/server/lib/client.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'aid-url-'));
  assert.equal(urlFromEnv({ AGENTIC_ID_CONFIG_DIR: dir }), DEFAULT_URL);
  assert.equal(rememberUrl({ AGENTIC_ID_CONFIG_DIR: dir, AGENTIC_ID_URL: 'https://api.example.test/', AGENTIC_ID_API_KEY: 'ic-dev-secret' }), true);
  assert.equal(urlFromEnv({ AGENTIC_ID_CONFIG_DIR: dir }), 'https://api.example.test');
  assert.doesNotMatch(readFileSync(join(dir, 'server.json'), 'utf8'), /secret/);
  assert.equal(urlFromEnv({ AGENTIC_ID_CONFIG_DIR: dir, AGENTIC_ID_URL: 'http://other.test' }), 'http://other.test', 'the environment wins');
  assert.equal(rememberUrl({ AGENTIC_ID_CONFIG_DIR: dir, AGENTIC_ID_URL: '${user_config.api_url}' }), false, 'an unfilled option is not remembered');
});

test('list tool: a dry run is free, a paid run needs a cap, the result is a new file and rows never come back', async () => {
  const { mkdtempSync, readFileSync, writeFileSync, existsSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { list } = await import('../plugins/agentic-id/server/lib/list.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'aid-list-'));
  const file = join(dir, 'leads.csv');
  writeFileSync(file, 'email,company\njane@acme.io,Acme\nJANE@acme.io,Acme\nsomeone@gmail.com,Home\n');
  const c = fake({ validate: (b) => ({ request_id: 'r', summary: 'ok', cost: { quoted_credits: 1, charged_credits: 1 }, results: b.emails.map((email) => ({ email, verdict: 'valid' })) }) });
  const dry = await list(c, { action: 'validate', file, dry_run: true });
  assert.equal(dry.dry_run, true);
  assert.match(dry.summary, /3 rows/);
  assert.equal(c.calls.length, 0, 'a dry run sends nothing');
  await assert.rejects(() => list(c, { action: 'validate', file }), (e) => e.code === 'cap_required' && /dry_run/.test(e.fix));
  const done = await list(c, { action: 'validate', file, max_credits: 5 });
  assert.equal(done.out_file, join(dir, 'leads.agentic-id.csv'));
  assert.equal(done.cost.charged_credits, 1);
  assert.deepEqual(c.calls[0].body.emails, ['jane@acme.io'], 'the repeat is sent once and the personal address not at all');
  assert.ok(!JSON.stringify(done).includes('jane@'), 'rows are not returned to the conversation');
  const out = readFileSync(done.out_file, 'utf8');
  assert.match(out, /email_verdict/);
  assert.match(out, /someone@gmail\.com,Home,rejected/);
  assert.equal(readFileSync(file, 'utf8').split('\n')[0], 'email,company', 'the input is untouched');
  await assert.rejects(() => list(c, { action: 'validate', file, out: file, max_credits: 5 }), /must not be the input/);
  await assert.rejects(() => list(c, { action: 'validate', file: join(dir, 'nope.csv') }), (e) => e.code === 'file_not_found');
  await assert.rejects(() => list(c, { action: 'delete', file }), /action must be/);
  assert.ok(existsSync(done.out_file));
});

test('budget hook: a call with no cap is priced at its estimate, and larger spends need the user to approve', async () => {
  const { decide, needsConfirmation, confirmAboveFrom, worstCase } = await import('../plugins/agentic-id/hooks/budget-guard.mjs');
  const t = (verb) => `mcp__plugin_agentic-id_agentic-id__agentic_id_${verb}`;
  const five = { tool_name: t('resolve_many'), tool_input: { records: [{ email: 'a@acme.io' }, { email: 'b@acme.io' }, { email: 'c@acme.io' }, { email: 'd@acme.io' }, { email: 'e@acme.io' }] } };
  assert.equal(worstCase(five), 5);
  assert.match(decide(five, 2, 0), /could spend up to 5 credits/, 'no max_credits is not a way round the session budget');
  assert.equal(decide(five, 10, 0), null);
  assert.equal(worstCase({ tool_name: t('list'), tool_input: { action: 'resolve', file: '/x.csv', dry_run: true } }), 0);
  assert.equal(worstCase({ tool_name: t('list'), tool_input: { action: 'resolve', file: '/x.csv' } }), Infinity);
  assert.equal(confirmAboveFrom({}), 10);
  assert.equal(confirmAboveFrom({ CLAUDE_PLUGIN_OPTION_CONFIRM_ABOVE: '${user_config.confirm_above}' }), 10);
  assert.equal(confirmAboveFrom({ CLAUDE_PLUGIN_OPTION_CONFIRM_ABOVE: '250' }), 250);
  assert.equal(needsConfirmation({ tool_name: t('discover'), tool_input: { max_accounts: 5, max_credits: 5 } }, 10), null);
  assert.match(needsConfirmation({ tool_name: t('discover'), tool_input: { max_accounts: 300, max_credits: 300 } }, 10), /may spend up to 300 credits/);
  assert.match(needsConfirmation({ tool_name: t('discover'), tool_input: { max_accounts: 50 } }, 10), /up to 50 credits/, 'priced even without max_credits');
  assert.equal(needsConfirmation({ tool_name: t('discover'), tool_input: { count_only: true, max_accounts: 300 } }, 10), null);
  assert.equal(needsConfirmation({ tool_name: t('workspace'), tool_input: {} }, 0), null, 'free calls never ask');
  // Many small calls: approval again when the session's spend would cross another 10.
  const one = { tool_name: t('resolve'), tool_input: { email: 'a@acme.io', max_credits: 1 } };
  assert.equal(needsConfirmation(one, 10, 0), null);
  assert.equal(needsConfirmation(one, 10, 8), null);
  assert.equal(needsConfirmation(one, 10, 9), null, 'the tenth credit goes through');
  assert.match(needsConfirmation(one, 10, 10), /has spent 10 credits .* go past 10 credits/, 'the eleventh asks');
  assert.equal(needsConfirmation(one, 10, 11), null);
  assert.match(needsConfirmation({ tool_name: t('discover'), tool_input: { max_accounts: 5, max_credits: 5 } }, 10, 17), /go past 20 credits/);
  assert.equal(needsConfirmation({ tool_name: t('discover'), tool_input: { max_accounts: 3, max_credits: 3 } }, 10, 17), null, '17 + 3 reaches 20 but does not pass it');
  assert.match(needsConfirmation({ tool_name: t('resolve'), tool_input: { email: 'a@acme.io' } }, 0), /up to 1 credits/, '0 asks before every paid call');
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

test('prompt hint: company, people, list and credit questions get the reminder; other work does not', async () => {
  const { hintFor } = await import('../plugins/agentic-id/hooks/prompt-hint.mjs');
  for (const p of ['How many fintech companies are there in Germany?', 'Identify notion.so for me.', 'What did I spend today, and on which companies?', 'find 50 leads like these', 'is jane@acme.io a real email? check it', 'sign me in']) assert.match(hintFor(p), /agentic_id/, p);
  for (const p of ['write me a haiku about spreadsheets', 'fix the failing unit test in src/app.ts', 'refactor this function', 'what is identity resolution?']) assert.equal(hintFor(p), null, p);
  assert.match(hintFor('what did I spend'), /agentic_id_workspace .*never the local log/);
  assert.equal(hintFor(undefined), null);
});

test('list tool: replace_original saves the original first, and never replaces it after a partial run', async () => {
  const { mkdtempSync, readFileSync, writeFileSync, existsSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { list } = await import('../plugins/agentic-id/server/lib/list.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'aid-replace-'));
  const file = join(dir, 'leads.csv');
  const original = 'email\na@alpha-synthetic.com\nb@beta-synthetic.com\nc@gamma-synthetic.com\n';
  writeFileSync(file, original);
  const c = fake({ resolve: () => ({ cost: { quoted_credits: 1, charged_credits: 1 }, id: `ic-id${Math.random().toString(36).slice(2, 8)}0`, outcome: 'new' }) });
  const partial = await list(c, { action: 'resolve', file, max_credits: 2, replace_original: true });
  assert.equal(readFileSync(file, 'utf8'), original, 'a run stopped by its cap leaves the original alone');
  assert.equal(partial.partial, true);
  assert.ok(existsSync(join(dir, 'leads.agentic-id.csv')));
  const done = await list(c, { action: 'resolve', file, max_credits: 5, replace_original: true });
  assert.equal(done.original_saved_as, join(dir, 'leads.original.csv'));
  assert.equal(readFileSync(done.original_saved_as, 'utf8'), original, 'the original is saved byte for byte');
  assert.match(readFileSync(file, 'utf8'), /agentic_id/, 'and the result is now in the file');
  await assert.rejects(() => list(c, { action: 'resolve', file, out: join(dir, 'x.csv'), replace_original: true, max_credits: 5 }), /either out or replace_original/);
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
  assert.equal(urlFromEnv({ AGENTIC_ID_URL: '${user_config.api_url}', AGENTIC_ID_CONFIG_DIR: empty }), 'https://onesource-v3.icustomer.ai', 'with nothing set, the hosted service');
  assert.equal(urlFromEnv({ AGENTIC_ID_URL: 'http://127.0.0.1:3100' }), 'http://127.0.0.1:3100', 'a local stack is still one setting away');
  assert.equal(urlFromEnv({ AGENTIC_ID_URL: 'https://api.example.test/' }), 'https://api.example.test');
  const dir = mkdtempSync(join(tmpdir(), 'aid-key-'));
  writeFileSync(join(dir, 'key'), 'Agentic ID key: from-a-file\n');
  assert.equal(keyFromEnv({ AGENTIC_ID_API_KEY_FILE: join(dir, 'key') }), 'from-a-file');
});

// ------------------------------------------------------------------ MCP protocol
const rpc = (server, method, params, id = 1) => server.handle({ jsonrpc: '2.0', id, method, params });

test('mcp: initialize, ping, tools/list and unknown methods', async () => {
  const s = createServer({ client: fake() });
  const init = await rpc(s, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '0' } });
  assert.equal(init.result.protocolVersion, '2025-03-26');
  assert.equal((await rpc(s, 'initialize', { protocolVersion: '1999-01-01' })).result.protocolVersion, '2025-06-18');
  assert.equal(init.result.serverInfo.name, 'agentic-id');
  assert.deepEqual((await rpc(s, 'ping')).result, {});
  assert.equal(await s.handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), undefined, 'notifications get no answer');
  assert.equal((await rpc(s, 'nope/nope')).error.code, -32601);
  assert.equal((await s.handle({ id: 1, method: 'ping' })).error.code, -32600);
  const { tools } = (await rpc(s, 'tools/list')).result;
  assert.deepEqual(tools.map((t) => t.name), TOOLS.map((t) => t.name));
  for (const t of tools) {
    assert.match(t.name, /^agentic_id_[a-z_]+$/);
    assert.equal(t.inputSchema.type, 'object');
    assert.equal(t.inputSchema.additionalProperties, false, `${t.name} accepts no unknown keys`);
    assert.ok(t.description.length > 60 && t.description.length < 1024, `${t.name} description length`);
    assert.equal(t.run, undefined, 'the handler is not part of the listing');
    assert.equal(typeof t.annotations.readOnlyHint, 'boolean');
  }
});

test('mcp: a tool answer is a summary line plus JSON, and the same as structured content', async () => {
  const s = createServer({ client: fake({ discover: { request_id: 'req_9', summary: 'About 1,637 match. Nothing charged.', cost: { quoted_credits: 0, charged_credits: 0 }, accounts: [] } }) });
  const r = (await rpc(s, 'tools/call', { name: 'agentic_id_discover', arguments: { account_filters: { country: ['GB'] }, count_only: true } })).result;
  assert.equal(r.isError, undefined);
  const [summary, body] = r.content[0].text.split('\n');
  assert.equal(summary, 'About 1,637 match. Nothing charged.');
  assert.deepEqual(JSON.parse(body), r.structuredContent);
  assert.equal(r.structuredContent.request_id, 'req_9');
});

test('mcp: refusals are tool errors with error, message and fix; unknown arguments are caught', async () => {
  const s = createServer({ client: fake({ enrich: () => { throw new AgenticIdError(402, 'credits.insufficient', 'Not enough credits.', { available: 0 }); } }) });
  const local = (await rpc(s, 'tools/call', { name: 'agentic_id_resolve', arguments: { identifiers: { email: 'x@gmail.com' } } })).result;
  assert.equal(local.isError, true);
  assert.equal(local.structuredContent.sent, false);
  assert.match(local.content[0].text, /^Not sent: /);
  const remote = (await rpc(s, 'tools/call', { name: 'agentic_id_enrich', arguments: { contact: { email: 'a@acme.io' } } })).result;
  assert.equal(remote.structuredContent.error, 'credits.insufficient');
  assert.match(remote.content[0].text, /^Agentic ID refused \(402\)/);
  const typo = (await rpc(s, 'tools/call', { name: 'agentic_id_find', arguments: { account: { domain: 'acme.io' }, role: ['CTO'] } })).result;
  assert.match(typo.structuredContent.message, /Unknown argument: role/);
  assert.match(typo.structuredContent.fix, /roles/);
  assert.equal((await rpc(s, 'tools/call', { name: 'agentic_id_nope' })).result.isError, true);
});

test('mcp: a crash inside a tool is contained and leaks nothing', async () => {
  const s = createServer({ client: fake({ resolve: () => { throw new TypeError('secret detail jane@acme.io'); } }) });
  const r = (await rpc(s, 'tools/call', { name: 'agentic_id_resolve', arguments: { identifiers: { email: 'jane@acme.io' } } })).result;
  assert.equal(r.structuredContent.error, 'plugin_error');
  assert.doesNotMatch(r.content[0].text, /jane@acme\.io|secret detail/);
});

test('mcp: estimate and status work without touching the API', async () => {
  const c = fake({ me: { workspace_id: 'ws_1', scopes: [], key_prefix: 'ic-dev-x' } });
  const s = createServer({ client: c });
  const e = (await rpc(s, 'tools/call', { name: 'agentic_id_estimate', arguments: { tool: 'agentic_id_find', arguments: { account: { domain: 'acme-synthetic.io' }, roles: ['CTO'], limit: 10 } } })).result.structuredContent;
  assert.deepEqual([e.max_credits, e.auto_capped], [20, false]);
  assert.equal(c.calls.length, 0);
  assert.match((await rpc(s, 'tools/call', { name: 'agentic_id_status', arguments: {} })).result.structuredContent.contact_values, /masked/);
});

test('estimate refuses arguments the call itself would refuse, and never says "nothing to enrich" for 0 credits', async () => {
  const c = fake();
  const s = createServer({ client: c });
  const est = async (tool, args) => (await rpc(s, 'tools/call', { name: 'agentic_id_estimate', arguments: { tool, arguments: args } })).result;
  // Vicky's case: enrich "by ID". enrich takes identifiers, not an Agentic ID.
  const byId = await est('enrich', { id: 'ic-abc123def' });
  assert.equal(byId.isError, true);
  assert.match(byId.structuredContent.message, /does not take id/);
  assert.match(byId.structuredContent.fix, /agentic_id_facts/);
  const nestedId = await est('enrich', { contact: { id: 'ic-abc123def' } });
  assert.equal(nestedId.isError, true);
  assert.equal(nestedId.structuredContent.error, 'nothing_to_enrich');
  const empty = await est('enrich', {});
  assert.equal(empty.isError, true);
  assert.doesNotMatch(JSON.stringify(empty.structuredContent), /"max_credits":0/);
  const personal = await est('enrich', { contacts: [{ email: 'someone@gmail.com' }] });
  assert.equal(personal.isError, true);
  // The other paid tools: their own refusals come back from the estimate too.
  assert.equal((await est('find', { limit: 5 })).structuredContent.error, 'account_required');
  assert.equal((await est('discover', {})).structuredContent.error, 'request.invalid');
  assert.equal((await est('discover', { account_filters: { colour: 'red' } })).structuredContent.error, 'request.invalid');
  assert.equal((await est('resolve', { identifiers: { name: 'Jane Doe' } })).structuredContent.error, 'name_alone');
  assert.equal((await est('lookalike', { seeds: ['gmail.com'] })).structuredContent.error, 'request.invalid');
  assert.equal((await est('validate', {})).structuredContent.error, 'request.invalid');
  // Good arguments still give the arithmetic, and nothing is ever sent.
  const ok = (await est('enrich', { contact: { email: 'jane@acme-synthetic.io' } })).structuredContent;
  assert.deepEqual([ok.max_credits, ok.auto_capped], [2, true]);
  const big = (await est('discover', { account_filters: { industry: ['software'] }, max_accounts: 100 })).structuredContent;
  assert.equal(big.max_credits, 100);
  assert.equal(c.calls.length, 0, 'an estimate never calls the API');
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
test('budget hook: off by default, lets free calls through, blocks paid calls past the budget', async () => {
  const { budgetFrom, decide, spentInSession } = await import('../plugins/agentic-id/hooks/budget-guard.mjs');
  assert.equal(budgetFrom({}), null);
  assert.equal(budgetFrom({ CLAUDE_PLUGIN_OPTION_SESSION_BUDGET: '' }), null);
  assert.equal(budgetFrom({ CLAUDE_PLUGIN_OPTION_SESSION_BUDGET: 'lots' }), null);
  assert.equal(budgetFrom({ CLAUDE_PLUGIN_OPTION_SESSION_BUDGET: '100' }), 100);
  assert.equal(budgetFrom({ AGENTIC_ID_SESSION_BUDGET: '25', CLAUDE_PLUGIN_OPTION_SESSION_BUDGET: '100' }), 25);
  const t = (verb) => `mcp__plugin_agentic-id_agentic-id__agentic_id_${verb}`;
  assert.equal(decide({ tool_name: t('find'), tool_input: { max_credits: 10 } }, null, 999), null, 'no budget, no opinion');
  assert.equal(decide({ tool_name: t('find'), tool_input: { max_credits: 10 } }, 100, 20), null);
  assert.match(decide({ tool_name: t('find'), tool_input: { max_credits: 10 } }, 100, 100), /budget of 100 credits is spent/);
  assert.match(decide({ tool_name: t('enrich'), tool_input: { max_credits: 30 } }, 100, 80), /Set max_credits to 20 or less/);
  for (const free of ['facts', 'ledger', 'estimate', 'status', 'workspace', 'report']) assert.equal(decide({ tool_name: t(free), tool_input: {} }, 100, 500), null, free);
  assert.equal(decide({ tool_name: t('discover'), tool_input: { count_only: true } }, 100, 500), null);
  assert.match(decide({ tool_name: t('discover'), tool_input: {} }, 100, 500), /spent/);
  assert.equal(decide({ tool_name: 'mcp__github__create_issue', tool_input: {} }, 100, 500), null, 'other servers are never touched');

  const dir = mkdtempSync(join(tmpdir(), 'aid-budget-'));
  writeFileSync(join(dir, 'usage.jsonl'), [{ session_id: 's1', credits_charged: 4 }, { session_id: 's2', credits_charged: 50 }, { session_id: 's1', credits_charged: 6 }, { session_id: 's1', credits_charged: null }].map((r) => JSON.stringify(r)).join('\n') + '\nnot json\n');
  assert.equal(spentInSession('s1', dir), 10);
  assert.equal(spentInSession('s1', join(dir, 'missing')), 0);
});

test('budget hook: as Claude Code runs it, a denial is one JSON line and silence otherwise', async () => {
  const { spawnSync } = await import('node:child_process');
  const hook = new URL('../plugins/agentic-id/hooks/budget-guard.mjs', import.meta.url).pathname;
  const dir = mkdtempSync(join(tmpdir(), 'aid-budget-'));
  writeFileSync(join(dir, 'usage.jsonl'), `${JSON.stringify({ session_id: 's1', credits_charged: 12 })}\n`);
  const run = (payload, env) => spawnSync(process.execPath, [hook], { input: typeof payload === 'string' ? payload : JSON.stringify(payload), env: { PATH: process.env.PATH, AGENTIC_ID_CONFIG_DIR: dir, ...env }, encoding: 'utf8' });
  const paid = { session_id: 's1', tool_name: 'mcp__plugin_agentic-id_agentic-id__agentic_id_find', tool_input: { account: { domain: 'acme.io' }, max_credits: 4 } };
  const denied = run(paid, { CLAUDE_PLUGIN_OPTION_SESSION_BUDGET: '10' });
  assert.equal(denied.status, 0);
  const out = JSON.parse(denied.stdout);
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
  assert.doesNotMatch(denied.stdout, /acme\.io/, 'the reason never repeats the input');
  assert.equal(run(paid, {}).stdout, '', 'no budget set: silent');
  assert.equal(run(paid, { CLAUDE_PLUGIN_OPTION_SESSION_BUDGET: '100' }).stdout, '', 'inside the budget: silent');
  assert.equal(run('not json', { CLAUDE_PLUGIN_OPTION_SESSION_BUDGET: '10' }).status, 0, 'a broken payload never blocks a call');
});

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

test('review: a server error in a file run reaches the tool as the server sent it, not rebuilt from the exit code', async () => {
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { list } = await import('../plugins/agentic-id/server/lib/list.mjs');
  const { AgenticIdError } = await import('../plugins/agentic-id/server/lib/client.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'aid-list-err-'));
  const file = join(dir, 'leads.csv');
  writeFileSync(file, 'email,company\njane@acme.io,Acme\njoe@acme.io,Acme\n');
  // Out of credits part way: before, this came back as cap_required, "Not sent", "call again with max_credits".
  const broke = fake({ validate: () => { throw new AgenticIdError(402, 'credits.insufficient', 'Not enough credits.', { available: 0, request_id: 'req_42' }); } });
  await assert.rejects(() => list(broke, { action: 'validate', file, max_credits: 5 }), (e) => {
    assert.equal(e.status, 402);
    assert.equal(e.code, 'credits.insufficient');
    assert.notEqual(e.local, true, 'it was sent: earlier batches may have been charged');
    assert.equal(e.toJSON().available_credits, 0);
    assert.doesNotMatch(e.fix ?? '', /max_credits/, 'the advice is not "call again with a cap"');
    return true;
  });
  // A refused key: before, status 0, read as "Agentic ID did not answer".
  const refused = fake({ validate: () => { throw new AgenticIdError(401, 'auth.invalid_key', 'The key was refused.'); } });
  await assert.rejects(() => list(refused, { action: 'validate', file, max_credits: 5 }), (e) => e.status === 401 && e.code === 'auth.invalid_key');
  // A refusal made on this machine keeps its tool-worded message.
  await assert.rejects(() => list(fake({}), { action: 'validate', file }), (e) => e.code === 'cap_required' && e.local === true && /dry_run/.test(e.fix));
});

// ------------------------------------------------------------------ Vicky's test report (0.5.2)
// One test per item that is code. Synthetic data only.
const { shieldReply, shieldProblem, isSourceFailure, leaksSource } = await import('../plugins/agentic-id/server/lib/shield.mjs');
const { companyNameProblem } = await import('../plugins/agentic-id/server/lib/guards.mjs');
const { decodeText, sniffDelimiter, FORMULA_START } = await import('../plugins/agentic-id/server/lib/csv.mjs');

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
      const tool = await createServer({ client: c }).callTool({ name: 'agentic_id_validate', arguments: { emails: ['ada@acme-synthetic.com'], max_credits: 1 } });
      assert.equal(tool.isError, true);
      assert.match(tool.content[0].text, /^Agentic ID could not answer: A data source/);
      assert.doesNotMatch(tool.content[0].text, /treg|refused \(402\)/i);
    },
  );
});

test('server address (#3): a typo, a non-Agentic server and a bad URL are not "not signed in"', async () => {
  const env = { AGENTIC_ID_CONFIG_DIR: mkdtempSync(join(tmpdir(), 'aid-probe-')) };
  const typo = await ops.status(new AgenticId({ apiKey: '', baseUrl: 'http://127.0.0.1:9', env }));
  assert.deepEqual([typo.ok, typo.reachable, typo.error], [false, false, 'unreachable']);
  assert.doesNotMatch(`${typo.summary} ${typo.fix}`, /Not signed in|agentic_id_login/);
  assert.match(typo.fix, /server URL/);
  const bad = await ops.status(new AgenticId({ apiKey: '', baseUrl: 'onesource-v3.icustomer', env }));
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

test('list tool (#15): upload a CSV and enrich the people in it, with the result in a new file', async () => {
  const { list } = await import('../plugins/agentic-id/server/lib/list.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'aid-list-enrich-'));
  const file = join(dir, 'people.csv');
  writeFileSync(file, 'First Name,Last Name,Company,Email\nAda,Lovelace,Acme Synthetic,ada@acme-synthetic.com\nBo,Smith,bo@gmail.com,bo@beta-synthetic.com\n,,,\n');
  const c = fake({ enrich: (b) => ({ request_id: 'r', summary: 'ok', cost: { quoted_credits: 4, charged_credits: 4 }, results: (b.contacts ?? [b.contact]).map(() => ({ status: 'enriched', fields: [{ field: 'title', value: 'CTO', level: 'corroborated' }] })) }) });
  const dry = await list(c, { action: 'enrich', file, dry_run: true });
  assert.equal(dry.dry_run, true);
  assert.equal(c.calls.length, 0);
  const done = await list(c, { action: 'enrich', file, max_credits: 4 });
  assert.equal(done.cost.charged_credits, 4);
  assert.doesNotMatch(JSON.stringify(c.calls), /gmail/, 'the personal email typed as a company was not sent');
  const rows = parseCsv(readFileSync(done.out_file, 'utf8')).rows;
  assert.equal(rows.length, 3);
  assert.ok(Object.keys(rows[0]).some((k) => /title/.test(k)), Object.keys(rows[0]).join(','));
});

test('evals: the mock tool list is the server\'s tool list', async () => {
  const { readdirSync } = await import('node:fs');
  const root = new URL('../plugins/agentic-id/evals/', import.meta.url).pathname;
  const want = JSON.stringify({ tools: TOOLS.map(({ run: _r, ...t }) => t) }, null, 2) + '\n';
  const dirs = [join(root, 'mocks/agentic-id'), ...readdirSync(join(root, 'behaviour')).map((d) => join(root, 'behaviour', d, 'mocks/agentic-id'))].filter((d) => (() => { try { return readdirSync(d).includes('_tools.json'); } catch { return false; } })());
  assert.ok(dirs.length >= 1);
  for (const d of dirs) assert.equal(readFileSync(join(d, '_tools.json'), 'utf8'), want, d);
  for (const d of dirs) for (const f of readdirSync(d).filter((n) => n.endsWith('.md'))) assert.equal(leaksSource(readFileSync(join(d, f), 'utf8').replace(/"source": "provider"/g, '')), false, `${d}/${f}`);
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
