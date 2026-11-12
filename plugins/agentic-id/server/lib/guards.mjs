// Input cleaning that runs on this machine before anything is sent. Two jobs:
//   1. tidy what people really paste (URLs for domains, "Name <email>", mailto:, tracking
//      parameters on LinkedIn links, duplicates), so a call is not wasted on a typo;
//   2. keep consumer data on this machine: personal mailboxes and phone numbers are dropped here
//      and counted, never sent. The server refuses them too; this saves the round trip.
// Pure functions, no network.

// The free-mail providers people most often paste. The server holds the full list.
const PERSONAL = new Set(
  `gmail.com googlemail.com yahoo.com yahoo.co.uk yahoo.co.in yahoo.fr ymail.com rocketmail.com outlook.com hotmail.com hotmail.co.uk
   live.com msn.com icloud.com me.com mac.com aol.com proton.me protonmail.com pm.me gmx.com gmx.de gmx.net web.de mail.com zoho.com
   yandex.com yandex.ru mail.ru qq.com 163.com 126.com sina.com naver.com hey.com fastmail.com tutanota.com rediffmail.com
   comcast.net verizon.net att.net sbcglobal.net btinternet.com orange.fr free.fr t-online.de libero.it`.split(/\s+/),
);
// Free-mail providers under any country ending (yahoo.de, hotmail.fr, outlook.de, live.co.uk ...).
const PERSONAL_LABELS = /^(gmail|googlemail|yahoo|ymail|rocketmail|hotmail|outlook|live|msn|icloud|aol|protonmail|proton|gmx|yandex|zoho|zohomail|fastmail|tutanota|tuta|mail|email|inbox|hushmail|rediffmail)\.(com?\.)?[a-z]{2,3}$/;
const isPersonal = (d) => PERSONAL.has(d) || PERSONAL_LABELS.test(d);
const TEST_DOMAINS = new Set(['example.com', 'example.org', 'example.net', 'test.com', 'domain.com', 'email.com', 'company.com']);
const TEST_LOCALS = new Set(['test', 'testing', 'example', 'foo', 'asdf', 'null', 'none', 'na', 'noemail', 'abc']);
const ROLE_LOCALS = new Set(
  `info sales support hello contact admin office team hr jobs careers billing accounts marketing press media help service
   enquiries inquiries noreply no-reply donotreply postmaster webmaster abuse security privacy legal finance`.split(/\s+/),
);
const COUNTRY_ALIASES = { UK: 'GB', 'U.K.': 'GB', BRITAIN: 'GB', 'GREAT BRITAIN': 'GB', ENGLAND: 'GB', 'UNITED KINGDOM': 'GB', USA: 'US', 'U.S.': 'US', 'U.S.A.': 'US', 'UNITED STATES': 'US', AMERICA: 'US', UAE: 'AE', DEUTSCHLAND: 'DE', HOLLAND: 'NL' };

const EMAIL_RE = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const DOMAIN_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/;

const text = (v) => (typeof v === 'string' ? v.normalize('NFKC').replace(/[​-‍﻿]/g, '').trim() : '');

/** "Jane Doe <Jane.Doe@Acme.io>", "mailto:jane@acme.io?subject=x", " JANE@ACME.IO; " -> jane.doe@acme.io */
export function cleanEmail(raw) {
  let s = text(raw);
  if (!s) return { ok: false, reason: 'empty' };
  const angle = s.match(/<([^<>]+)>/);
  if (angle) s = angle[1];
  s = s.replace(/^mailto:/i, '').split('?')[0].replace(/^["'\s]+|["'\s,;.]+$/g, '').toLowerCase();
  if (!EMAIL_RE.test(s) || s.length > 320 || s.includes('..')) return { ok: false, email: s, reason: 'malformed' };
  const [local, domain] = [s.slice(0, s.lastIndexOf('@')), s.slice(s.lastIndexOf('@') + 1)];
  if (isPersonal(domain)) return { ok: false, email: s, reason: 'personal_email' };
  if (TEST_DOMAINS.has(domain) || TEST_LOCALS.has(local)) return { ok: true, email: s, domain, role: false, warning: 'looks_like_test_data' };
  return { ok: true, email: s, domain, role: ROLE_LOCALS.has(local) };
}

/** "https://www.Acme.io/about?x=1", "acme.io/", "jane@acme.io" (no: an email is not a domain) -> acme.io */
export function cleanDomain(raw) {
  let s = text(raw).toLowerCase();
  if (!s || s.includes('@')) return undefined;
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/^www\d?\./, '').split(/[/?#:]/)[0].replace(/\.$/, '');
  try {
    s = new URL(`http://${s}`).hostname; // punycode for international names
  } catch {
    return undefined;
  }
  return DOMAIN_RE.test(s) && s.length <= 253 ? s : undefined;
}

/** A LinkedIn URL in one shape, without tracking parameters. Says whether it is a person or a company page. */
export function cleanLinkedin(raw) {
  let s = text(raw);
  if (!s) return { ok: false, reason: 'empty' };
  if (!/^https?:\/\//i.test(s)) s = `https://${s.replace(/^\/+/, '')}`;
  let u;
  try {
    u = new URL(s);
  } catch {
    return { ok: false, reason: 'not_a_url' };
  }
  if (!/(^|\.)linkedin\.com$/i.test(u.hostname)) return { ok: false, reason: 'not_linkedin' };
  const parts = u.pathname.split('/').filter(Boolean);
  const [section, slug] = parts;
  if (section === 'in' && slug) return { ok: true, kind: 'person', url: `https://www.linkedin.com/in/${decodeURIComponent(slug).toLowerCase()}` };
  if ((section === 'company' || section === 'school' || section === 'showcase') && slug) return { ok: true, kind: 'company', url: `https://www.linkedin.com/company/${decodeURIComponent(slug).toLowerCase()}` };
  // Sales Navigator, Recruiter and /pub/ links carry an internal id, not the public profile.
  if (section === 'sales' || section === 'talent' || section === 'pub') return { ok: false, reason: 'not_a_public_profile_url' };
  return { ok: false, reason: 'not_a_profile_url' };
}

/** A phone number, however it is written. Used to keep phones out of free-text fields. */
export const looksLikePhone = (raw) => {
  const s = text(raw);
  return /^\+?[\d\s().-]{7,20}$/.test(s) && s.replace(/\D/g, '').length >= 7;
};

export const cleanCountry = (raw) => {
  const s = text(raw);
  return COUNTRY_ALIASES[s.toUpperCase()] ?? (s.length === 2 ? s.toUpperCase() : s);
};

/** A list from an array or a "a, b; c" string, trimmed, without empties or repeats (case-insensitive). */
export function cleanList(raw, map = (x) => x) {
  const items = (Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[,;\n]/) : []).map((x) => map(text(x))).filter(Boolean);
  const seen = new Set();
  return items.filter((x) => (seen.has(String(x).toLowerCase()) ? false : seen.add(String(x).toLowerCase())));
}

/**
 * One person-or-company identifier set, cleaned. Returns what to send and what was dropped and why.
 * Accepts the public field names plus the aliases people use in spreadsheets.
 */
export function cleanIdentifiers(raw = {}) {
  const out = {};
  const dropped = [];
  const notes = [];
  const pick = (...keys) => keys.map((k) => raw[k]).find((v) => typeof v === 'string' && v.trim());

  const email = pick('email', 'work_email', 'email_address');
  if (email) {
    const e = cleanEmail(email);
    if (e.ok) {
      out.email = e.email;
      if (e.warning) notes.push(`"${e.email}" looks like test data`);
      if (e.role) notes.push(`"${e.email}" is a shared mailbox, not a person`);
    } else dropped.push({ field: 'email', reason: e.reason });
  }
  const li = pick('linkedin_url', 'linkedin', 'linkedin_profile');
  if (li) {
    const l = cleanLinkedin(li);
    if (l.ok && l.kind === 'person') out.linkedin_url = l.url;
    else if (l.ok) notes.push('the LinkedIn link is a company page; use the company domain to resolve a company');
    else dropped.push({ field: 'linkedin_url', reason: l.reason });
  }
  const first = pick('first_name', 'firstname');
  const last = pick('last_name', 'lastname');
  const name = pick('name', 'full_name') ?? ([first, last].filter(Boolean).join(' ') || undefined);
  if (name) {
    if (looksLikePhone(name) || name.includes('@')) dropped.push({ field: 'name', reason: 'not_a_name' });
    else out.name = text(name).replace(/\s+/g, ' ').slice(0, 200);
  }
  const company = pick('company_name', 'company', 'organization', 'account_name');
  if (company) out.company_name = text(company).replace(/\s+/g, ' ').slice(0, 200);
  const domain = pick('company_domain', 'domain', 'website', 'company_website');
  if (domain) {
    const d = cleanDomain(domain);
    if (!d) dropped.push({ field: 'company_domain', reason: 'not_a_domain' });
    else if (isPersonal(d)) dropped.push({ field: 'company_domain', reason: 'personal_mail_provider_is_not_a_company' });
    else out.company_domain = d;
  }
  // The email's own domain is the employer's when nothing else names the company.
  if (!out.company_domain && out.email && !pick('company_domain', 'domain', 'website', 'company_website')) notes.push('no company domain given; the email domain will be used');
  for (const k of ['phone', 'mobile', 'phone_number', 'mobile_phone']) if (raw[k]) dropped.push({ field: k, reason: 'phone_numbers_are_not_sent' });
  return { identifiers: out, dropped, notes, empty: Object.keys(out).length === 0 };
}

/** The key two rows share when they are the same lookup, so a list is never paid for twice. */
export const identityKey = (i) => i.email ?? i.linkedin_url ?? (i.name && (i.company_domain || i.company_name) ? `${i.name.toLowerCase()}|${(i.company_domain ?? i.company_name).toLowerCase()}` : i.company_domain ?? (i.company_name ? `c:${i.company_name.toLowerCase()}` : undefined));

/** Emails ready to send, with everything that was held back counted by reason. */
export function cleanEmails(raw) {
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[\s,;]+/) : [];
  const send = [];
  const held = [];
  const seen = new Set();
  let duplicates = 0;
  const warnings = [];
  for (const item of list) {
    if (!text(item)) continue;
    const e = cleanEmail(item);
    if (!e.ok) {
      held.push({ email: e.email ?? text(item).slice(0, 80), verdict: 'rejected', reason: e.reason === 'personal_email' ? 'personal_email_not_b2b' : `email_${e.reason}`, checked: 'locally' });
      continue;
    }
    if (seen.has(e.email)) {
      duplicates += 1;
      continue;
    }
    seen.add(e.email);
    send.push(e.email);
    if (e.warning) warnings.push(e.email);
  }
  return { send, held, duplicates, test_like: warnings };
}

export const chunk = (arr, size) => Array.from({ length: Math.ceil(arr.length / size) }, (_, i) => arr.slice(i * size, (i + 1) * size));

export const isPersonalDomain = (d) => isPersonal(String(d).toLowerCase());
