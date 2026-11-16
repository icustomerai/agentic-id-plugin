// The Agentic ID client: one method per verb of the V3 public API (/v1/*). No dependencies.
//
//   const id = new AgenticId({ apiKey, baseUrl });
//   const { id: agenticId } = await id.resolve({ identifiers: { company_domain: 'acme.io' } });
//
// Failures throw AgenticIdError with the problem details the API sent (status, code, detail) and a
// plain "fix" line that says what to do next.
import { randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { accessToken, AuthError, hasSession } from './auth.mjs';
import { isSourceFailure, shieldProblem, shieldReply, SOURCE_DOWN, SOURCE_FIX } from './shield.mjs';

// The hosted Agentic ID service. A local V3 stack is http://127.0.0.1:3100: set it in the plugin
// options or as AGENTIC_ID_URL.
export const DEFAULT_URL = 'https://onesource-v3.icustomer.ai';
export const CLIENT = 'agentic-id-plugin/0.6.0';

const FIXES = {
  'auth.invalid_key': 'Sign the user in now: call agentic_id_login (it opens the browser and returns a link); in a terminal, `agentic-id login`. Or they set a valid API key in the plugin options. Never ask for a key in the chat.',
  'auth.missing_key': 'Sign the user in now: call agentic_id_login (it opens the browser and returns a link); in a terminal, `agentic-id login`. Or they set an API key in the plugin options. Never ask for a key in the chat.',
  'auth.token_expired': 'The sign-in has run out. Call agentic_id_login to sign in again (terminal: `agentic-id login`).',
  signed_out: 'Call agentic_id_login to sign in again (terminal: `agentic-id login`).',
  'credits.insufficient': 'The wallet cannot cover this call. Stop and tell the user; do not retry or raise the cap.',
  'credits.cap_too_low': 'max_credits is below the cheapest result. Ask the user before raising it.',
  rate_limited: 'Too many requests for this key. Wait for retry_after_seconds, then send the same call once.',
  'id.not_held': 'Facts and history are shown only for IDs this workspace holds. Resolve, enrich, find or discover it first; an ID copied from elsewhere will not open.',
  'feedback.not_held': 'Outcomes can only be reported for IDs this workspace holds. Resolve or enrich the person first, then report.',
  'request.invalid': 'Fix the fields listed in "issues" and call again. Nothing was charged.',
  'find.persona_unreadable': 'Give at least one job title in roles, or a seniority (e.g. "director+").',
  'lookalike.no_profile': 'No shared profile could be built from these seeds. Check each seed is a company domain that resolves (try agentic_id_resolve on one); use 3 or more of a similar kind. If well-known companies fail this way, the data behind them is unavailable right now: try again later rather than changing the seeds.',
  'purpose.not_allowed': 'This purpose is not allowed for this data. Use b2b_outbound for outbound work, ad_audience for match.',
  'purpose.mismatch': 'The data was collected for a different purpose and cannot be reused for this one.',
  'pii.scope_required': 'This key cannot read contact values; they come back masked. Ask the workspace owner for a key with pii:read.',
  'identity.merge_blocked': 'These two records disagree on a strong identifier, so they were not merged. Review them; do not force it.',
  'service.unavailable': 'Agentic ID is not taking requests right now. Wait for retry_after_seconds and try again; nothing was charged.',
  'service.timeout': 'The call may have completed. Check the usage log or the result before sending it again.',
  'service.error': 'Agentic ID hit a fault. Try once more; if it repeats, report the request_id.',
  'idempotency.in_progress': 'The same request is still running. Wait, then ask again; it is not charged twice.',
  'idempotency.key_reused': 'Internal: a retry key was reused for a different request. Send the call again.',
  unreachable: 'Nothing answered at this server address, so this is not a sign-in problem. Check the server URL in the plugin options (api_url) or AGENTIC_ID_URL for a typo, or clear it to use the hosted service; then run `agentic-id doctor`.',
  not_agentic_id: 'Something answered at this address, but it is not an Agentic ID server. Check the server URL in the plugin options (api_url) or AGENTIC_ID_URL, or clear it to use the hosted service.',
  bad_url: 'The server address must be a full web address such as https://onesource-v3.icustomer.ai. Fix it in the plugin options (api_url) or AGENTIC_ID_URL, or clear it to use the hosted service.',
  'source.unavailable': SOURCE_FIX,
  timeout: 'The call took too long. Discover and lookalike can take minutes: narrow the filters or lower max_accounts, then retry once.',
};

export class AgenticIdError extends Error {
  constructor(status, code, detail, problem = {}) {
    super(`${status || 'network'}${code ? ` ${code}` : ''}: ${detail}`);
    this.name = 'AgenticIdError';
    this.status = status;
    this.code = code;
    this.detail = detail;
    this.problem = problem;
    this.fix = FIXES[code] ?? (status === 402 ? FIXES['credits.insufficient'] : status === 401 ? FIXES['auth.invalid_key'] : status >= 500 ? FIXES['service.unavailable'] : undefined);
  }

  /** The shape tools and the CLI print: { error, message, fix, ... }. Never includes the request body. */
  toJSON() {
    const { issues, rejected, retryAfterSeconds, available, request_id: requestId } = this.problem;
    return {
      error: this.code ?? `http_${this.status}`,
      status: this.status,
      message: this.detail,
      ...(this.fix ? { fix: this.fix } : {}),
      ...(issues ? { issues } : {}),
      ...(Array.isArray(rejected) && rejected.length ? { rejected } : {}),
      ...(typeof retryAfterSeconds === 'number' ? { retry_after_seconds: retryAfterSeconds } : {}),
      ...(typeof available === 'number' ? { available_credits: available } : {}),
      ...(typeof requestId === 'string' ? { request_id: requestId } : {}),
    };
  }
}

/** The key from the environment, or from a file (a line ending in the key) so it never sits in a shell history. */
export function keyFromEnv(env = process.env) {
  // Inside Claude Code the plugin's options are also exported to the commands it runs.
  const direct = (env.AGENTIC_ID_API_KEY ?? env.CLAUDE_PLUGIN_OPTION_API_KEY)?.trim();
  // Claude Code leaves an unset ${user_config.*} reference as an empty string or the literal text.
  if (direct && !direct.startsWith('${')) return direct;
  const file = env.AGENTIC_ID_API_KEY_FILE?.trim();
  if (file) {
    try {
      const last = readFileSync(file, 'utf8').trim().split(/\s+/).pop();
      if (last) return last;
    } catch {
      /* fall through: no key */
    }
  }
  return undefined;
}

const configDir = (env) => env.AGENTIC_ID_CONFIG_DIR?.trim() || join(homedir(), '.agentic-id');

/**
 * Where the API is: the environment or the plugin option when set; else the address the plugin's
 * own server last ran with (Claude Code does not pass plugin options to shell commands, so the
 * `agentic-id` command would otherwise fall back to the default); else the default.
 */
export function urlFromEnv(env = process.env) {
  const u = (env.AGENTIC_ID_URL ?? env.CLAUDE_PLUGIN_OPTION_API_URL)?.trim();
  if (u && !u.startsWith('${')) return u.replace(/\/+$/, '');
  try {
    const saved = JSON.parse(readFileSync(join(configDir(env), 'server.json'), 'utf8')).api_url;
    if (typeof saved === 'string' && /^https?:\/\/[^\s]+$/.test(saved)) return saved.replace(/\/+$/, '');
  } catch {
    /* nothing remembered */
  }
  return DEFAULT_URL;
}

/** Called by the plugin's server on start: the address only, never a credential. */
export function rememberUrl(env = process.env) {
  const u = (env.AGENTIC_ID_URL ?? env.CLAUDE_PLUGIN_OPTION_API_URL)?.trim();
  if (!u || u.startsWith('${')) return false;
  try {
    const dir = configDir(env);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = join(dir, 'server.json');
    writeFileSync(file, JSON.stringify({ api_url: u.replace(/\/+$/, ''), written_by: 'agentic-id plugin server' }), { mode: 0o600 });
    chmodSync(file, 0o600);
    return true;
  } catch {
    return false;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Why a connection failed, in a word: ENOTFOUND (no such host), ECONNREFUSED, a bad URL ... */
const netReason = (e) => {
  const code = e?.cause?.code ?? e?.cause?.errors?.[0]?.code ?? e?.code;
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'no such host: check the address for a typo';
  if (code === 'ECONNREFUSED') return 'connection refused: nothing is listening there';
  if (code === 'ERR_INVALID_URL' || /Invalid URL|Failed to parse URL/i.test(e?.message ?? '')) return 'not a valid web address';
  return code ?? e?.message ?? 'network error';
};

export class AgenticId {
  constructor(opts = {}) {
    this.apiKey = opts.apiKey ?? keyFromEnv();
    this.baseUrl = (opts.baseUrl ?? urlFromEnv()).replace(/\/+$/, '');
    this.timeoutMs = opts.timeoutMs ?? 300_000;
    this.fetch = opts.fetch ?? globalThis.fetch;
    this.maxRetryWaitS = opts.maxRetryWaitS ?? 20;
    this.client = opts.client ?? CLIENT;
    this.env = opts.env ?? process.env;
  }

  /** 'key' when an API key is configured, 'signin' when a sign-in is stored, else undefined. */
  get authMode() {
    return this.apiKey ? 'key' : hasSession(this.baseUrl, this.env) ? 'signin' : undefined;
  }

  /** The bearer credential: the API key when one is set, else the sign-in's access token. */
  async credential(force = false) {
    if (this.apiKey) return this.apiKey;
    try {
      return await accessToken(this.baseUrl, { env: this.env, fetchImpl: this.fetch, force });
    } catch (e) {
      if (e instanceof AuthError) throw new AgenticIdError(e.code === 'unreachable' ? 0 : 401, e.code, e.message);
      throw e;
    }
  }

  async call(method, path, body) {
    let bearer = await this.credential();
    if (!bearer) {
      // A mistyped server address would otherwise read as "not signed in", and signing in cannot fix it.
      const p = await this.probe();
      if (!p.ok) throw new AgenticIdError(0, p.code, p.detail);
      throw new AgenticIdError(401, 'auth.missing_key', 'Not signed in and no Agentic ID API key is configured.');
    }
    let renewed = false;
    // One key for this call and every retry of it: the API runs a keyed request at most once and
    // answers a repeat from the first result, so a timeout or a dropped connection can be retried
    // without paying twice.
    const idempotencyKey = method === 'POST' ? randomUUID() : undefined;
    const started = Date.now();
    for (let attempt = 0; ; attempt += 1) {
      let res;
      try {
        res = await this.fetch(`${this.baseUrl}${path}`, {
          method,
          headers: {
            authorization: `Bearer ${bearer}`,
            accept: 'application/json',
            'user-agent': this.client,
            'x-agentic-id-client': this.client,
            ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
            ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
          },
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (e) {
        const timedOut = e?.name === 'TimeoutError' || e?.name === 'AbortError';
        // A dropped connection is retried once (the key makes that safe for a paid call too).
        // Our own timeout is not: the call ran for minutes and the caller should decide.
        if (!timedOut && attempt === 0) {
          await sleep(300);
          continue;
        }
        throw new AgenticIdError(0, timedOut ? 'timeout' : 'unreachable', timedOut ? `No answer from ${this.baseUrl} within ${Math.round(this.timeoutMs / 1000)}s.` : `Cannot reach the Agentic ID server at ${this.baseUrl} (${netReason(e)}).`);
      }
      const json = await res.json().catch(() => ({}));
      if (res.ok) return shieldReply(json);
      // A 401 is refused before any work, so renewing the sign-in and sending once more is safe.
      if (res.status === 401 && !this.apiKey && !renewed) {
        renewed = true;
        bearer = await this.credential(true);
        if (bearer) continue;
      }
      const wait = Number(res.headers.get('retry-after') ?? json.retryAfterSeconds ?? 1);
      const withinBudget = wait <= this.maxRetryWaitS && Date.now() - started + wait * 1000 < this.timeoutMs;
      // Retried, each at most a few times and only when nothing can be charged twice:
      //   429  refused before any work
      //   503 with sent: false  the API never passed the request on
      //   409 idempotency.in_progress  our own earlier attempt is still running; its answer is coming
      //   504 service.timeout  may have run: the same key returns that result or says it is still running
      const retryable = (res.status === 429 && attempt === 0) || (res.status === 503 && json.sent === false && attempt === 0) || (res.status === 409 && json.code === 'idempotency.in_progress' && attempt < 12) || (res.status === 504 && json.code === 'service.timeout' && idempotencyKey && attempt === 0);
      if (retryable && withinBudget) {
        await sleep(Math.max(wait, 0.2) * 1000);
        continue;
      }
      // A data source's failure or bill is not the user's problem to read: one plain error instead.
      if (isSourceFailure(json.code, json.detail, res.status)) throw new AgenticIdError(503, 'source.unavailable', SOURCE_DOWN, typeof json.request_id === 'string' ? { request_id: json.request_id } : {});
      const problem = shieldProblem({ ...json, detail: String(json.detail ?? res.statusText ?? 'Request failed.') }, { ownWallet: json.code === 'credits.insufficient' });
      const err = new AgenticIdError(res.status, json.code, problem.detail, problem);
      // A refused key blocks a stored sign-in: signing in again cannot help until the key is fixed or removed.
      if (res.status === 401 && this.apiKey) err.fix = `The configured API key was refused. Replace it or remove it in the plugin options (or AGENTIC_ID_API_KEY)${hasSession(this.baseUrl, this.env) ? '; a sign-in is stored and will be used once the key is removed' : ', or remove it and sign in'}. Never paste a key into the chat.`;
      throw err;
    }
  }

  /**
   * Is there an Agentic ID server at baseUrl? Free and unauthenticated: one GET that any Agentic ID
   * server answers with JSON (401 without a credential). Never sends a credential.
   */
  async probe() {
    if (!/^https?:\/\/[^\s/?#]+/i.test(this.baseUrl)) return { ok: false, code: 'bad_url', detail: `"${String(this.baseUrl).slice(0, 80)}" is not a server address: it must start with https://.` };
    let res;
    try {
      res = await this.fetch(`${this.baseUrl}/v1/me`, { method: 'GET', headers: { accept: 'application/json', 'user-agent': this.client }, signal: AbortSignal.timeout(Math.min(this.timeoutMs, 15_000)) });
    } catch (e) {
      const timedOut = e?.name === 'TimeoutError' || e?.name === 'AbortError';
      return { ok: false, code: timedOut ? 'timeout' : 'unreachable', detail: timedOut ? `No answer from ${this.baseUrl} within 15s.` : `Cannot reach the Agentic ID server at ${this.baseUrl} (${netReason(e)}).` };
    }
    const type = res.headers?.get?.('content-type') ?? '';
    if (res.status === 401 || res.status === 403 || /json/i.test(type)) return { ok: true, status: res.status };
    return { ok: false, code: 'not_agentic_id', detail: `${this.baseUrl} answered (HTTP ${res.status}), but not as an Agentic ID server.` };
  }

  /** Is this mailbox real? 1 credit per valid, invalid or catch-all answer; unknown and rejected are free. */
  validate(body) {
    return this.call('POST', '/v1/validate', body);
  }
  /** One stable Agentic ID for a person or company. */
  resolve(body) {
    return this.call('POST', '/v1/resolve', body);
  }
  /** Fill in missing facts; each comes with its level (verified, corroborated, claimed) and source. */
  enrich(body) {
    return this.call('POST', '/v1/enrich', body);
  }
  /** People in a role inside one company. */
  find(body) {
    return this.call('POST', '/v1/find', body);
  }
  /** New companies (and the people in them) that match filters. count_only: true is free. */
  discover(body) {
    return this.call('POST', '/v1/discover', body);
  }
  /** Companies like the seeds, ranked by how alike they are, seeds excluded. */
  lookalike(body) {
    return this.call('POST', '/v1/lookalike', body);
  }
  /** Everything that ever happened to one ID, with the hash chain re-checked. Free. */
  ledger(id) {
    return this.call('GET', `/v1/ledger/${encodeURIComponent(id)}`);
  }
  /** Every fact's level and the evidence behind it. Free. */
  facts(id) {
    return this.call('GET', `/v1/facts/${encodeURIComponent(id)}`);
  }
  /** The workspace: wallet, contribution setting, IDs held. Free. */
  workspace() {
    return this.call('GET', '/v1/workspace');
  }
  /** Balance, spend by tool, and the latest grants and charges. Free. */
  credits(limit = 20) {
    return this.call('GET', `/v1/credits?limit=${encodeURIComponent(limit)}`);
  }
  /** What happened after a value was used: bounced, replied, wrong_person, confirmed. Free. */
  feedback(body) {
    return this.call('POST', '/v1/feedback', body);
  }
  /** Which workspace and scopes this key has. Free. */
  me() {
    return this.call('GET', '/v1/me');
  }
}
