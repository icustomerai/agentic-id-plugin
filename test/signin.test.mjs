// Sign-in from the plugin, against an in-process stand-in for the API's OAuth endpoints.
//   node --test test/signin.test.mjs
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { accessToken, AuthError, discover, loadSession, login, logout } from '../cli/lib/auth.mjs';
import { AgenticId, AgenticIdError } from '../cli/lib/client.mjs';
import * as ops from '../cli/lib/operations.mjs';

/** A tiny authorization server + /v1/me. `state` lets a test break things on purpose. */
async function fakeApi(state = {}) {
  const codes = new Map(); // code -> { challenge, redirect }
  const access = new Set();
  const refresh = new Set();
  const calls = { register: 0, token: 0, refresh: 0, revoke: 0, me: 0 };
  const issue = () => {
    const a = `ic-at-${randomBytes(12).toString('hex')}`;
    const r = `ic-rt-${randomBytes(12).toString('hex')}`;
    access.add(a);
    refresh.add(r);
    return { access_token: a, refresh_token: r, expires_in: state.expiresIn ?? 3600, token_type: 'Bearer' };
  };
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const base = `http://127.0.0.1:${server.address().port}`;
    const send = (status, body) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
    let raw = '';
    req.on('data', (d) => (raw += d)).on('end', () => {
      const form = new URLSearchParams(raw);
      if (url.pathname === '/.well-known/oauth-authorization-server') {
        if (state.noSignIn) return send(404, {});
        return send(200, { issuer: base, authorization_endpoint: `${base}/oauth/authorize`, token_endpoint: `${state.evilToken ?? base}/oauth/token`, registration_endpoint: `${base}/oauth/register`, revocation_endpoint: `${base}/oauth/revoke` });
      }
      if (url.pathname === '/oauth/register') return (calls.register += 1), send(201, { client_id: 'ic-client-test' });
      if (url.pathname === '/oauth/authorize') {
        const code = randomBytes(8).toString('hex');
        codes.set(code, { challenge: url.searchParams.get('code_challenge'), redirect: url.searchParams.get('redirect_uri') });
        const back = new URL(url.searchParams.get('redirect_uri'));
        if (state.deny) back.searchParams.set('error', 'access_denied');
        else back.searchParams.set('code', code);
        back.searchParams.set('state', state.wrongState ? 'not-yours' : url.searchParams.get('state'));
        return res.writeHead(302, { location: back.toString() }).end();
      }
      if (url.pathname === '/oauth/token') {
        if (form.get('grant_type') === 'authorization_code') {
          calls.token += 1;
          const c = codes.get(form.get('code'));
          codes.delete(form.get('code'));
          const ok = c && c.redirect === form.get('redirect_uri') && c.challenge === createHash('sha256').update(form.get('code_verifier') ?? '').digest('base64url');
          return ok ? send(200, issue()) : send(400, { error: 'invalid_grant' });
        }
        calls.refresh += 1;
        if (state.refreshDown) return send(503, { error: 'temporarily_unavailable' });
        if (!refresh.delete(form.get('refresh_token'))) return send(400, { error: 'invalid_grant' });
        return send(200, issue());
      }
      if (url.pathname === '/oauth/revoke') return (calls.revoke += 1), refresh.delete(form.get('token')), send(200, {});
      if (url.pathname === '/v1/me') {
        calls.me += 1;
        const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
        return access.has(token) ? send(200, { workspace_id: 'ws_u_abc', scopes: [], key_prefix: 'oauth:abc' }) : send(401, { code: 'auth.invalid_key', detail: 'no' });
      }
      send(404, {});
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { base: `http://127.0.0.1:${server.address().port}`, calls, access, close: () => server.close() };
}

const env = () => ({ AGENTIC_ID_CONFIG_DIR: mkdtempSync(join(tmpdir(), 'aid-signin-')) });
// Stands in for the browser: follows the authorize redirect to the CLI's loopback callback.
const browser = (url) => (void fetch(url).catch(() => {}), true);

test('login stores a session readable by the user only, and the client then needs no key', async () => {
  const api = await fakeApi();
  const e = env();
  const lines = [];
  const session = await login({ baseUrl: api.base, env: e, open: browser, io: { out: (l) => lines.push(l) } });
  assert.match(session.access_token, /^ic-at-/);
  const file = join(e.AGENTIC_ID_CONFIG_DIR, 'session.json');
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.ok(lines.some((l) => l.includes('/oauth/authorize?')), 'prints the link for when no browser opens');
  const client = new AgenticId({ baseUrl: api.base, apiKey: '', env: e });
  assert.equal(client.authMode, 'signin');
  const s = await ops.status(client);
  assert.equal(s.ok, true);
  assert.equal(s.auth, 'signin');
  assert.match(s.summary, /signed in/);
  assert.ok(!JSON.stringify(s).includes(session.access_token), 'status never shows the token');
  // The second login reuses the registered client.
  await login({ baseUrl: api.base, env: e, open: browser });
  assert.equal(api.calls.register, 1);
  api.close();
});

test('a token about to run out is renewed once, even when two calls start together', async () => {
  const api = await fakeApi({ expiresIn: 30 });
  const e = env();
  const first = await login({ baseUrl: api.base, env: e, open: browser });
  const [a, b] = await Promise.all([accessToken(api.base, { env: e }), accessToken(api.base, { env: e })]);
  assert.equal(a, b);
  assert.notEqual(a, first.access_token);
  assert.equal(api.calls.refresh, 1);
  api.close();
});

test('a 401 on a signed-in call renews the sign-in and sends the call once more', async () => {
  const api = await fakeApi();
  const e = env();
  const s = await login({ baseUrl: api.base, env: e, open: browser });
  api.access.delete(s.access_token); // the server forgot the access token; the refresh token still works
  const me = await new AgenticId({ baseUrl: api.base, apiKey: '', env: e }).me();
  assert.equal(me.workspace_id, 'ws_u_abc');
  assert.equal(api.calls.refresh, 1);
  assert.equal(api.calls.me, 2);
  api.close();
});

test('a refused refresh signs out and says to log in again', async () => {
  const api = await fakeApi({ expiresIn: 30 });
  const e = env();
  await login({ baseUrl: api.base, env: e, open: browser });
  const file = join(e.AGENTIC_ID_CONFIG_DIR, 'session.json');
  const all = JSON.parse(readFileSync(file, 'utf8'));
  all[Object.keys(all)[0]].refresh_token = 'ic-rt-revoked';
  writeFileSync(file, JSON.stringify(all));
  await assert.rejects(accessToken(api.base, { env: e }), (err) => err instanceof AuthError && err.code === 'signed_out');
  assert.equal(loadSession(api.base, e), undefined, 'the dead session is forgotten');
  const client = new AgenticId({ baseUrl: api.base, apiKey: '', env: e });
  await assert.rejects(client.me(), (err) => err instanceof AgenticIdError && err.code === 'auth.missing_key' && /agentic-id login/.test(err.fix));
  api.close();
});

test('when the server cannot renew right now, the sign-in is kept for a retry', async () => {
  const state = { expiresIn: 30 };
  const api = await fakeApi(state);
  const e = env();
  await login({ baseUrl: api.base, env: e, open: browser });
  state.refreshDown = true;
  await assert.rejects(accessToken(api.base, { env: e }), (err) => err instanceof AuthError && err.code === 'refresh_failed');
  assert.ok(loadSession(api.base, e), 'still signed in');
  state.refreshDown = false;
  assert.match(await accessToken(api.base, { env: e }), /^ic-at-/);
  api.close();
});

test('logout revokes on the server and forgets the session, keeping the registered client', async () => {
  const api = await fakeApi();
  const e = env();
  await login({ baseUrl: api.base, env: e, open: browser });
  assert.equal(await logout(api.base, { env: e }), true);
  assert.equal(api.calls.revoke, 1);
  assert.equal(loadSession(api.base, e), undefined);
  assert.equal(await logout(api.base, { env: e }), false);
  await login({ baseUrl: api.base, env: e, open: browser });
  assert.equal(api.calls.register, 1);
  api.close();
});

test('sign-in refuses a server without it, metadata that points elsewhere, a denied account and a foreign redirect', async () => {
  const none = await fakeApi({ noSignIn: true });
  await assert.rejects(discover(none.base), (err) => err.code === 'signin_unavailable' && /API key/.test(err.fix));
  none.close();
  const evil = await fakeApi({ evilToken: 'http://127.0.0.1:9' });
  await assert.rejects(login({ baseUrl: evil.base, env: env(), open: browser }), (err) => err.code === 'signin_unavailable' && /another host/.test(err.message));
  evil.close();
  const denied = await fakeApi({ deny: true });
  await assert.rejects(login({ baseUrl: denied.base, env: env(), open: browser }), (err) => err.code === 'access_denied');
  denied.close();
  const foreign = await fakeApi({ wrongState: true });
  await assert.rejects(login({ baseUrl: foreign.base, env: env(), open: browser, timeoutMs: 600 }), (err) => err.code === 'signin_timeout');
  foreign.close();
});

test('an API key, when set, is used instead of a stored sign-in', async () => {
  const api = await fakeApi();
  const e = env();
  await login({ baseUrl: api.base, env: e, open: browser });
  const client = new AgenticId({ baseUrl: api.base, apiKey: 'ic-dev-notreal', env: e });
  assert.equal(client.authMode, 'key');
  assert.equal(await client.credential(), 'ic-dev-notreal');
  api.close();
});
