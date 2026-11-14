#!/usr/bin/env node
// SessionStart hook: makes the `agentic-id` command available to the session's shell commands by
// putting this plugin's scripts/ folder on PATH. It writes one line to the file Claude Code names
// in CLAUDE_ENV_FILE and nothing else. Where that file is not offered (some hosts), it does
// nothing, and the command is still reachable by its full path, which the skills give.
import { appendFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function pathLine(scriptsDir) {
  // Single quotes keep the folder literal; $PATH stays unquoted so the shell expands it.
  return `export PATH='${scriptsDir.replace(/'/g, `'\\''`)}':"$PATH"`;
}

export function addToPath(envFile, scriptsDir) {
  if (!envFile) return false;
  const line = pathLine(scriptsDir);
  try {
    if (readFileSync(envFile, 'utf8').includes(line)) return false; // a resumed session: already there
  } catch {
    /* no file yet */
  }
  appendFileSync(envFile, `${line}\n`);
  return true;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    addToPath(process.env.CLAUDE_ENV_FILE, join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts'));
  } catch {
    /* never fail a session over a convenience */
  }
}
