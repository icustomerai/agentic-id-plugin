#!/usr/bin/env node
// Live check of `agentic-id login` against a real Agentic ID API whose login page signs in without
// a person (the stand-in FusionAuth from agentic-id-v3/apps/edge/test). Not for a real login page.
//   AGENTIC_ID_URL=http://localhost:3992 node test/signin-live.mjs
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN = join(dirname(fileURLToPath(import.meta.url)), '../cli/agentic-id');
const URL_ = process.env.AGENTIC_ID_URL;
if (!URL_) { console.error('Set AGENTIC_ID_URL.'); process.exit(2); }
const cfg = mkdtempSync(join(tmpdir(), 'aid-live-'));
const env = { PATH: process.env.PATH, HOME: process.env.HOME, AGENTIC_ID_URL: URL_, AGENTIC_ID_CONFIG_DIR: cfg, AGENTIC_ID_NO_BROWSER: '1' };
let failures = 0;
const check = (ok, label, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`); if (!ok) failures += 1; };
const run = (...args) => spawnSync(BIN, args, { env, encoding: 'utf8' });

const before = run('status');
check(before.status === 2 && /agentic-id login/.test(before.stdout + before.stderr), 'signed out: status says to log in');

const child = spawn(BIN, ['login'], { env });
let out = '';
child.stderr.on('data', (d) => (out += d));
const exit = new Promise((r) => child.on('exit', r));
let followed = false;
child.stdout.on('data', (d) => {
  out += d;
  const link = out.match(/https?:\/\/\S+\/oauth\/authorize\?\S+/)?.[0];
  if (link && !followed) { followed = true; void fetch(link).catch(() => {}); } // the "browser"
});
const code = await exit;
check(code === 0 && /Signed in\. Connected to .* as workspace ws_u_[a-z0-9]+ \(signed in\)/.test(out), 'login completes and reports the workspace', out.trim().split('\n').pop());
const file = join(cfg, 'session.json');
check((statSync(file).mode & 0o777) === 0o600, 'session file is readable by the user only');
const session = Object.values(JSON.parse(readFileSync(file, 'utf8')))[0];
check(!out.includes(session.access_token) && !out.includes(session.refresh_token), 'tokens are never printed');

const st = run('status', '--json');
const s = JSON.parse(st.stdout || '{}');
check(st.status === 0 && s.auth === 'signin' && /^ws_u_/.test(s.workspace_id), 'status works with the sign-in', s.summary);
const count = run('discover', '--country', 'GB', '--industry', 'software', '--count', '--json');
check(count.status === 0 && JSON.parse(count.stdout).cost?.charged_credits === 0, 'a real call works with the sign-in (free count)', JSON.parse(count.stdout || '{}').summary);
const doc = run('doctor');
check(doc.status === 0 && /Signed in/.test(doc.stdout), 'doctor passes when signed in');

check(run('logout').status === 0, 'logout');
const after = run('status');
check(after.status === 2, 'after logout the stored sign-in is gone');
rmSync(cfg, { recursive: true, force: true });
console.log(failures ? `\n${failures} check(s) failed` : '\nsign-in live: all checks passed');
process.exit(failures ? 1 : 0);
