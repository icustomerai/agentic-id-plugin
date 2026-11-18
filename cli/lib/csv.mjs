// A small CSV reader and writer for lead lists: quoted fields, embedded newlines, CRLF, a BOM,
// and comma, semicolon or tab as the separator (spreadsheet exports differ by locale).
//
// The writer gives back what the reader took in: the same rows in the same order (blank ones
// included, so row numbers hold), the same cell text, two columns of the same name both kept,
// cells beyond the header kept, and the file's own BOM and line endings.
/**
 * The separator, from the header line. Separators inside quotes do not count ("Name, Full";Email is
 * semicolon-separated), and on a tie the one the next lines agree with wins.
 */
export function sniffDelimiter(firstLine, nextLines = []) {
  const outside = (line, d) => {
    let n = 0;
    let q = false;
    for (const c of line) {
      if (c === '"') q = !q;
      else if (c === d && !q) n += 1;
    }
    return n;
  };
  const counts = [',', ';', '\t', '|'].map((d) => [d, outside(firstLine, d), nextLines.filter((l) => l.trim() && outside(l, d) === outside(firstLine, d)).length]);
  counts.sort((a, b) => b[1] - a[1] || b[2] - a[2]);
  if (counts[0][1] === 0) return ',';
  // A pipe only when nothing else separates the header.
  if (counts[0][0] === '|' && counts.some(([d, n]) => d !== '|' && n > 0)) return counts.find(([d, n]) => d !== '|' && n > 0)[0];
  return counts[0][0];
}

/**
 * A file's bytes as text: UTF-8 (with or without a BOM), UTF-16 from Excel's "Unicode text", or a
 * Windows-1252 export (Excel on Windows, umlauts in German headers). A BOM is kept as \uFEFF so the
 * written file gets one too, and Excel opens it with the right characters.
 */
export function decodeText(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  if (b[0] === 0xff && b[1] === 0xfe) return { text: `\uFEFF${new TextDecoder('utf-16le').decode(b.subarray(2))}`, encoding: 'utf-16le' };
  if (b[0] === 0xfe && b[1] === 0xff) return { text: `\uFEFF${new TextDecoder('utf-16be').decode(b.subarray(2))}`, encoding: 'utf-16be' };
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(b), encoding: 'utf-8' };
  } catch {
    return { text: new TextDecoder('windows-1252').decode(b), encoding: 'windows-1252' };
  }
}

// Columns are keyed by a unique id so two columns called "email" do not overwrite each other.
// The id is the name itself, or name + SEP + n for a repeat or an unnamed column.
const SEP = '\u0000';
export const columnName = (key) => String(key).split(SEP)[0];

export function parseCsv(input, delimiter) {
  const bom = input.startsWith('﻿');
  let text = bom ? input.slice(1) : input;
  const eol = /\r\n/.test(text) ? '\r\n' : '\n';
  // Excel's "sep=;" first line names the separator; it is kept and written back.
  const sepLine = text.match(/^sep=(.)\r?\n/i);
  if (sepLine) text = text.slice(sepLine[0].length);
  const lines = text.split(/\r?\n/, 6);
  const d = delimiter ?? (sepLine ? sepLine[1] : sniffDelimiter(lines[0] ?? '', lines.slice(1)));
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
  const sep = sepLine ? sepLine[1] : undefined;
  if (!sawAny || !raw.length || !raw[0].some((x) => x.trim() !== '')) return { header: [], rows: [], delimiter: d, bom, eol, sep };
  // A header cell may be quoted, padded or carry a stray BOM from a joined file.
  const names = raw[0].map((h) => h.replace(/^\uFEFF/, '').trim());
  const width = Math.max(names.length, ...raw.slice(1).map((r) => r.length));
  const seen = new Map();
  const header = [];
  for (let i = 0; i < width; i += 1) {
    const name = names[i] ?? '';
    const n = seen.get(name) ?? 0;
    seen.set(name, n + 1);
    header.push(name !== '' && n === 0 ? name : `${name}${SEP}${i}`);
  }
  return { header, rows: raw.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? '']))), delimiter: d, bom, eol, sep };
}

// A cell that starts with = + - @ (or a tab or carriage return) is run as a formula by
// spreadsheets, also after leading spaces and in the full-width forms Excel accepts (＝ ＋ － ＠).
// A leading quote stops that. A plain number or a phone number (+1 555 0100, -42.5) is left alone.
export const FORMULA_START = /^[\s\u00a0\u3000]*[=+\-@\uff1d\uff0b\uff0d\uff20]|^[\t\r]/;
const cell = (v, d) => {
  let s = v === undefined || v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (FORMULA_START.test(s) && !/^[+-]?[\d\s().-]*\d[\d\s().-]*$/.test(s)) s = `'${s}`;
  return s.includes('"') || s.includes(d) || /[\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** `header` holds column keys (see parseCsv); the names are written. `like` carries the source file's BOM and line endings. */
export function toCsv(header, rows, delimiter = ',', like = {}) {
  const eol = like.eol ?? '\n';
  const lines = [header.map(columnName), ...rows.map((r) => header.map((h) => r[h]))].map((r) => r.map((v) => cell(v, delimiter)).join(delimiter));
  return `${like.bom ? '﻿' : ''}${like.sep ? `sep=${like.sep}${eol}` : ''}${lines.join(eol)}${eol}`;
}

const ALIASES = {
  email: ['email', 'work email', 'work_email', 'email address', 'email_address', 'e mail', 'e mail address', 'business email', 'business e mail', 'mail', 'emailadresse', 'e mail adresse', 'mailadresse', 'mail adresse', 'geschäftliche e mail', 'geschaeftliche e mail', 'geschäftliche e mail adresse', 'dienstliche e mail', 'firmen e mail', 'correo', 'correo electrónico', 'courriel', 'adresse e mail', 'adresse email'],
  linkedin_url: ['linkedin', 'linkedin url', 'linkedin_url', 'linkedin profile', 'linkedin profile url', 'linkedin profil', 'linkedin link', 'person linkedin url', 'profile url', 'profil url'],
  name: ['name', 'full name', 'full_name', 'contact name', 'contact', 'vollständiger name', 'vollstaendiger name', 'ansprechpartner', 'nombre', 'nom complet'],
  first_name: ['first name', 'first_name', 'firstname', 'given name', 'vorname', 'prénom', 'prenom', 'nombre de pila'],
  last_name: ['last name', 'last_name', 'lastname', 'surname', 'family name', 'nachname', 'familienname', 'nom', 'apellido', 'apellidos'],
  company_name: ['company', 'company name', 'company_name', 'account', 'account name', 'organization', 'organisation', 'organization name', 'employer', 'firma', 'firmenname', 'firma name', 'unternehmen', 'unternehmensname', 'arbeitgeber', 'empresa', 'societe', 'société', 'entreprise'],
  company_domain: ['domain', 'company domain', 'company_domain', 'website', 'company website', 'website url', 'url', 'web', 'web site', 'webseite', 'internetseite', 'homepage', 'domäne', 'domaene', 'firmen website', 'site web', 'sitio web'],
};
const norm = (h) => columnName(h).normalize('NFC').toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Which column holds which identifier, from the header names people actually use. `overrides` wins. */
export function mapColumns(header, overrides = {}) {
  const map = {};
  const alts = {};
  for (const [field, names] of Object.entries(ALIASES)) {
    const wanted = overrides[field];
    const hits = wanted ? header.filter((h) => norm(h) === norm(wanted)) : header.filter((h) => names.includes(norm(h)));
    if (wanted && !hits.length) throw new Error(`No column "${wanted}" in the file. Columns: ${header.map(columnName).join(', ')}`);
    if (hits.length) {
      map[field] = hits[0];
      alts[field] = hits;
    }
  }
  // Two columns of the same kind (two "email" columns): both are read, the first filled one wins.
  Object.defineProperty(map, 'alts', { value: alts, enumerable: false });
  return map;
}

/** The cell for one identifier in one row: the first non-empty of the columns that hold it, trimmed. */
export function cellFor(row, map, field) {
  for (const col of map.alts?.[field] ?? (map[field] ? [map[field]] : [])) {
    const v = String(row[col] ?? '').trim();
    if (v) return v;
  }
  return '';
}

/** Columns nobody mapped whose cells mostly look like emails: a header we did not recognise. */
export function unmappedEmailColumns(header, rows, map) {
  const used = new Set(Object.values(map.alts ?? {}).flat().concat(Object.values(map)));
  const sample = rows.slice(0, 200);
  return header.filter((h) => {
    if (used.has(h)) return false;
    const filled = sample.map((r) => String(r[h] ?? '').trim()).filter(Boolean);
    return filled.length > 0 && filled.filter((v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)).length / filled.length >= 0.6;
  });
}

export const rowIdentifiers = (row, map) => Object.fromEntries(Object.keys(map).map((field) => [field, cellFor(row, map, field)]).filter(([, v]) => v));
