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
export const DEFAULT_URL = 'https://agenticid.icustomer.ai';
export const CLIENT = 'agentic-id-plugin/0.9.0';

/** How long a paid call may take before the server hands it over as a run (Prefer: wait=N, at most 20). */
export const PAID_WAIT_S = 20;
const RUN_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A key prefix as the server shows it: ic-live-AbC12_x. Never a whole key. */
export const KEY_PREFIX_RE = /^ic-[a-z]+-[A-Za-z0-9_-]{1,20}$/;

/**
 * True when a paid call's answer is a run that carries on (202), not the call's own reply: a run has
 * its links and progress. A call that finished in time may carry a run_id too, but neither of those.
 */
export const isRun = (r) => Boolean(r && typeof r === 'object' && typeof r.run_id === 'string' && r.links && r.progress);

const FIXES = {
  'auth.invalid_key': 'Sign the user in now: call agentic_id_login (it opens the browser and returns a link); in a terminal, `agentic-id login`. Or they set a valid API key in the plugin options. Never ask for a key in the chat.',
  'auth.missing_key': 'Sign the user in now: call agentic_id_login (it opens the browser and returns a link); in a terminal, `agentic-id login`. Or they set an API key in the plugin options. Never ask for a key in the chat.',
  'auth.token_expired': 'The sign-in has run out. Call agentic_id_login to sign in again (terminal: `agentic-id login`).',
  signed_out: 'Call agentic_id_login to sign in again (terminal: `agentic-id login`).',
  'credits.insufficient': 'The wallet cannot cover this call. Stop and tell the user; do not retry or raise the cap. If they want more credits, `agentic-id topup <credits>` (the topup tool) returns a payment link for them to open.',
  'topup.unavailable': 'Buying credits is not available on this server. The user can add credits through their iCustomer account or team. Nothing was charged.',
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
  bad_url: 'The server address must be a full web address such as https://agenticid.icustomer.ai. Fix it in the plugin options (api_url) or AGENTIC_ID_URL, or clear it to use the hosted service.',
  'source.unavailable': SOURCE_FIX,
  timeout: 'The call took too long. Discover and lookalike can take minutes: narrow the filters or lower max_accounts, then retry once.',
  'intent.ambiguous': 'That request can be read more than one way, so nothing was run or charged. Run it again with --preview (preview: true) to see each reading, then send the filters of the one you mean, or run the preview\'s plan.',
  'intent.unclear': 'Say it another way (what kind of company, where, how big), or use filters instead. Nothing was charged.',
  'intent.unavailable': 'Plain-language requests cannot be read right now. Use filters instead (industry, country, size), or try again later. Nothing was charged.',
  'plan.not_found': 'No such plan. Ask again with --preview (preview: true) for a new one.',
  'plan.expired': 'A plan is good for 30 minutes. Run the fresh plan shown here, or preview again. Nothing was charged.',
  'run.not_found': 'No run with that ID in this workspace. `agentic-id runs` lists them.',
  'run.not_finished': 'The run is still going. Read what is ready with `agentic-id runs results <id>`, or add --wait to follow it to the end.',
  'auth.sign_in_required': 'Only a signed-in user can make or revoke API keys, not an API key. Run `agentic-id login`, and unset AGENTIC_ID_API_KEY (or AGENTIC_ID_API_KEY_FILE) for this command: a configured key is used instead of a sign-in.',
  'key.not_found': 'No active key with that prefix in this workspace. `agentic-id keys` lists them.',
  'key.limit_reached': 'This workspace has as many active keys as it may. Revoke one you no longer use (`agentic-id keys revoke <prefix>`), then try again.',
  'export.link_invalid': 'Export links last an hour. Ask for a new one with `agentic-id runs export <id>`.',
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
    const { issues, rejected, retryAfterSeconds, available, request_id: requestId, readings, preview } = this.problem;
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
      // A plain-language ask that can mean more than one search: each way it was read.
      ...(Array.isArray(readings) && readings.length ? { readings } : {}),
      // An expired plan comes back with a fresh preview to run instead.
      ...(typeof preview?.plan_id === 'string' ? { fresh_plan_id: preview.plan_id, ...(preview.quote ? { fresh_quote: preview.quote } : {}) } : {}),
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

  async call(method, path, body, headers = {}) {
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
            ...headers,
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
      // The wallet's own answers (balance, top-ups) speak of payments: they are not a data source's bill.
      const ownWallet = path.startsWith('/v1/credits');
      if (res.ok) return shieldReply(json, { ownWallet });
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
      if (!ownWallet && isSourceFailure(json.code, json.detail, res.status)) throw new AgenticIdError(503, 'source.unavailable', SOURCE_DOWN, typeof json.request_id === 'string' ? { request_id: json.request_id } : {});
      const problem = shieldProblem({ ...json, detail: String(json.detail ?? res.statusText ?? 'Request failed.') }, { ownWallet: ownWallet || json.code === 'credits.insufficient' });
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

  /**
   * A paid call. It answers within PAID_WAIT_S seconds when it can; a bigger or slower one answers
   * with the run it carries on as (see isRun): its first results, its run_id and its links.
   */
  paid(verb, body) {
    return this.call('POST', `/v1/${verb}`, body, { prefer: `wait=${PAID_WAIT_S}` });
  }
  /** Is this mailbox real? 1 credit per valid, invalid or catch-all answer; unknown and rejected are free. */
  validate(body) {
    return this.paid('validate', body);
  }
  /** One stable Agentic ID for a person or company. */
  resolve(body) {
    return this.paid('resolve', body);
  }
  /** Fill in missing facts; each comes with its level (verified, corroborated, claimed) and source. */
  enrich(body) {
    return this.paid('enrich', body);
  }
  /** People in a role inside one company. */
  find(body) {
    return this.paid('find', body);
  }
  /** New companies (and the people in them) that match filters or a plain-language ask. preview: true is free. */
  discover(body) {
    return this.paid('discover', body);
  }
  /** Companies like the seeds, ranked by how alike they are, seeds excluded. */
  lookalike(body) {
    return this.paid('lookalike', body);
  }

  // ---------------------------------------------------------------- runs (all free)
  /** This workspace's runs, newest first. status: running, paused or finished; limit 1 to 100. */
  runs({ status, limit } = {}) {
    const q = new URLSearchParams({ ...(status ? { status } : {}), ...(limit ? { limit: String(limit) } : {}) }).toString();
    return this.call('GET', `/v1/runs${q ? `?${q}` : ''}`);
  }
  /** Where one run stands: status, progress, credits, and why fewer for an exhausted search. */
  run(id) {
    return this.call('GET', `/v1/runs/${encodeURIComponent(id)}`);
  }
  /** The next page of a run's results after a cursor. `wait` long-polls up to 20 seconds for new ones. */
  runResults(id, { after = 0, limit = 100, wait } = {}) {
    return this.call('GET', `/v1/runs/${encodeURIComponent(id)}/results?after=${encodeURIComponent(after)}&limit=${encodeURIComponent(limit)}`, undefined, wait ? { prefer: `wait=${Math.min(20, Math.max(0, Math.round(wait)))}` } : {});
  }
  /** A finished run as the call's own reply (the same shape the call answers inline). */
  runReply(id) {
    return this.call('GET', `/v1/runs/${encodeURIComponent(id)}/reply`);
  }
  /** Stops new spend; what was delivered stays delivered. */
  cancelRun(id) {
    return this.call('POST', `/v1/runs/${encodeURIComponent(id)}/cancel`, {});
  }
  /** Carries on with a paused run: { max_credits?, source_spend_cap_usd? }. */
  resumeRun(id, body = {}) {
    return this.call('POST', `/v1/runs/${encodeURIComponent(id)}/resume`, body);
  }
  /** A signed link to every result of a run, CSV or NDJSON, good for an hour. */
  exportRun(id, format = 'csv') {
    return this.call('GET', `/v1/runs/${encodeURIComponent(id)}/export?format=${encodeURIComponent(format)}`);
  }
  /**
   * Follows a run to its end with long polls (never a tight loop) and answers with the call's own
   * reply, which carries run_status. Used where a list is worked through in parts and each part's
   * answer is needed whole. Gives up after this client's timeout, saying how to follow the run.
   */
  async followRun(id) {
    if (!RUN_ID_RE.test(String(id))) throw new AgenticIdError(0, 'run.not_found', `"${String(id).slice(0, 40)}" is not a run ID.`);
    const deadline = Date.now() + this.timeoutMs;
    let after = 0;
    for (;;) {
      const page = await this.runResults(id, { after, wait: 20 });
      after = page.after ?? after;
      if (page.next === null) break;
      if (Date.now() > deadline) throw new AgenticIdError(0, 'timeout', `The call carries on as run ${id} and is not finished yet. Follow it with: agentic-id runs show ${id}`);
    }
    return this.runReply(id);
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
  /**
   * Buy credits: a payment link for `credits` credits (whole number). Nothing is charged until the
   * user pays on that page; the credits land seconds after. Not retried on a fault (POST, keyed).
   */
  topup(body) {
    return this.call('POST', '/v1/credits/topup', body);
  }
  /** What happened after a value was used: bounced, replied, wrong_person, confirmed. Free. */
  feedback(body) {
    return this.call('POST', '/v1/feedback', body);
  }
  /** Which workspace and scopes this key has. Free. */
  me() {
    return this.call('GET', '/v1/me');
  }

  // ---------------------------------------------------------------- API keys
  /** This workspace's API keys: prefix, name and dates, never the key itself. Any caller. */
  keys() {
    return this.call('GET', '/v1/keys');
  }
  /** A new API key, shown once in the answer (`key`). Signed-in users only (403 auth.sign_in_required). */
  createKey(body = {}) {
    return this.call('POST', '/v1/keys', body);
  }
  /** Revoke a key by its prefix. Signed-in users only. */
  revokeKey(prefix) {
    return this.call('DELETE', `/v1/keys/${encodeURIComponent(prefix)}`);
  }
}
