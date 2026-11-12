// Sign in with an iCustomer account from a terminal, so no API key has to be stored.
//
// OAuth 2.1 authorization code with PKCE, a dynamically registered public client (RFC 7591) and a
// loopback redirect (RFC 8252): the same flow Claude Code runs against a remote MCP server. The
// session (a 1-hour access token and a rotating 30-day refresh token) is kept in
// ~/.agentic-id/session.json, readable by the user only, one entry per server URL.
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const LOGIN_TIMEOUT_MS = 5 * 60_000;
// Refresh a little before the hour is up, so a long batch never starts with a dying token.
export const REFRESH_SKEW_MS = 60_000;

export class AuthError extends Error {
  constructor(code, message, fix) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
    this.fix = fix;
  }
  toJSON() {
    return { error: this.code, message: this.message, ...(this.fix ? { fix: this.fix } : {}) };
  }
}

const configDir = (env = process.env) => env.AGENTIC_ID_CONFIG_DIR?.trim() || join(homedir(), '.agentic-id');
const sessionFile = (env) => join(configDir(env), 'session.json');
const keyOf = (baseUrl) => baseUrl.replace(/\/+$/, '').toLowerCase();

function readAll(env) {
  try {
    const parsed = JSON.parse(readFileSync(sessionFile(env), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeAll(all, env) {
  const dir = configDir(env);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = sessionFile(env);
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(all, null, 2), { mode: 0o600 });
  renameSync(tmp, file); // atomic: a reader never sees half a file
  chmodSync(file, 0o600);
}

/** The stored session for a server, or undefined. Never logged. */
export function loadSession(baseUrl, env = process.env) {
  const s = readAll(env)[keyOf(baseUrl)];
  return s?.refresh_token ? s : undefined;
}

function saveSession(baseUrl, session, env) {
  const all = readAll(env);
  all[keyOf(baseUrl)] = session;
  writeAll(all, env);
}

export function clearSession(baseUrl, env = process.env) {
  const all = readAll(env);
  if (!(keyOf(baseUrl) in all)) return false;
  // Keep the registered client: the next login reuses it.
  all[keyOf(baseUrl)] = { client_id: all[keyOf(baseUrl)].client_id };
  writeAll(all, env);
  return true;
}

export function pkcePair() {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

async function json(fetchImpl, url, init, step) {
  let res;
  try {
    res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(30_000) });
  } catch (e) {
    throw new AuthError('unreachable', `Could not reach ${new URL(url).origin} during ${step}: ${e?.cause?.code ?? e?.message}.`, 'Check the server URL (AGENTIC_ID_URL or the plugin option) and your network.');
  }
  const body = await res.json().catch(() => ({}));
  return { res, body };
}

export async function discover(baseUrl, fetchImpl = fetch) {
  const { res, body } = await json(fetchImpl, `${baseUrl}/.well-known/oauth-authorization-server`, { headers: { accept: 'application/json' } }, 'discovery');
  if (res.status === 404) throw new AuthError('signin_unavailable', `${baseUrl} does not offer sign-in.`, 'Use an API key instead: set it in the plugin options or AGENTIC_ID_API_KEY.');
  if (!res.ok || !body.authorization_endpoint || !body.token_endpoint) throw new AuthError('signin_unavailable', `Sign-in discovery failed (${res.status}).`, 'Try again, or use an API key.');
  // Every endpoint must live on the server we asked: a metadata document cannot send tokens elsewhere.
  for (const k of ['authorization_endpoint', 'token_endpoint', 'registration_endpoint', 'revocation_endpoint']) {
    if (body[k] && new URL(body[k]).origin !== new URL(baseUrl).origin) throw new AuthError('signin_unavailable', `Sign-in metadata points ${k} at another host.`, 'Do not sign in; report this.');
  }
  return body;
}

function openBrowser(url) {
  const [cmd, args] = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url.replace(/&/g, '^&')]] : ['xdg-open', [url]];
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
    return true;
  } catch {
    return false;
  }
}

const PAGE = (title, line) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Agentic ID</title></head><body style="font-family:system-ui;max-width:32rem;margin:15vh auto;padding:0 1rem"><h1 style="font-size:1.4rem">${title}</h1><p>${line}</p></body></html>`;

/**
 * Opens the browser, waits for the redirect, and stores the session.
 * `io.out` gets the lines a person should see (the URL to open when no browser could be started).
 */
export async function login({ baseUrl, env = process.env, fetchImpl = fetch, io = { out: () => {} }, open = openBrowser, timeoutMs = LOGIN_TIMEOUT_MS } = {}) {
  const meta = await discover(baseUrl, fetchImpl);
  const stored = readAll(env)[keyOf(baseUrl)] ?? {};
  let clientId = stored.client_id;
  if (!clientId) {
    if (!meta.registration_endpoint) throw new AuthError('signin_unavailable', 'The server does not register clients.', 'Use an API key.');
    const { res, body } = await json(fetchImpl, meta.registration_endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Agentic ID plugin (CLI)', redirect_uris: ['http://127.0.0.1/callback'] }) }, 'client registration');
    if (!res.ok || !body.client_id) throw new AuthError('signin_failed', `Client registration failed (${body.error ?? res.status}).`, 'Run "agentic-id login" again.');
    clientId = body.client_id;
    // Kept at once, so a sign-in that is never finished does not register a new client next time.
    saveSession(baseUrl, { ...stored, client_id: clientId }, env);
  }

  const { verifier, challenge } = pkcePair();
  const state = randomBytes(16).toString('base64url');
  let finish;
  const done = new Promise((resolve, reject) => (finish = { resolve, reject }));
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname !== '/callback') return void res.writeHead(404).end();
    res.setHeader('content-type', 'text/html; charset=utf-8');
    if (url.searchParams.get('state') !== state) {
      res.writeHead(400).end(PAGE('Sign-in was not completed', 'This page did not come from the sign-in you started. Close it and run the command again.'));
      return;
    }
    const error = url.searchParams.get('error');
    const code = url.searchParams.get('code');
    if (error || !code) {
      res.writeHead(400).end(PAGE('Sign-in was not completed', 'Go back to your terminal for details.'));
      finish.reject(new AuthError(error === 'access_denied' ? 'access_denied' : 'signin_failed', error === 'access_denied' ? 'This account may not use Agentic ID, or its email is not verified.' : `Sign-in failed (${error ?? 'no code'}).`, 'Check the account, then run "agentic-id login" again.'));
      return;
    }
    res.writeHead(200).end(PAGE('You are signed in', 'You can close this tab and go back to your terminal.'));
    finish.resolve(code);
  });
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const redirectUri = `http://127.0.0.1:${server.address().port}/callback`;
  const authorizeUrl = `${meta.authorization_endpoint}?${new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirectUri, code_challenge: challenge, code_challenge_method: 'S256', state, scope: 'agentic-id' })}`;
  const timer = setTimeout(() => finish.reject(new AuthError('signin_timeout', 'No sign-in arrived within 5 minutes.', 'Run "agentic-id login" again.')), timeoutMs);
  try {
    // AGENTIC_ID_NO_BROWSER=1: print the link only (SSH sessions, containers, tests).
    const opened = env.AGENTIC_ID_NO_BROWSER ? false : open(authorizeUrl);
    io.out(opened ? 'Opening your browser to sign in. If nothing opens, use this link:' : 'Open this link to sign in:');
    io.out(authorizeUrl);
    const code = await done;
    const { res, body } = await json(fetchImpl, meta.token_endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: clientId, redirect_uri: redirectUri, code_verifier: verifier }).toString() }, 'code exchange');
    if (!res.ok || !body.access_token) throw new AuthError('signin_failed', `Sign-in failed at code exchange (${body.error ?? res.status}).`, 'Run "agentic-id login" again.');
    const session = { client_id: clientId, access_token: body.access_token, refresh_token: body.refresh_token, expires_at: Date.now() + Number(body.expires_in ?? 3600) * 1000 };
    saveSession(baseUrl, session, env);
    return session;
  } finally {
    clearTimeout(timer);
    server.close();
    server.closeAllConnections?.();
  }
}

// One renewal at a time, in this process and across processes. It matters: the server ends the
// whole sign-in when a refresh token is presented twice, so two commands renewing at the same
// moment would sign the user out.
const refreshing = new Map();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LOCK_STALE_MS = 30_000;

async function withRenewalLock(env, fn) {
  const dir = configDir(env);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const lock = join(dir, 'session.lock');
  const deadline = Date.now() + 20_000;
  for (;;) {
    try {
      closeSync(openSync(lock, 'wx', 0o600)); // fails if another process holds it
      break;
    } catch (e) {
      if (e?.code !== 'EEXIST') break; // cannot lock here (read-only folder): go on without it
      try {
        if (Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS) unlinkSync(lock); // its holder died
      } catch {
        /* gone already */
      }
      if (Date.now() > deadline) break;
      await sleep(100 + Math.floor(Math.random() * 150));
    }
  }
  try {
    return await fn();
  } finally {
    try {
      unlinkSync(lock);
    } catch {
      /* already removed */
    }
  }
}

/** A usable access token for this server, renewed when it is about to run out; undefined when signed out. */
export async function accessToken(baseUrl, { env = process.env, fetchImpl = fetch, force = false } = {}) {
  const session = loadSession(baseUrl, env);
  if (!session) return undefined;
  if (!force && session.access_token && session.expires_at - Date.now() > REFRESH_SKEW_MS) return session.access_token;
  const k = keyOf(baseUrl);
  if (!refreshing.has(k)) {
    refreshing.set(
      k,
      withRenewalLock(env, async () => {
        // Whoever held the lock before us may already have renewed: use theirs, spend nothing.
        const latest = loadSession(baseUrl, env);
        if (!latest) return undefined;
        const renewedByAnother = latest.refresh_token !== session.refresh_token;
        if (latest.access_token && latest.expires_at - Date.now() > REFRESH_SKEW_MS && (renewedByAnother || !force)) return latest.access_token;
        const meta = await discover(baseUrl, fetchImpl);
        const { res, body } = await json(fetchImpl, meta.token_endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: latest.refresh_token, client_id: latest.client_id }).toString() }, 'refresh');
        if (res.status === 400 || res.status === 401) {
          // Refused. If the stored session changed while we asked, someone else renewed: keep theirs.
          const now = loadSession(baseUrl, env);
          if (now && now.refresh_token !== latest.refresh_token && now.expires_at - Date.now() > REFRESH_SKEW_MS) return now.access_token;
          clearSession(baseUrl, env);
          throw new AuthError('signed_out', 'Your sign-in has ended.', 'Sign in again: `agentic-id login`, or ask Claude to sign you in.');
        }
        if (!res.ok || !body.access_token) throw new AuthError('refresh_failed', `Could not renew the sign-in (${body.error ?? res.status}).`, 'Try again in a minute. The sign-in is still stored.');
        saveSession(baseUrl, { client_id: latest.client_id, access_token: body.access_token, refresh_token: body.refresh_token ?? latest.refresh_token, expires_at: Date.now() + Number(body.expires_in ?? 3600) * 1000 }, env);
        return body.access_token;
      }).finally(() => refreshing.delete(k)),
    );
  }
  return refreshing.get(k);
}

/** Ends the sign-in on the server and forgets it here. */
export async function logout(baseUrl, { env = process.env, fetchImpl = fetch } = {}) {
  const session = loadSession(baseUrl, env);
  if (!session) return false;
  try {
    const meta = await discover(baseUrl, fetchImpl);
    if (meta.revocation_endpoint) await json(fetchImpl, meta.revocation_endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: session.refresh_token }).toString() }, 'revoke');
  } catch {
    /* forgetting it locally is what matters; the tokens expire on their own */
  }
  clearSession(baseUrl, env);
  return true;
}

export const hasSession = (baseUrl, env = process.env) => Boolean(loadSession(baseUrl, env)) && existsSync(sessionFile(env));
