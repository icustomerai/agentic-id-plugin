#!/usr/bin/env node
// Pre-submission check for the Claude plugin directory.
//
// Runs the automated checks from https://claude.com/docs/plugins/pre-submission-checklist against
// one plugin folder, so problems show up in CI instead of in the developer portal. `claude plugin
// validate` covers syntax and schema; this covers the directory's own rules on top.
//
//   node test/directory-check.mjs [plugin-folder]     default: plugins/agentic-id
//   node test/directory-check.mjs --strict            also fail on "held for a reviewer"
//
// Results use the portal's words:
//   BLOCK  the portal won't accept the submission until it's fixed
//   STOP   the portal can't validate the repository at all
//   HOLD   you can submit, and an Anthropic reviewer reads the version before it goes live
//   WARN   shown in the report; you can submit
//   NOTE   information only
//
// The portal stays the source of truth: the brand, name-taken and security-scan checks need its
// data and can't run here. No network, no credentials.
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const strict = args.includes('--strict');
const PLUGIN = resolve(ROOT, args.find((a) => !a.startsWith('--')) ?? 'plugins/agentic-id');
const rel = (p) => relative(PLUGIN, p) || '.';

const findings = [];
const add = (level, rule, detail = '') => findings.push({ level, rule, detail });

const KiB = 1024;
const MiB = 1024 * KiB;
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);
const FONT_EXT = new Set(['.woff', '.woff2', '.ttf', '.otf']);
const LAUNCHERS = [/\bnpx\b/, /\bbunx\b/, /\bpnpm\s+dlx\b/, /\byarn\s+dlx\b/, /\buvx\b/, /\bpipx\s+run\b/, /\buv\s+run\b/];
const PKG_CONFIG = new Set(['.npmrc', '.yarnrc', '.yarnrc.yml', 'bunfig.toml', 'uv.toml', 'pip.conf', 'pip.ini', '.pypirc']);
const LOCKFILES = ['package-lock.json', 'npm-shrinkwrap.json', 'bun.lock', 'bun.lockb'];
const JUNK = new Set(['.ds_store', 'thumbs.db', 'desktop.ini', '__macosx']);
const WINDOWS_DEVICES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
const HOOK_EVENTS = new Set([
  'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PostToolBatch', 'PermissionRequest', 'PermissionDenied', 'Notification',
  'UserPromptSubmit', 'UserPromptExpansion', 'Stop', 'StopFailure', 'SubagentStart', 'SubagentStop', 'PreCompact', 'PostCompact',
  'SessionStart', 'SessionEnd', 'Setup', 'TeammateIdle', 'TaskCreated', 'TaskCompleted', 'Elicitation', 'ElicitationResult',
  'ConfigChange', 'WorktreeCreate', 'WorktreeRemove', 'InstructionsLoaded', 'CwdChanged', 'FileChanged',
]);
const SECRET_PATTERNS = [
  /ic-(live|test|dev)-[A-Za-z0-9_-]{12,}/, // Agentic ID API keys
  /os_(live|test)_[A-Za-z0-9]{12,}/, // onesource-api (v2) keys
  /sk-(ant-)?[A-Za-z0-9_-]{24,}/, // Anthropic / OpenAI style keys
  /gh[pousr]_[A-Za-z0-9]{30,}/, // GitHub tokens
  /AKIA[0-9A-Z]{16}/, // AWS access key ids
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /xox[abpr]-[A-Za-z0-9-]{10,}/, // Slack tokens
];

// ---------------------------------------------------------------------------------------------
// Files: what the portal will see. Prefer git (tracked plus untracked-but-not-ignored files);
// fall back to walking the folder when this isn't a git checkout.

function listFiles() {
  try {
    const out = execFileSync('git', ['-C', PLUGIN, 'ls-files', '-co', '--exclude-standard', '-z', '.'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out.split('\0').filter(Boolean).map((p) => join(PLUGIN, p)).filter((p) => existsSync(p) || lstatSync(p, { throwIfNoEntry: false }));
  } catch {
    const out = [];
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        const st = lstatSync(full);
        if (st.isDirectory()) walk(full);
        else out.push(full);
      }
    };
    walk(PLUGIN);
    return out;
  }
}

const read = (p) => readFileSync(p, 'utf8');
const readJson = (p, label) => {
  try {
    return JSON.parse(read(p));
  } catch (error) {
    add('BLOCK', `${label} can't be parsed`, error.message);
    return null;
  }
};

if (!existsSync(join(PLUGIN, '.claude-plugin/plugin.json'))) {
  add('BLOCK', 'The folder has no .claude-plugin/plugin.json', rel(PLUGIN));
  report();
}

const files = listFiles();

// ---------------------------------------------------------------------------------------------
// Repository and folder layout

const pathFromRoot = relative(ROOT, PLUGIN);
for (const part of pathFromRoot.split(sep).filter(Boolean)) {
  if (!/^[A-Za-z0-9._-]+$/.test(part)) add('STOP', 'Folder names on the path to the plugin use letters, digits, dots, hyphens and underscores only', part);
}

const seenLower = new Map();
for (const file of files) {
  const r = rel(file);
  const st = lstatSync(file);

  if (st.isSymbolicLink()) add('BLOCK', 'Symbolic link in the plugin folder', r);
  for (const part of r.split(sep)) {
    if (JUNK.has(part.toLowerCase())) add('BLOCK', 'This is a macOS or Windows system file', r);
    if (/[:]/.test(part) || /[. ]$/.test(part) || WINDOWS_DEVICES.test(part)) add('STOP', "File name isn't valid on both Windows and macOS", r);
  }

  const lower = r.toLowerCase();
  if (seenLower.has(lower) && seenLower.get(lower) !== r) add('STOP', 'Two names differ only by capitalization', `${seenLower.get(lower)} / ${r}`);
  seenLower.set(lower, r);
}

for (const ga of files.filter((f) => basename(f) === '.gitattributes').concat([join(ROOT, '.gitattributes')]).filter(existsSync)) {
  const text = read(ga);
  if (/\bexport-(ignore|subst)\b/.test(text)) add('STOP', '.gitattributes uses export-ignore or export-subst', relative(ROOT, ga));
  if (/\bfilter=/.test(text)) add('STOP', '.gitattributes sets a filter (Git LFS included)', relative(ROOT, ga));
}

// Repository as GitHub would archive it (tracked files only).
try {
  const tracked = execFileSync('git', ['-C', ROOT, 'ls-files', '-z'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\0').filter(Boolean);
  const bytes = tracked.reduce((sum, p) => sum + (lstatSync(join(ROOT, p), { throwIfNoEntry: false })?.size ?? 0), 0);
  if (tracked.length >= 10000) add('STOP', 'Repository has 10,000 or more files', String(tracked.length));
  if (bytes > 256 * MiB) add('STOP', 'Repository is over 256 MiB unpacked', `${(bytes / MiB).toFixed(1)} MiB`);
  add('NOTE', 'Repository size', `${tracked.length} tracked files, ${(bytes / MiB).toFixed(2)} MiB`);
} catch {
  add('NOTE', 'Not a git checkout; repository size not checked');
}

// ---------------------------------------------------------------------------------------------
// Files in the plugin folder

if (files.length > 512) add('HOLD', 'More than 512 files in the plugin folder', String(files.length));

for (const file of files) {
  const r = rel(file);
  const st = lstatSync(file);
  if (!st.isFile()) continue;

  const ext = extname(file).toLowerCase();
  const media = IMAGE_EXT.has(ext) || FONT_EXT.has(ext);
  const buf = readFileSync(file);
  const binary = buf.subarray(0, 8000).includes(0);

  if (st.size > 5 * MiB) add('STOP', 'File over 5 MiB', r);
  else if (!media && st.size > 256 * KiB) add('HOLD', 'File over 256 KiB', `${r} (${(st.size / KiB).toFixed(0)} KiB)`);
  if (binary && !media) add('HOLD', "Binary file the validator can't inspect", r);
  if (ext === '.mcpb' || ext === '.dxt') add('HOLD', 'Bundled MCP server not inspected', r);
  if (/\.lfs\b|^version https:\/\/git-lfs/.test(binary ? '' : buf.subarray(0, 200).toString('utf8'))) add('BLOCK', 'Git LFS pointer file', r);

  if (!binary) {
    const text = buf.toString('utf8');
    for (const re of SECRET_PATTERNS) {
      const m = text.match(re);
      if (m) add('BLOCK', 'Credential-looking value in a file', `${r}: ${m[0].slice(0, 12)}…`);
    }
    if (/\.(m?js|cjs)$/.test(file) && text.split('\n').some((l) => l.length > 1000)) add('HOLD', 'Minified or packed code (a line over 1,000 characters)', r);
  }
}

// ---------------------------------------------------------------------------------------------
// Manifest and plugin name

const manifest = readJson(join(PLUGIN, '.claude-plugin/plugin.json'), 'plugin.json') ?? {};
const name = String(manifest.name ?? '');

if (/[^\x00-\x7f]/.test(name)) add('BLOCK', 'Non-ASCII identifier', name);
else if (!/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(name)) add('WARN', 'Name breaks the pattern: lowercase letters, digits and hyphens, up to 64, starting and ending with a letter or digit', name);
if (['claude', 'anthropic', 'official', 'plugin', 'mcp', 'test'].includes(name)) add('BLOCK', 'Name is a reserved word', name);
if (/(^|-)(claude|anthropic|official)(-|$)/.test(name)) add('HOLD', 'Name may present the plugin as official or as Anthropic', name);
if (/^(test|demo|example|my)-?(plugin|mcp|tools?)?$/.test(name)) add('HOLD', 'Name made only of generic words', name);

for (const [field, value] of [['displayName', manifest.displayName], ['author.name', manifest.author?.name]]) {
  if (typeof value !== 'string') continue;
  if (/[​-‏⁠-⁤﻿]/.test(value)) add('BLOCK', `${field} contains invisible characters`, value);
  const scripts = new Set([...value].filter((c) => /\p{L}/u.test(c)).map((c) => (/\p{Script=Latin}/u.test(c) ? 'Latin' : /\p{Script=Cyrillic}/u.test(c) ? 'Cyrillic' : /\p{Script=Greek}/u.test(c) ? 'Greek' : 'other')));
  if (scripts.size > 1) add('BLOCK', `${field} mixes writing systems (look-alike letters)`, value);
}

for (const key of ['hooks', 'mcpServers', 'commands', 'agents', 'skills', 'lspServers', 'outputStyles']) {
  if (manifest.experimental && key in manifest.experimental && key !== 'monitors') add('BLOCK', `"${key}" declared inside "experimental"`);
}
for (const [key, value] of Object.entries(manifest)) {
  const paths = [value].flat().filter((v) => typeof v === 'string');
  for (const p of paths) if (p.includes('..')) add('BLOCK', 'Path climbs out of the plugin', `${key}: ${p}`);
}
if (manifest.hooks === './hooks/hooks.json' || (Array.isArray(manifest.hooks) && manifest.hooks.includes('./hooks/hooks.json'))) {
  add('WARN', 'plugin.json names hooks/hooks.json, which Claude Code loads on its own');
}
for (const field of ['description', 'author', 'version']) if (!manifest[field]) add('WARN', `plugin.json has no ${field}`);

// ---------------------------------------------------------------------------------------------
// README and license

const readme = ['README.md', 'README', 'README.markdown', 'readme.md'].map((n) => join(PLUGIN, n)).find(existsSync);
if (!readme) add('BLOCK', 'README missing', 'add README.md to the plugin folder');
else {
  const prose = read(readme).replace(/```[\s\S]*?```/g, ' ').replace(/~~~[\s\S]*?~~~/g, ' ').replace(/<!--[\s\S]*?-->/g, ' ');
  const words = (prose.match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu) ?? []).length;
  if (words < 40) add('BLOCK', 'README too short', `${words} words outside code blocks; 40 needed`);
  else add('NOTE', 'README', `${rel(readme)}, ${words} words outside code blocks`);
  for (const m of read(readme).matchAll(/<img[^>]+src=["']([^"']+)["']/gi)) {
    if (!/^https?:/.test(m[1])) add('HOLD', 'README shows a bundled image with HTML; use Markdown image syntax', m[1]);
  }
}
if (!existsSync(join(PLUGIN, 'LICENSE')) && !manifest.license) add('BLOCK', 'License missing', 'add LICENSE or set "license" in plugin.json');

// ---------------------------------------------------------------------------------------------
// What the plugin runs and connects to

const declared = new Set(Object.keys(manifest.userConfig ?? {}));
const userRefs = (text) => [...String(text).matchAll(/\$\{user_config\.([A-Za-z_][A-Za-z0-9_]*)\}/g)].map((m) => m[1]);
const otherVars = (text) => [...String(text).matchAll(/\$\{?([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]).filter((v) => v !== 'CLAUDE_PLUGIN_ROOT' && v !== 'user_config');

for (const [key, option] of Object.entries(manifest.userConfig ?? {})) {
  if (/key|token|secret|password/i.test(key) && option.sensitive !== true) add('BLOCK', 'A credential option must set "sensitive": true', key);
  if (option.sensitive && typeof option.default === 'string' && option.default.length > 0) add('BLOCK', 'A sensitive option ships a default value', key);
}

function checkCommand(where, command, args = []) {
  const line = [command, ...args].join(' ');
  if (/\$\(|`/.test(line)) add('BLOCK', "Command path can't be followed (command substitution)", `${where}: ${line}`);
  if (/[*?]/.test(line.replace(/\$\{[^}]*\}/g, ''))) add('BLOCK', "Command path can't be followed (wildcard)", `${where}: ${line}`);
  if (/\s-(c|e|-eval)\s/.test(` ${line} `)) add('BLOCK', "Command path can't be followed (inline program)", `${where}: ${line}`);
  if (/(^|[\s"'/])\.\.\//.test(line)) add('BLOCK', 'Command reaches above the plugin folder', `${where}: ${line}`);
  const vars = otherVars(line);
  if (vars.length) add('BLOCK', `Command path can't be followed (variable ${vars.map((v) => '$' + v).join(', ')})`, `${where}: ${line}`);

  for (const re of LAUNCHERS) {
    if (!re.test(line)) continue;
    const pinned = /@\d+\.\d+\.\d+(\s|$)|==\d+(\.\d+)*(\s|$)|--locked|--frozen/.test(line);
    add(pinned ? 'HOLD' : 'BLOCK', pinned ? 'Runs a pinned package from a registry' : 'Unpinned package launcher', `${where}: ${line}`);
  }
  if (/^\s*(sh|bash|zsh)\b|\bnpm\s+run\b|\bpnpm\s+run\b|\byarn\s+run\b/.test(line)) add('HOLD', "MCP server or hook command wasn't read (runs through a shell or package script)", `${where}: ${line}`);

  const runsFile = line.match(/\$\{CLAUDE_PLUGIN_ROOT\}\/[^\s"']+/g) ?? [];
  for (const target of runsFile) {
    const file = join(PLUGIN, target.replace('${CLAUDE_PLUGIN_ROOT}/', ''));
    if (!existsSync(file)) add('BLOCK', 'Command runs a file that is not in the plugin', `${where}: ${target}`);
    else if (!/\.(sh|bash)$/.test(file)) add('HOLD', "Scripts the validator couldn't follow (runs a non-shell file)", `${where}: ${relative(PLUGIN, file)}`);
  }
}

const mcpPath = join(PLUGIN, '.mcp.json');
let usesLauncher = false;
if (existsSync(mcpPath)) {
  const mcp = readJson(mcpPath, '.mcp.json');
  for (const [server, cfg] of Object.entries(mcp?.mcpServers ?? {})) {
    const where = `.mcp.json ${server}`;
    for (const ref of userRefs(JSON.stringify(cfg))) if (!declared.has(ref)) add('BLOCK', `References undeclared option user_config.${ref}`, where);

    if (cfg.url !== undefined || ['http', 'sse', 'ws'].includes(cfg.type)) {
      if (!['http', 'sse', 'ws'].includes(cfg.type)) add('BLOCK', 'Remote MCP server needs type http, sse or ws', where);
      const url = String(cfg.url ?? '');
      const ok = url === '' || /^(https|wss):\/\/\S+$/.test(url) || /^\$\{user_config\.[A-Za-z_][A-Za-z0-9_]*\}$/.test(url);
      if (!ok) add('BLOCK', 'MCP server URL is not https', `${where}: ${url}`);
      for (const [header, value] of Object.entries(cfg.headers ?? {})) {
        const v = String(value);
        const isRef = /^\$\{user_config\.[A-Za-z_][A-Za-z0-9_]*\}$/.test(v);
        if (!isRef && /auth|key|token|secret|cookie/i.test(header) && v) add('BLOCK', 'Secret in MCP headers', `${where}: ${header}`);
        if (!isRef && otherVars(v).length) add('HOLD', "Uses a credential from the user's machine", `${where}: ${header}`);
        if (isRef && /auth|key|token|secret/i.test(header) && manifest.userConfig?.[userRefs(v)[0]]?.sensitive !== true) add('BLOCK', 'Credential header comes from a non-sensitive option', `${where}: ${header}`);
      }
      if (cfg.headersHelper) {
        add('HOLD', "headersHelper runs a program to build headers; if it reads a credential from the user's machine it's held", `${where}`);
        checkCommand(`${where} headersHelper`, cfg.headersHelper);
      }
    } else if (cfg.command) {
      checkCommand(where, cfg.command, cfg.args ?? []);
      if (LAUNCHERS.some((re) => re.test([cfg.command, ...(cfg.args ?? [])].join(' ')))) usesLauncher = true;
    }
  }
}

const hooksPath = join(PLUGIN, 'hooks/hooks.json');
if (existsSync(hooksPath)) {
  const hooks = readJson(hooksPath, 'hooks.json is invalid');
  if (hooks && typeof hooks.hooks !== 'object' && !Array.isArray(hooks.modules)) add('BLOCK', 'hooks.json needs a top-level "hooks" object or a "modules" array');
  for (const [event, groups] of Object.entries(hooks?.hooks ?? {})) {
    if (!HOOK_EVENTS.has(event)) add('BLOCK', 'Unknown hook event', event);
    for (const group of groups ?? []) {
      for (const h of group.hooks ?? []) {
        if (h.type === 'http' && !/^https:\/\//.test(String(h.url ?? ''))) add('BLOCK', 'HTTP hook URL is not https', `${event}: ${h.url}`);
        if (h.type === 'command') {
          checkCommand(`hook ${event}`, h.command ?? '', h.args ?? []);
          if (LAUNCHERS.some((re) => re.test(String(h.command)))) usesLauncher = true;
        }
      }
    }
  }
}

// `!` lines in commands and skills run when the command or skill loads.
for (const file of files.filter((f) => /\/(commands|skills)\//.test(f) && f.endsWith('.md'))) {
  for (const m of read(file).matchAll(/!`([^`]+)`/g)) checkCommand(`${rel(file)} !-line`, m[1].replace(/\s\$ARGUMENTS\b|\$ARGUMENTS\b|\$\d\b/g, ''));
}

for (const file of files) {
  if (PKG_CONFIG.has(basename(file))) add(usesLauncher ? 'BLOCK' : 'WARN', 'Package-manager configuration file that may set a registry', rel(file));
}
if (existsSync(join(PLUGIN, 'package.json')) && LOCKFILES.some((l) => existsSync(join(PLUGIN, l)))) add('HOLD', 'Dependencies install from a lockfile');

// ---------------------------------------------------------------------------------------------
// Hooks, skills, commands and agents: names and front matter

for (const dir of readdirSync(PLUGIN)) {
  const want = ['skills', 'commands', 'agents', 'hooks', 'scripts', 'evals', 'output-styles'].find((d) => d.toLowerCase() === dir.toLowerCase());
  if (want && want !== dir) add('BLOCK', 'Component folder has the wrong capitalization', `${dir} (expected ${want})`);
}
if (existsSync(join(PLUGIN, 'skills'))) {
  for (const skill of readdirSync(join(PLUGIN, 'skills'))) {
    const entries = readdirSync(join(PLUGIN, 'skills', skill));
    const md = entries.find((e) => e.toLowerCase() === 'skill.md');
    if (!md) add('BLOCK', 'Skill folder without SKILL.md', `skills/${skill}`);
    else if (md !== 'SKILL.md') add('BLOCK', 'Skill file must be named SKILL.md', `skills/${skill}/${md}`);
  }
}

// A deliberately small front-matter reader: enough to catch the failures the portal blocks on (no
// closing fence, a description that is a list or empty, a plain scalar YAML would refuse).
const componentFiles = files.filter((f) => /\/skills\/[^/]+\/SKILL\.md$|\/agents\/[^/]+\.md$|\/commands\/[^/]+\.md$/.test(f));
for (const file of componentFiles) {
  const text = read(file);
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!m) {
    add(text.startsWith('---') ? 'BLOCK' : 'WARN', text.startsWith('---') ? "Front matter doesn't parse (no closing ---)" : 'No front matter', rel(file));
    continue;
  }
  const lines = m[1].split(/\r?\n/);
  const i = lines.findIndex((l) => /^description\s*:/.test(l));
  if (i < 0) {
    add('WARN', 'No description in front matter', rel(file));
    continue;
  }
  const value = lines[i].replace(/^description\s*:\s*/, '');
  const next = lines[i + 1] ?? '';
  if (value === '' && /^\s+-\s/.test(next)) add('BLOCK', 'description is a list, not text', rel(file));
  else if (value === '' && !/^\s+\S/.test(next)) add('BLOCK', 'description is empty', rel(file));
  else if (/^[[{]/.test(value)) add('BLOCK', 'description is not text', rel(file));
  else if (!/^["'|>]/.test(value) && (/:\s/.test(value) || /\s#/.test(value) || /^[&*!%@`]/.test(value))) {
    add('BLOCK', "Front matter doesn't parse: quote the description (it contains ': ', ' #' or starts with a YAML indicator)", rel(file));
  }
}

report();

// ---------------------------------------------------------------------------------------------

function report() {
  const order = ['STOP', 'BLOCK', 'HOLD', 'WARN', 'NOTE'];
  const seen = new Set();
  const unique = findings.filter((f) => {
    const k = `${f.level}|${f.rule}|${f.detail}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  unique.sort((a, b) => order.indexOf(a.level) - order.indexOf(b.level));
  console.log(`Directory pre-submission check: ${relative(ROOT, PLUGIN) || '.'}`);
  for (const f of unique) console.log(`  ${f.level.padEnd(5)}  ${f.rule}${f.detail ? ` — ${f.detail}` : ''}`);
  const count = (lvl) => unique.filter((f) => f.level === lvl).length;
  const failing = count('STOP') + count('BLOCK') + (strict ? count('HOLD') : 0);
  console.log(`  ${count('STOP')} stop, ${count('BLOCK')} block, ${count('HOLD')} held for a reviewer, ${count('WARN')} warning(s)${strict ? ' (strict)' : ''}`);
  process.exit(failing ? 1 : 0);
}
