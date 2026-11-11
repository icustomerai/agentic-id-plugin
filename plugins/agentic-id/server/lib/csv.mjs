// A small CSV reader and writer for lead lists: quoted fields, embedded newlines, CRLF, a BOM,
// and comma, semicolon or tab as the separator (spreadsheet exports differ by locale).
export function sniffDelimiter(firstLine) {
  const counts = [',', ';', '\t'].map((d) => [d, firstLine.split(d).length - 1]);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ',';
}

export function parseCsv(input, delimiter) {
  const text = input.replace(/^﻿/, '');
  const d = delimiter ?? sniffDelimiter(text.split(/\r?\n/, 1)[0] ?? '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
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
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((x) => x.trim() !== '')) rows.push(row);
  if (!rows.length) return { header: [], rows: [], delimiter: d };
  const header = rows[0].map((h) => h.trim());
  return { header, rows: rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()]))), delimiter: d };
}

// A cell that starts with = + - @ is run as a formula by spreadsheets; a leading quote stops that.
const cell = (v, d) => {
  let s = v === undefined || v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return s.includes('"') || s.includes(d) || /[\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const toCsv = (header, rows, delimiter = ',') => [header, ...rows.map((r) => header.map((h) => r[h]))].map((r) => r.map((v) => cell(v, delimiter)).join(delimiter)).join('\n') + '\n';

const ALIASES = {
  email: ['email', 'work email', 'work_email', 'email address', 'email_address', 'e-mail', 'business email'],
  linkedin_url: ['linkedin', 'linkedin url', 'linkedin_url', 'linkedin profile', 'person linkedin url', 'profile url'],
  name: ['name', 'full name', 'full_name', 'contact name', 'contact'],
  first_name: ['first name', 'first_name', 'firstname', 'given name'],
  last_name: ['last name', 'last_name', 'lastname', 'surname', 'family name'],
  company_name: ['company', 'company name', 'company_name', 'account', 'account name', 'organization', 'organisation', 'employer'],
  company_domain: ['domain', 'company domain', 'company_domain', 'website', 'company website', 'url', 'web'],
};

/** Which column holds which identifier, from the header names people actually use. `overrides` wins. */
export function mapColumns(header, overrides = {}) {
  const norm = (h) => h.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  const map = {};
  for (const [field, names] of Object.entries(ALIASES)) {
    const wanted = overrides[field];
    const hit = wanted ? header.find((h) => norm(h) === norm(wanted)) : header.find((h) => names.includes(norm(h)));
    if (wanted && !hit) throw new Error(`No column "${wanted}" in the file. Columns: ${header.join(', ')}`);
    if (hit) map[field] = hit;
  }
  return map;
}

export const rowIdentifiers = (row, map) => Object.fromEntries(Object.entries(map).map(([field, col]) => [field, row[col]]).filter(([, v]) => v));
