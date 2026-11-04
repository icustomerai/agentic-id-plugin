// Unit tests for plugins/onesource/hooks/log-usage.mjs and the headers helper.
// Run with: node --test test/
// Fixtures use fake markers and request ids only; no real people, emails or keys.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const hook = join(root, 'plugins/onesource/hooks/log-usage.mjs');
const helper = join(root, 'plugins/onesource/scripts/api-key-headers.mjs');
const summary = join(root, 'plugins/onesource/scripts/usage-summary.mjs');
const fixture = (name) => readFileSync(join(here, 'fixtures', name), 'utf8');

function cleanEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  delete env.ONESOURCE_API_KEY;
  return { ...env, ...extra };
}

function runHook(stdin, configDir) {
  return spawnSync(process.execPath, [hook], {
    input: stdin,
    env: cleanEnv({ ONESOURCE_CONFIG_DIR: configDir }),
    encoding: 'utf8',
  });
}

function readLog(configDir) {
  const file = join(configDir, 'usage.jsonl');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

const tmp = () => mkdtempSync(join(tmpdir(), 'onesource-test-'));

test('validate with structuredContent logs tool, request id and credits', () => {
  const dir = tmp();
  const res = runHook(fixture('validate-structured.json'), dir);
  assert.equal(res.status, 0);
  assert.equal(res.stdout, '');
  const [rec, ...rest] = readLog(dir);
  assert.equal(rest.length, 0);
  assert.equal(rec.tool, 'validate');
  assert.equal(rec.server, 'plugin_onesource_onesource');
  assert.equal(rec.ok, true);
  assert.equal(rec.request_id, 'req-fixture-0001');
  assert.equal(rec.quoted_credits, 1);
  assert.equal(rec.credits_charged, 1);
  assert.equal(rec.session_id, 'sess-fixture-0001');
  assert.match(rec.ts, /^\d{4}-\d{2}-\d{2}T/);
});

test('find with a text-only content array parses the JSON after the summary line', () => {
  const dir = tmp();
  assert.equal(runHook(fixture('find-text-only.json'), dir).status, 0);
  const [rec] = readLog(dir);
  assert.equal(rec.tool, 'find');
  assert.equal(rec.server, 'onesource');
  assert.equal(rec.request_id, 'req-fixture-0002');
  assert.equal(rec.quoted_credits, 10);
  assert.equal(rec.credits_charged, 3);
});

test('discover with a JSON string response', () => {
  const dir = tmp();
  assert.equal(runHook(fixture('discover-string.json'), dir).status, 0);
  const [rec] = readLog(dir);
  assert.equal(rec.tool, 'discover');
  assert.equal(rec.credits_charged, 2);
  assert.equal(rec.request_id, null);
});

test('error result logs the error code and zero credits', () => {
  const dir = tmp();
  assert.equal(runHook(fixture('enrich-error.json'), dir).status, 0);
  const [rec] = readLog(dir);
  assert.equal(rec.tool, 'enrich');
  assert.equal(rec.ok, false);
  assert.equal(rec.error, 'credit_cap_reached');
  assert.equal(rec.credits_charged, 0);
});

test('non-OneSource tools are ignored', () => {
  const dir = tmp();
  assert.equal(runHook(fixture('unrelated-tool.json'), dir).status, 0);
  assert.deepEqual(readLog(dir), []);
});

test('no input or output values reach the log (no PII)', () => {
  const dir = tmp();
  for (const f of readdirSync(join(here, 'fixtures'))) runHook(fixture(f), dir);
  const text = readFileSync(join(dir, 'usage.jsonl'), 'utf8');
  assert.equal(readLog(dir).length, 4);
  for (const marker of ['FAKE-INPUT-MARKER', 'FAKE-OUTPUT-MARKER', 'FAKE-SUMMARY-MARKER', 'Raise max_credits']) {
    assert.ok(!text.includes(marker), `log must not contain ${marker}`);
  }
  const allowed = new Set(['ts', 'session_id', 'server', 'tool', 'ok', 'error', 'request_id', 'quoted_credits', 'credits_charged']);
  for (const rec of readLog(dir)) for (const k of Object.keys(rec)) assert.ok(allowed.has(k), `unexpected key ${k}`);
});

test('garbage stdin, empty stdin and an unwritable log dir never fail the hook', () => {
  const dir = tmp();
  for (const input of ['not json', '', '{"tool_name": 42}', 'null']) {
    const res = runHook(input, dir);
    assert.equal(res.status, 0, `input ${JSON.stringify(input)}`);
    assert.equal(res.stdout, '');
  }
  const blocker = join(tmp(), 'a-file');
  writeFileSync(blocker, 'x');
  const res = runHook(fixture('validate-structured.json'), join(blocker, 'sub'));
  assert.equal(res.status, 0);
});

test('usage summary prints credits per tool and recent calls', () => {
  const dir = tmp();
  for (const f of readdirSync(join(here, 'fixtures'))) runHook(fixture(f), dir);
  const res = spawnSync(process.execPath, [summary], { env: cleanEnv({ ONESOURCE_CONFIG_DIR: dir }), encoding: 'utf8' });
  assert.equal(res.status, 0);
  assert.match(res.stdout, /\| find \| 1 \| 0 \| 10 \| 3 \|/);
  assert.match(res.stdout, /\| \*\*total\*\* \| 4 \| 1 \| 13 \| 6 \|/);
  assert.match(res.stdout, /Last 4 calls/);
  const empty = spawnSync(process.execPath, [summary], { env: cleanEnv({ ONESOURCE_CONFIG_DIR: tmp() }), encoding: 'utf8' });
  assert.equal(empty.status, 0);
  assert.match(empty.stdout, /No OneSource usage logged yet/);
});

test('headers helper: no key -> {} (OAuth), env key or key file -> x-api-key', () => {
  const run = (env) => spawnSync(process.execPath, [helper], { env: cleanEnv(env), encoding: 'utf8' });
  const none = run({ ONESOURCE_CONFIG_DIR: tmp() });
  assert.equal(none.status, 0);
  assert.deepEqual(JSON.parse(none.stdout), {});

  const fromEnv = run({ ONESOURCE_CONFIG_DIR: tmp(), ONESOURCE_API_KEY: 'dummy-test-value' });
  assert.deepEqual(JSON.parse(fromEnv.stdout), { 'x-api-key': 'dummy-test-value' });

  const dir = tmp();
  writeFileSync(join(dir, 'api-key'), '  dummy-file-value  \n');
  chmodSync(join(dir, 'api-key'), 0o600);
  const fromFile = run({ ONESOURCE_CONFIG_DIR: dir });
  assert.deepEqual(JSON.parse(fromFile.stdout), { 'x-api-key': 'dummy-file-value' });
});
