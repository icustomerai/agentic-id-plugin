// What the user sees is Agentic ID's answer, never the plumbing behind it. Every answer and every
// error from the API passes through here before it reaches a tool result, the terminal or a file:
//
//   - the names of the data sources Agentic ID buys from are taken out of the text, and the keys
//     that carry them (provider, vendor, upstream ...) are dropped;
//   - a data source's own billing or quota message ("payment required", "balance is $0") is never
//     passed on: it says nothing the user can act on, and it is not their wallet;
//   - when a data source failed, the answer says so in plain words and says nothing was charged.
//
// Values about a person or company (names, domains, titles) are left exactly as they came.

// The sources behind Agentic ID, and the names other enrichment and mailbox-check services go by.
// Matched as whole words, in the narrative text only (summary, message, reason ...), never in a value.
const VENDORS = ['treg', 'treg\\.io', 'treg ai', 'apollo\\.io', 'zoominfo', 'clearbit', 'people ?data ?labs', 'peopledatalabs', 'pdl', 'lusha', 'cognism', 'rocketreach', 'hunter\\.io', 'snov\\.io', 'coresignal', 'proxycurl', 'zerobounce', 'neverbounce', 'kickbox', 'millionverifier', 'debounce\\.io', 'emailable', 'builtwith', 'theirstack', 'provider[-_ ](?:[a-z]|\\d{1,3})'];
const VENDOR_RE = new RegExp(`\\b(?:${VENDORS.join('|')})\\b`, 'gi');
// "match at Treg", "data from Treg": the source is simply left out of the sentence.
const VIA_VENDOR_RE = new RegExp(`\\s+(?:at|from|via|through|by|on|in)\\s+(?:${VENDORS.join('|')})\\b`, 'gi');

// A data source's own billing, quota or account trouble. Agentic ID's wallet speaks of credits, so
// "credits" alone never matches here.
const BILLING_RE = /payment required|insufficient (?:balance|funds)|(?:account|upstream|provider|vendor|source) balance|balance (?:is|of|was)\s*\$\s?0|\$\s?0(?:\.0+)? balance|quota (?:exceeded|reached|exhausted)|(?:subscription|plan) (?:expired|inactive|cancell?ed|lapsed)|billing (?:error|issue|problem|failed|failure)|upgrade your plan|please top[- ]?up|(?:http|status|error)[ :]*402\b|\b402 payment|\breturned\s+(?:an?\s+)?(?:http\s*)?402\b/i;
// "4 sources failed", "all providers failed", "upstream error", "provider returned 500".
const SOURCE_FAIL_RE = /\b(?:\d+|all|every|both)\s+(?:data\s+)?(?:sources?|providers?|vendors?)\s+(?:failed|errored|did not answer|were unavailable|unavailable)\b|\bupstream\b|\b(?:provider|vendor)(?:[-_ ](?:[a-z]|\d{1,3}))?s?\b\s+(?:error|failed|returned|unavailable|timed out)/i;

// Keys whose value names a source: dropped. total_at_provider is kept under a neutral name.
const DROP = new Set(['provider', 'providers', 'provider_id', 'provider_name', 'provider_error', 'provider_status', 'vendor', 'vendors', 'vendor_error', 'upstream', 'upstream_error', 'upstream_status', 'raw', 'raw_error', 'sources_failed', 'failed_sources', 'source_errors']);
const RENAME = { total_at_provider: 'total_matching', total_at_source: 'total_matching' };
// Keys that hold words for people to read (as opposed to a value about a person or company).
const NARRATIVE = new Set(['summary', 'message', 'detail', 'title_note', 'reason', 'note', 'notes', 'fix', 'explanation', 'warning', 'warnings', 'input_notes', 'status_reason', 'hint', 'error_message', 'stopped_reason']);
// Keys that name where a value came from: kept, but as a level of trust, never a company.
const ORIGIN = new Set(['source', 'lineage', 'origin', 'sources']);
const OWN_ORIGINS = new Set(['agentic-id', 'agentic_id', 'workspace', 'web', 'company-site', 'company_site', 'professional-profile', 'professional_profile', 'user', 'crm', 'feedback', 'dns', 'smtp', 'mx', 'ledger', 'provider', 'third_party', 'data_source']);

export const SOURCE_DOWN = 'A data source Agentic ID relies on was unavailable, so nothing came back for this. Nothing was charged for it.';
export const SOURCE_FIX = 'This is on the Agentic ID side, not the user\'s account or credits. Try again later; if it keeps happening, report the request_id. Do not retry in a loop.';

/** One narrative string, cleaned. `hit` is set when it described a source failure or a source's bill. */
function cleanText(s, state) {
  if (typeof s !== 'string' || !s) return s;
  if (BILLING_RE.test(s) && !state.ownWallet) {
    state.down = true;
    return SOURCE_DOWN;
  }
  let out = s;
  if (SOURCE_FAIL_RE.test(out)) {
    state.down = true;
    out = out.replace(/\b(?:\d+|all|every|both)\s+(?:data\s+)?(?:sources?|providers?|vendors?)\s+(?:failed|errored|did not answer|were unavailable|unavailable)\b/gi, 'the data source was unavailable').replace(/\bupstream\b/gi, 'data source');
  }
  VENDOR_RE.lastIndex = 0;
  if (VENDOR_RE.test(out)) {
    VENDOR_RE.lastIndex = 0;
    out = out.replace(VIA_VENDOR_RE, '').replace(VENDOR_RE, 'a data source');
  }
  return out;
}

function cleanOrigin(v) {
  if (typeof v !== 'string') return v;
  const k = v.trim().toLowerCase();
  return OWN_ORIGINS.has(k) ? v : 'data_source';
}

function walk(v, state, key) {
  if (Array.isArray(v)) {
    // A plan is a list of which source was asked and why: only the why is kept.
    if (key === 'plan') return v.map((p) => (p && typeof p === 'object' ? (p.why ? { why: cleanText(String(p.why), state) } : {}) : cleanText(String(p), state))).filter((p) => typeof p === 'string' || Object.keys(p).length);
    return v.map((x) => (NARRATIVE.has(key) && typeof x === 'string' ? cleanText(x, state) : ORIGIN.has(key) && typeof x === 'string' ? cleanOrigin(x) : walk(x, state, key)));
  }
  if (!v || typeof v !== 'object') return v;
  const out = {};
  for (const [k, x] of Object.entries(v)) {
    if (DROP.has(k)) continue;
    const name = RENAME[k] ?? k;
    if (NARRATIVE.has(k) && typeof x === 'string') out[name] = cleanText(x, state);
    else if (ORIGIN.has(k) && typeof x === 'string') out[name] = cleanOrigin(x);
    else out[name] = walk(x, state, k);
  }
  return out;
}

const delivered = (r) => ['results', 'accounts', 'contacts', 'people', 'rows', 'fields'].some((k) => Array.isArray(r?.[k]) && r[k].length > 0) || Boolean(r?.id);

/**
 * An API answer, cleaned. When a data source failed, `source_unavailable: true` is set and the
 * summary says so plainly; when nothing at all came back, the summary is replaced.
 */
export function shieldReply(reply) {
  if (!reply || typeof reply !== 'object' || Array.isArray(reply)) return reply;
  const state = { down: false, ownWallet: false };
  const out = walk(reply, state);
  if (!state.down) return out;
  const charged = out.cost?.charged_credits ?? 0;
  out.source_unavailable = true;
  if (!delivered(out) && !out.count_only && charged === 0) out.summary = `${SOURCE_DOWN} Try again later.`;
  else if (out.summary === SOURCE_DOWN) out.summary = `Some answers are missing because a data source was unavailable. ${charged} credit${charged === 1 ? '' : 's'} charged, only for answers that came back.`;
  else out.summary = `${out.summary ?? ''}${out.summary ? ' ' : ''}Some answers are missing because a data source was unavailable; only answers that came back are charged.`.trim();
  return out;
}

/** True when the error is about a data source rather than the user's request, key or wallet. */
export function isSourceFailure(code, detail, status) {
  if (code === 'credits.insufficient' || code === 'credits.cap_too_low') return false;
  if (typeof code === 'string' && /provider|vendor|upstream|source\.|^source_/.test(code)) return true;
  const text = String(detail ?? '');
  if (BILLING_RE.test(text) || SOURCE_FAIL_RE.test(text)) return true;
  VENDOR_RE.lastIndex = 0;
  if (VENDOR_RE.test(text)) return true;
  // A 402 is only ever Agentic ID's own wallet, and that one carries credits.insufficient.
  return status === 402 && !/credit/i.test(text);
}

/** The problem-details body of an error, cleaned the same way (issues, rejected and notes). */
export function shieldProblem(problem, { ownWallet = false } = {}) {
  if (!problem || typeof problem !== 'object') return problem ?? {};
  return walk(problem, { down: false, ownWallet });
}

/** For tests and the CLI: does this text still name a source or carry a source's bill? */
export const leaksSource = (text) => {
  VENDOR_RE.lastIndex = 0;
  const s = String(text);
  return VENDOR_RE.test(s) || /\bprovider[-_][a-z]\b|total_at_provider|payment required|\$\s?0\b|\d+ sources failed/i.test(s);
};
