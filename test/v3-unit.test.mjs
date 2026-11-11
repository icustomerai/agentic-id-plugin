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
  return { calls, apiKey: 'k', baseUrl: 'http://fake', validate: verb('validate'), resolve: verb('resolve'), enrich: verb('enrich'), find: verb('find'), discover: verb('discover'), lookalike: verb('lookalike'), facts: verb('facts'), ledger: verb('ledger'), me: verb('me') };
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
  assert.deepEqual(a.rows, [{ Name: 'Doe, Jane', Note: 'said "hi"\nthen left' }, { Name: 'Bob', Note: 'x' }]);
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
  assert.deepEqual(c.calls.map((x) => [x.body.emails.length, x.body.max_credits]), [[1000, 1500], [1000, 500]]);
  assert.equal(r.cost.charged_credits, 1500);
  assert.match(r.input_notes.at(-1), /cap was reached/);
});

test('resolve: cleaned, capped at 1, and refused locally when it cannot work', async () => {
  const c = fake({ resolve: { request_id: 'r', summary: 'known', cost: { quoted_credits: 1, charged_credits: 0 }, id: 'os_abc123', outcome: 'known' } });
  const r = await ops.resolve(c, { identifiers: { email: 'JANE@Acme.io', company_domain: 'https://acme.io/x', phone: '+1 555 0100' } });
  assert.deepEqual(c.calls[0].body, { identifiers: { email: 'jane@acme.io', company_domain: 'acme.io' }, max_credits: 1 });
  assert.match(r.input_notes[0], /phone was not sent/);
  assert.equal((await refused(() => ops.resolve(c, { identifiers: { email: 'x@gmail.com' } }))).code, 'nothing_to_resolve');
  assert.equal((await refused(() => ops.resolve(c, { identifiers: { name: 'John Smith' } }))).code, 'name_alone');
  assert.equal(c.calls.length, 1, 'refusals never reach the API');
});

test('resolve_many: repeats paid once, duplicates grouped, personal rows skipped, cap honoured', async () => {
  const ids = { 'jane@acme.io': 'os_jane00', 'https://www.linkedin.com/in/jane-doe': 'os_jane00', 'bob@acme.io': 'os_bob000' };
  const c = fake({ resolve: (b) => ({ request_id: 'r', summary: '', cost: { quoted_credits: 1, charged_credits: 1 }, id: ids[b.identifiers.email ?? b.identifiers.linkedin_url], outcome: 'known' }) });
  const r = await ops.resolveMany(c, { records: [{ email: 'jane@acme.io' }, { email: 'Jane@Acme.io' }, { linkedin_url: 'linkedin.com/in/Jane-Doe?x=1' }, { email: 'bob@acme.io' }, { email: 'me@gmail.com' }], max_credits: 10 });
  assert.equal(c.calls.length, 3);
  assert.equal(r.cost.charged_credits, 3);
  assert.deepEqual(r.rows.map((x) => x.outcome), ['known', 'known', 'known', 'known', 'skipped']);
  assert.equal(r.rows[1].repeat_of_row, 1);
  assert.deepEqual(r.same_id, [{ id: 'os_jane00', rows: [1, 2, 3] }]);

  const tight = fake({ resolve: () => ({ cost: { quoted_credits: 1, charged_credits: 1 }, id: 'os_x00000', outcome: 'new' }) });
  const t = await ops.resolveMany(tight, { records: Array.from({ length: 6 }, (_, i) => ({ email: `p${i}@acme.io` })), max_credits: 2 }, { concurrency: 1 });
  assert.equal(tight.calls.length, 2);
  assert.equal(t.counts.not_run, 4);
  assert.equal(t.stopped.error, 'cap_reached');
});

test('resolve_many: a bad row fails alone; no credits or an outage stops the run', async () => {
  const c = fake({ resolve: (b) => { if (b.identifiers.email === 'bad@acme.io') throw new AgenticIdError(400, 'request.invalid', 'nope'); return { cost: { quoted_credits: 1, charged_credits: 1 }, id: 'os_ok0000', outcome: 'new' }; } });
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
  await ops.facts(c, { id: ' os_1VcQFNN5zwWguwAUaHEBNk ' });
  assert.equal(c.calls[0].body, 'os_1VcQFNN5zwWguwAUaHEBNk');
});

test('status never throws: no key, a bad key and an outage each say what to do', async () => {
  assert.match((await ops.status({ baseUrl: 'http://x', apiKey: undefined })).fix, /plugin options/);
  const bad = await ops.status({ baseUrl: 'http://x', apiKey: 'k', me: async () => { throw new AgenticIdError(401, 'auth.invalid_key', 'bad key'); } });
  assert.equal(bad.ok, false);
  assert.equal(bad.error, 'auth.invalid_key');
  const ok = await ops.status({ baseUrl: 'http://x', apiKey: 'k', me: async () => ({ workspace_id: 'ws_1', scopes: ['pii:read'], key_prefix: 'os_dev_abc' }) });
  assert.equal(ok.contact_values, 'readable');
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

test('client: Bearer key, problem details become a refusal with a fix', async () => {
  await withApi(
    (req, res) => (req.url === '/v1/me' ? json(res, 200, { workspace_id: 'ws_1', scopes: [], key_prefix: 'os_dev_x' }) : json(res, 402, { code: 'credits.insufficient', detail: 'Not enough credits.', available: 3 })),
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
  assert.equal((await refused(() => new AgenticId({ apiKey: '', baseUrl: 'http://127.0.0.1:9' }).me())).code, 'auth.missing_key');
  assert.equal((await refused(() => new AgenticId({ apiKey: 'k', baseUrl: 'http://127.0.0.1:9' }).resolve({}))).code, 'unreachable');
  await withApi(
    () => {},
    async (baseUrl) => assert.equal((await refused(() => new AgenticId({ apiKey: 'k', baseUrl, timeoutMs: 80 }).discover({}))).code, 'timeout'),
  );
});

test('client: an unset plugin option is not mistaken for a key or a URL', () => {
  assert.equal(keyFromEnv({ AGENTIC_ID_API_KEY: '${user_config.api_key}' }), undefined);
  assert.equal(keyFromEnv({ AGENTIC_ID_API_KEY: '  ' }), undefined);
  assert.equal(urlFromEnv({ AGENTIC_ID_URL: '${user_config.api_url}' }), 'http://127.0.0.1:3100');
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
  const c = fake({ me: { workspace_id: 'ws_1', scopes: [], key_prefix: 'os_dev_x' } });
  const s = createServer({ client: c });
  const e = (await rpc(s, 'tools/call', { name: 'agentic_id_estimate', arguments: { tool: 'agentic_id_find', arguments: { limit: 10 } } })).result.structuredContent;
  assert.deepEqual([e.max_credits, e.auto_capped], [20, false]);
  assert.equal(c.calls.length, 0);
  assert.match((await rpc(s, 'tools/call', { name: 'agentic_id_status', arguments: {} })).result.structuredContent.contact_values, /masked/);
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
  assert.equal((await cli(['validate', '--file', file], client)).code, 1, 'a file run without --max-credits is refused');
  assert.equal(client.calls.length, 0);
  assert.match((await cli(['validate', '--file', file, '--dry-run'], client)).err, /4 with an email\. At most 4 credits/);
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
  const ids = { 'jane@acme.io': 'os_jane00', 'https://www.linkedin.com/in/jane-doe': 'os_jane00', 'bob@acme.io': 'os_bob000' };
  const client = fake({
    resolve: (b) => ({ cost: { quoted_credits: 1, charged_credits: 1 }, id: ids[b.identifiers.email ?? b.identifiers.linkedin_url], outcome: 'known' }),
    enrich: (b) => ({ request_id: 'r', summary: '3 enriched. 6 credits charged.', cost: { quoted_credits: 6, charged_credits: 6 }, results: b.contacts.map((c2, i) => ({ id: `os_p${i}0000`, status: 'enriched', reason: '', fields: [{ field: 'title', value: `Title ${i}`, level: i ? 'claimed' : 'verified', source: 's' }] })) }),
  });
  const r = await cli(['resolve', '--file', file, '--max-credits', '10'], client);
  const rows = parseCsv(r.out).rows;
  assert.deepEqual(rows.map((x) => [x.agentic_id, x.same_id_as_row]), [['os_jane00', ''], ['os_jane00', '1'], ['os_bob000', '']]);
  assert.match(r.err, /2 distinct IDs, 1 duplicate rows/);
  const e = await cli(['enrich', '--file', file, '--fields', 'title', '--max-credits', '10'], client);
  assert.deepEqual(parseCsv(e.out).rows.map((x) => [x.os_title, x.os_title_level]), [['Title 0', 'verified'], ['Title 1', 'claimed'], ['Title 2', 'claimed']]);
  assert.equal((await cli(['find', '--file', file, '--max-credits', '1'], client)).code, 1);
  assert.match((await cli(['validate', '--file', join(dir, 'missing.csv'), '--max-credits', '1'], client)).err, /No such file/);
});
