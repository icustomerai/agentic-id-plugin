// The Agentic ID client: one method per verb of the V3 public API (/v1/*). No dependencies.
//
//   const id = new AgenticId({ apiKey, baseUrl });
//   const { id: agenticId } = await id.resolve({ identifiers: { company_domain: 'acme.io' } });
//
// Failures throw AgenticIdError with the problem details the API sent (status, code, detail) and a
// plain "fix" line that says what to do next.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { accessToken, AuthError, hasSession } from './auth.mjs';

export const DEFAULT_URL = 'http://127.0.0.1:3100';
export const CLIENT = 'agentic-id-plugin/0.5.0';

const FIXES = {
  'auth.invalid_key': 'Sign in with `agentic-id login`, or set a valid Agentic ID API key in the plugin options (or AGENTIC_ID_API_KEY). Never paste a key into the chat.',
  'auth.missing_key': 'Sign in with `agentic-id login`, or set an Agentic ID API key in the plugin options (or AGENTIC_ID_API_KEY). Never paste a key into the chat.',
  'auth.token_expired': 'The sign-in has run out. Run `agentic-id login` again.',
  signed_out: 'Run `agentic-id login` again.',
  'credits.insufficient': 'The wallet cannot cover this call. Stop and tell the user; do not retry or raise the cap.',
  'credits.cap_too_low': 'max_credits is below the cheapest result. Ask the user before raising it.',
  rate_limited: 'Too many requests for this key. Wait for retry_after_seconds, then send the same call once.',
  'feedback.not_held': 'Outcomes can only be reported for IDs this workspace holds. Resolve or enrich the person first, then report.',
  'request.invalid': 'Fix the fields listed in "issues" and call again. Nothing was charged.',
  'find.persona_unreadable': 'Give at least one job title in roles, or a seniority (e.g. "director+").',
  'lookalike.no_profile': 'The seeds share nothing we could read. Use company domains that resolve, ideally 3 or more of a similar kind.',
  'purpose.not_allowed': 'This purpose is not allowed for this data. Use b2b_outbound for outbound work, ad_audience for match.',
  'purpose.mismatch': 'The data was collected for a different purpose and cannot be reused for this one.',
  'pii.scope_required': 'This key cannot read contact values; they come back masked. Ask the workspace owner for a key with pii:read.',
  'identity.merge_blocked': 'These two records disagree on a strong identifier, so they were not merged. Review them; do not force it.',
  'service.unavailable': 'Agentic ID is not taking requests right now. Wait for retry_after_seconds and try again; nothing was charged.',
  'service.timeout': 'The call may have completed. Check the usage log or the result before sending it again.',
  'service.error': 'Agentic ID hit a fault. Try once more; if it repeats, report the request_id.',
  'idempotency.in_progress': 'The same request is still running. Wait, then ask again; it is not charged twice.',
  'idempotency.key_reused': 'Internal: a retry key was reused for a different request. Send the call again.',
  unreachable: 'The Agentic ID API did not answer. Check the server URL in the plugin options and run `agentic-id doctor`.',
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

export function urlFromEnv(env = process.env) {
  const u = (env.AGENTIC_ID_URL ?? env.CLAUDE_PLUGIN_OPTION_API_URL)?.trim();
  return (u && !u.startsWith('${') ? u : DEFAULT_URL).replace(/\/+$/, '');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
    if (!bearer) throw new AgenticIdError(401, 'auth.missing_key', 'Not signed in and no Agentic ID API key is configured.');
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
        throw new AgenticIdError(0, timedOut ? 'timeout' : 'unreachable', timedOut ? `No answer from ${this.baseUrl} within ${Math.round(this.timeoutMs / 1000)}s.` : `Could not reach ${this.baseUrl} (${e?.cause?.code ?? e?.cause?.errors?.[0]?.code ?? e?.message ?? 'network error'}).`);
      }
      const json = await res.json().catch(() => ({}));
      if (res.ok) return json;
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
      throw new AgenticIdError(res.status, json.code, String(json.detail ?? res.statusText ?? 'Request failed.'), json);
    }
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
