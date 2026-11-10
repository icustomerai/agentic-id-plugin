#!/usr/bin/env node
// Builds the README's animated SVGs (docs/assets/*.svg). Pure SMIL animation, no scripts, so they
// animate inside GitHub's <img> sandbox in Chrome, Firefox and Safari. People and companies are
// fictional, and each domain was checked to be unregistered (no A, MX or NS record). Edit here, then run:  node docs/assets/src/make-animations.mjs
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..');
const C = { bg: '#0d1117', panel: '#161b22', line: '#30363d', text: '#e6edf3', dim: '#8b949e', green: '#3fb950', blue: '#58a6ff', purple: '#bc8cff', amber: '#d29922' };
const FONT = `ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace`;
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/ /g, '\u00a0');

// Opacity timeline for an element that appears at `t` and stays until the loop fades out.
function appear(t, total, fadeAt) {
  const k = (x) => Math.min(1, Math.max(0, x / total)).toFixed(4);
  return `<animate attributeName="opacity" dur="${total}s" repeatCount="indefinite" calcMode="linear"
    values="0;0;1;1;0;0" keyTimes="0;${k(t)};${k(t + 0.25)};${k(fadeAt)};${k(fadeAt + 0.5)};1"/>`;
}

// ---------------------------------------------------------------- hero: an agent resolves a person
function hero() {
  const W = 820, H = 420, T = 15, FADE = 13.6;
  const x0 = 36;
  const rows = [];
  let y = 104;
  const row = (t, parts, dy = 26) => { rows.push({ t, y, parts }); y += dy; };
  const span = (text, fill = C.text, weight = 400) => ({ text, fill, weight });

  row(2.4, [span('⏺ ', C.purple), span('onesource_resolve', C.purple, 600), span('({ identifiers: { email: "maya.chen@tallpinesoftware.com" } })', C.dim)], 34);
  row(3.2, [span('  normalise ', C.dim), span('maya.chen@tallpinesoftware.com', C.text)]);
  row(3.9, [span('  anchor    ', C.dim), span('work_email', C.blue), span(' → hashed match key', C.dim)]);
  row(4.6, [span('  ledger    ', C.dim), span('searching 75M+ verified companies and people', C.text)]);
  const scanY = y - 4; y += 6;
  row(6.4, [span('  match     ', C.dim), span('known', C.green, 600), span(' · matched on work_email · confidence 0.97', C.text)]);
  row(7.1, [span('  conflict  ', C.dim), span('none', C.text), span('  (two records would be flagged, never merged)', C.dim)], 40);
  const resultY = y;

  const textRows = rows.map(({ t, y: ry, parts }) => {
    const tspans = parts.map((p) => `<tspan fill="${p.fill}" font-weight="${p.weight}">${esc(p.text)}</tspan>`).join('');
    return `<text x="${x0}" y="${ry}" opacity="0">${tspans}${appear(t, T, FADE)}</text>`;
  }).join('\n  ');

  const prompt = 'Who is maya.chen@tallpinesoftware.com?';
  const promptW = prompt.length * 8.7;
  const k = (s) => (s / T).toFixed(4);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}" font-size="14" role="img" aria-labelledby="t d" xml:space="preserve">
  <title id="t">An agent resolves a work email to a OneSource identity</title>
  <desc id="d">The agent calls onesource_resolve. OneSource normalises the email, turns it into a hashed match key, searches its verified ledger of more than 75 million companies and people, finds a known match on the work email with confidence 0.97 and no conflict, and returns a stable identity for Maya Chen, VP Marketing at Tallpine Software. The lookup is free and the issued ID is recorded in the ledger.</desc>
  <defs>
    <clipPath id="typing"><rect x="${x0 + 18}" y="52" height="24" width="0">
      <animate attributeName="width" dur="${T}s" repeatCount="indefinite" values="0;0;${promptW};${promptW}" keyTimes="0;${k(0.3)};${k(1.9)};1" calcMode="linear"/>
    </rect></clipPath>
    <linearGradient id="scan" x1="0" x2="1"><stop offset="0" stop-color="${C.blue}" stop-opacity="0"/><stop offset="0.5" stop-color="${C.blue}"/><stop offset="1" stop-color="${C.blue}" stop-opacity="0"/></linearGradient>
  </defs>
  <rect width="${W}" height="${H}" rx="12" fill="${C.bg}"/>
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="12" fill="none" stroke="${C.line}"/>
  <circle cx="22" cy="20" r="5" fill="#ff5f57"/><circle cx="40" cy="20" r="5" fill="#febc2e"/><circle cx="58" cy="20" r="5" fill="#28c840"/>
  <text x="${W / 2}" y="24" text-anchor="middle" fill="${C.dim}" font-size="12">your coding agent · onesource</text>
  <line x1="0" y1="38" x2="${W}" y2="38" stroke="${C.line}"/>

  <text x="${x0}" y="70" fill="${C.green}" font-weight="600">&gt;</text>
  <text x="${x0 + 18}" y="70" fill="${C.text}" clip-path="url(#typing)">${esc(prompt)}</text>

  ${textRows}

  <g opacity="0">
    <rect x="${x0 + 92}" y="${scanY + 8}" width="300" height="3" rx="1.5" fill="${C.line}"/>
    <rect x="${x0 + 92}" y="${scanY + 8}" width="70" height="3" rx="1.5" fill="url(#scan)">
      <animate attributeName="x" dur="${T}s" repeatCount="indefinite" values="${x0 + 92};${x0 + 92};${x0 + 322};${x0 + 322}" keyTimes="0;${k(4.7)};${k(6.3)};1"/>
    </rect>
    ${appear(4.6, T, 6.5)}
  </g>

  <g opacity="0">
    <rect x="${x0}" y="${resultY - 20}" width="${W - 2 * x0}" height="108" rx="8" fill="${C.panel}" stroke="${C.green}" stroke-opacity="0.6"/>
    <text x="${x0 + 16}" y="${resultY + 6}"><tspan fill="${C.green}" font-weight="600">✓ Maya Chen</tspan><tspan fill="${C.text}"> · VP Marketing · Tallpine Software</tspan></text>
    <text x="${x0 + 16}" y="${resultY + 30}"><tspan fill="${C.dim}">${esc('id     ')}</tspan><tspan fill="${C.text}">did:icustomer:global:person:7a1e0c9f3b</tspan><tspan fill="${C.dim}">${esc('  (stable)')}</tspan></text>
    <text x="${x0 + 16}" y="${resultY + 52}"><tspan fill="${C.dim}">${esc('found  ')}</tspan><tspan fill="${C.text}">true</tspan><tspan fill="${C.dim}">${esc('   ·   cost ')}</tspan><tspan fill="${C.text}">0 credits</tspan><tspan fill="${C.dim}">${esc('   ·   ledger ')}</tspan><tspan fill="${C.amber}">issued ✓</tspan></text>
    <text x="${x0 + 16}" y="${resultY + 76}" fill="${C.dim}" font-size="12">Weak evidence comes back as needs_evidence. Nothing is guessed.</text>
    ${appear(8.0, T, FADE)}
  </g>
</svg>
`;
}

// ---------------------------------------------------------------- how it works: the co-op ledger
function coop() {
  const W = 820, H = 340, T = 6;
  const ws = [
    { y: 70, name: 'Quantaflow Labs', note: 'contributes', color: C.blue, shared: true },
    { y: 150, name: 'Harborline Cloud', note: 'contributes', color: C.blue, shared: true },
    { y: 230, name: 'Meridian RevOps', note: 'keeps its keys private', color: C.dim, shared: false },
  ];
  const L = { x: 290, y: 70, w: 260, h: 200 };
  const out = { x: 612, y: 120, w: 184, h: 100 };

  const dot = (path, begin, color) => `<circle r="5" fill="${color}" opacity="0">
      <animateMotion dur="${T / 2}s" begin="${begin}s" repeatCount="indefinite" path="${path}"/>
      <animate attributeName="opacity" dur="${T / 2}s" begin="${begin}s" repeatCount="indefinite" values="0;1;1;0" keyTimes="0;0.1;0.85;1"/>
    </circle>`;

  const lanes = ws.map((w, i) => {
    const sx = 196, sy = w.y + 22;
    const ex = L.x, ey = L.y + 50 + i * 50;
    const p = w.shared ? `M${sx},${sy} C${sx + 50},${sy} ${ex - 50},${ey} ${ex},${ey}` : `M${sx},${sy} C${sx + 40},${sy} ${ex - 40},${ey} ${ex},${ey}`;
    return `<path d="${p}" fill="none" stroke="${w.color}" stroke-opacity="0.35" stroke-width="2" ${w.shared ? '' : 'stroke-dasharray="4 5"'}/>
    ${dot(p, i * 0.7, w.color)}
    <rect x="24" y="${w.y}" width="172" height="44" rx="8" fill="${C.panel}" stroke="${C.line}"/>
    <text x="40" y="${w.y + 19}" fill="${C.text}" font-size="13" font-weight="600">${w.name}</text>
    <text x="40" y="${w.y + 35}" fill="${w.shared ? C.blue : C.dim}" font-size="11">${w.note}</text>`;
  }).join('\n  ');

  const outPath = `M${L.x + L.w},${L.y + L.h / 2} C${L.x + L.w + 40},${L.y + L.h / 2} ${out.x - 40},${out.y + out.h / 2} ${out.x},${out.y + out.h / 2}`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}" role="img" aria-labelledby="t d" xml:space="preserve">
  <title id="t">How OneSource resolution works: a data co-operative feeding a verified identity ledger</title>
  <desc id="d">Workspaces that contribute send hashed identity keys into a shared identity ledger. A workspace that does not contribute keeps its keys private to itself. The ledger holds more than 75 million verified companies and people. An agent's resolve request comes back as a stable identity with its evidence, and every ID issued is recorded.</desc>
  <rect width="${W}" height="${H}" rx="12" fill="${C.bg}"/>
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="12" fill="none" stroke="${C.line}"/>
  <text x="24" y="40" fill="${C.dim}" font-size="12">DATA CO-OPERATIVE</text>
  <text x="${L.x}" y="40" fill="${C.dim}" font-size="12">VERIFIED IDENTITY LEDGER</text>
  <text x="${out.x}" y="40" fill="${C.dim}" font-size="12">YOUR AGENT</text>

  ${lanes}

  <rect x="${L.x}" y="${L.y}" width="${L.w}" height="${L.h}" rx="12" fill="${C.panel}" stroke="${C.amber}" stroke-opacity="0.7">
    <animate attributeName="stroke-opacity" dur="${T / 2}s" repeatCount="indefinite" values="0.4;0.9;0.4"/>
  </rect>
  <text x="${L.x + L.w / 2}" y="${L.y + 40}" text-anchor="middle" fill="${C.amber}" font-size="30" font-weight="700">75M+</text>
  <text x="${L.x + L.w / 2}" y="${L.y + 62}" text-anchor="middle" fill="${C.text}" font-size="12">companies and people</text>
  <g font-size="11" fill="${C.dim}">
    <text x="${L.x + 20}" y="${L.y + 100}">· one stable ID per entity</text>
    <text x="${L.x + 20}" y="${L.y + 120}">· links need evidence</text>
    <text x="${L.x + 20}" y="${L.y + 140}">· conflicts flagged, never merged</text>
    <text x="${L.x + 20}" y="${L.y + 160}">· every ID issued is recorded</text>
    <text x="${L.x + 20}" y="${L.y + 180}">· matched on hashed keys</text>
  </g>

  <path d="${outPath}" fill="none" stroke="${C.green}" stroke-opacity="0.4" stroke-width="2"/>
  ${dot(outPath, 1.2, C.green)}
  <rect x="${out.x}" y="${out.y}" width="${out.w}" height="${out.h}" rx="8" fill="${C.panel}" stroke="${C.green}" stroke-opacity="0.6"/>
  <text x="${out.x + 16}" y="${out.y + 28}" fill="${C.text}" font-size="13" font-weight="600">resolve(email)</text>
  <text x="${out.x + 16}" y="${out.y + 52}" fill="${C.green}" font-size="12">→ stable ID</text>
  <text x="${out.x + 16}" y="${out.y + 72}" fill="${C.dim}" font-size="11">+ evidence, confidence</text>
  <text x="${out.x + 16}" y="${out.y + 89}" fill="${C.dim}" font-size="11">+ what it cost</text>

  <text x="24" y="${H - 22}" fill="${C.dim}" font-size="11">Contributing workspaces strengthen the shared ledger. A workspace's own facts and outcomes never leave it.</text>
</svg>
`;
}

writeFileSync(join(OUT, 'resolve.svg'), hero());
writeFileSync(join(OUT, 'how-it-works.svg'), coop());
console.log('wrote docs/assets/resolve.svg and docs/assets/how-it-works.svg');
