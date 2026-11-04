#!/usr/bin/env node
// headersHelper for the OneSource MCP server (see ../.mcp.json).
//
// Humans sign in with OAuth: when no API key is configured this prints `{}`, no header is sent,
// the server answers 401 with its protected-resource metadata, and Claude Code offers the
// OneSource sign-in.
//
// Headless / CI use can send an API key instead. The key is looked up in this order:
//   1. ONESOURCE_API_KEY in the helper's environment. Claude Code scrubs credential-named
//      variables (anything like *_API_KEY, *_TOKEN, *_SECRET) from the environment of a
//      plugin's headersHelper, so this only works when the helper is run outside a plugin
//      (for example from a user-scoped MCP config, or by hand).
//   2. The file <ONESOURCE_CONFIG_DIR or ~/.onesource>/api-key (first line, trimmed).
//      This is the path that works for the plugin. Keep it chmod 600.
//
// The helper never fails the connection: on any problem it prints only the client label and exits
// 0, which falls back to OAuth. It never prints the key anywhere except its JSON output on stdout.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

function configDir() {
  const dir = process.env.ONESOURCE_CONFIG_DIR;
  return dir && dir.trim() ? dir.trim() : join(homedir(), '.onesource');
}

function keyFromFile() {
  try {
    const first = readFileSync(join(configDir(), 'api-key'), 'utf8').split(/\r?\n/)[0];
    return first ? first.trim() : '';
  } catch {
    return '';
  }
}

let key = '';
try {
  key = (process.env.ONESOURCE_API_KEY ?? '').trim() || keyFromFile();
} catch {
  key = '';
}

// The client label is not a credential: it only tells the OneSource console that a call came
// from this plugin, and is sent with OAuth sign-in too.
const headers = { 'x-onesource-client': 'plugin/0.1.0' };

if (key) headers['x-api-key'] = key;

process.stdout.write(JSON.stringify(headers));
process.exit(0);
