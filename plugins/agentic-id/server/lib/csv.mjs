// A small CSV reader and writer for lead lists: quoted fields, embedded newlines, CRLF, a BOM,
// and comma, semicolon or tab as the separator (spreadsheet exports differ by locale).
//
// The writer gives back what the reader took in: the same rows in the same order (blank ones
// included, so row numbers hold), the same cell text, two columns of the same name both kept,
// cells beyond the header kept, and the file's own BOM and line endings.
export function sniffDelimiter(firstLine) {
  const counts = [',', ';', '\t'].map((d) => [d, firstLine.split(d).length - 1]);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ',';
}

// Columns are keyed by a unique id so two columns called "email" do not overwrite each other.
// The id is the name itself, or name + SEP + n for a repeat or an unnamed column.
const SEP = '\u0000';
export const columnName = (key) => String(key).split(SEP)[0];

export function parseCsv(input, delimiter) {
  const bom = input.startsWith('﻿');
  const text = bom ? input.slice(1) : input;
  const eol = /\r\n/.test(text) ? '\r\n' : '\n';
  const d = delimiter ?? sniffDelimiter(text.split(/\r?\n/, 1)[0] ?? '');
  const raw = [];
  let row = [];
  let field = '';
  let quoted = false;
  let sawAny = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    sawAny = true;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === d) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field);
      field = '';
      raw.push(row);
      row = [];
    } else field += c;
  }
  // The last line, unless the file simply ended with a line break.
  if (field !== '' || row.length) {
    row.push(field);
    raw.push(row);
  }
  if (!sawAny || !raw.length || !raw[0].some((x) => x.trim() !== '')) return { header: [], rows: [], delimiter: d, bom, eol };
  const names = raw[0].map((h) => h.trim());
  const width = Math.max(names.length, ...raw.slice(1).map((r) => r.length));
  const seen = new Map();
  const header = [];
  for (let i = 0; i < width; i += 1) {
    const name = names[i] ?? '';
    const n = seen.get(name) ?? 0;
    seen.set(name, n + 1);
    header.push(name !== '' && n === 0 ? name : `${name}${SEP}${i}`);
  }
  return { header, rows: raw.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? '']))), delimiter: d, bom, eol };
}

// A cell that starts with = + - @ is run as a formula by spreadsheets; a leading quote stops that.
// A plain number or a phone number (+1 555 0100, -42.5) is left as it is.
const cell = (v, d) => {
  let s = v === undefined || v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^[+-]?[\d\s().-]*\d[\d\s().-]*$/.test(s)) s = `'${s}`;
  return s.includes('"') || s.includes(d) || /[\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** `header` holds column keys (see parseCsv); the names are written. `like` carries the source file's BOM and line endings. */
export function toCsv(header, rows, delimiter = ',', like = {}) {
  const eol = like.eol ?? '\n';
  const lines = [header.map(columnName), ...rows.map((r) => header.map((h) => r[h]))].map((r) => r.map((v) => cell(v, delimiter)).join(delimiter));
  return `${like.bom ? '﻿' : ''}${lines.join(eol)}${eol}`;
}

const ALIASES = {
  email: ['email', 'work email', 'work_email', 'email address', 'email_address', 'e mail', 'e mail address', 'business email', 'mail', 'emailadresse', 'e mail adresse', 'correo', 'courriel'],
  linkedin_url: ['linkedin', 'linkedin url', 'linkedin_url', 'linkedin profile', 'person linkedin url', 'profile url'],
  name: ['name', 'full name', 'full_name', 'contact name', 'contact'],
  first_name: ['first name', 'first_name', 'firstname', 'given name', 'vorname'],
  last_name: ['last name', 'last_name', 'lastname', 'surname', 'family name', 'nachname'],
  company_name: ['company', 'company name', 'company_name', 'account', 'account name', 'organization', 'organisation', 'employer', 'firma', 'unternehmen', 'empresa', 'societe', 'société'],
  company_domain: ['domain', 'company domain', 'company_domain', 'website', 'company website', 'url', 'web', 'web site', 'webseite', 'homepage', 'site web'],
};
const norm = (h) => columnName(h).toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Which column holds which identifier, from the header names people actually use. `overrides` wins. */
export function mapColumns(header, overrides = {}) {
  const map = {};
  for (const [field, names] of Object.entries(ALIASES)) {
    const wanted = overrides[field];
    const hit = wanted ? header.find((h) => norm(h) === norm(wanted)) : header.find((h) => names.includes(norm(h)));
    if (wanted && !hit) throw new Error(`No column "${wanted}" in the file. Columns: ${header.map(columnName).join(', ')}`);
    if (hit) map[field] = hit;
  }
  return map;
}

/** Columns nobody mapped whose cells mostly look like emails: a header we did not recognise. */
export function unmappedEmailColumns(header, rows, map) {
  const used = new Set(Object.values(map));
  const sample = rows.slice(0, 200);
  return header.filter((h) => {
    if (used.has(h)) return false;
    const filled = sample.map((r) => String(r[h] ?? '').trim()).filter(Boolean);
    return filled.length > 0 && filled.filter((v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)).length / filled.length >= 0.6;
  });
}

export const rowIdentifiers = (row, map) => Object.fromEntries(Object.entries(map).map(([field, col]) => [field, String(row[col] ?? '').trim()]).filter(([, v]) => v));
