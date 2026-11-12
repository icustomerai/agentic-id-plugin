// A whole file in one tool call, run inside the plugin's own server process.
//
// Why a tool and not only the `agentic-id` command: Claude Code keeps an API key set in the
// plugin options away from shell commands, so the command cannot use it. The server can. The
// rows are read from and written to disk here and never pass through the conversation.
import { existsSync, statSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { main } from '../cli.mjs';
import { AgenticIdError } from './client.mjs';
import { LocalRefusal } from './operations.mjs';

const ACTIONS = ['validate', 'resolve', 'enrich', 'report'];
const MAX_BYTES = 20 * 1024 * 1024;

export async function list(client, args = {}) {
  const action = String(args.action ?? '');
  if (!ACTIONS.includes(action)) throw new LocalRefusal('request.invalid', `action must be one of ${ACTIONS.join(', ')}.`, 'validate checks emails, resolve finds duplicates and IDs, enrich fills in fields, report sends outcomes.');
  if (typeof args.file !== 'string' || !args.file.trim()) throw new LocalRefusal('request.invalid', 'Give the path of the CSV file.', 'An absolute path is safest.');
  const file = isAbsolute(args.file) ? args.file : resolve(process.cwd(), args.file);
  if (!existsSync(file) || !statSync(file).isFile()) throw new LocalRefusal('file_not_found', `No such file: ${file}`, 'Give the full path of the CSV file.');
  if (statSync(file).size > MAX_BYTES) throw new LocalRefusal('file_too_large', `${basename(file)} is over 20 MB.`, 'Split the file, or use --limit-rows with the agentic-id command in a terminal.');
  const out = args.out ? (isAbsolute(args.out) ? args.out : resolve(process.cwd(), args.out)) : join(dirname(file), `${basename(file, extname(file))}.agentic-id.csv`);
  if (resolve(out) === resolve(file)) throw new LocalRefusal('request.invalid', 'The result file must not be the input file.', 'Leave "out" empty to write next to the input.');
  if (extname(out).toLowerCase() !== '.csv') throw new LocalRefusal('request.invalid', 'The result file must end in .csv.', 'Leave "out" empty to write next to the input.');

  const argv = [action, '--file', file, '--out', out];
  if (args.dry_run) argv.push('--dry-run');
  if (args.max_credits !== undefined) argv.push('--max-credits', String(args.max_credits));
  if (args.fields?.length) argv.push('--fields', [].concat(args.fields).join(','));
  if (args.column) argv.push('--column', String(args.column));
  for (const [k, flag] of Object.entries({ email: '--email-column', linkedin: '--linkedin-column', name: '--name-column', company: '--company-column', domain: '--domain-column' })) {
    if (args.columns?.[k]) argv.push(flag, String(args.columns[k]));
  }
  if (args.limit_rows !== undefined) argv.push('--limit-rows', String(args.limit_rows));
  if (args.purpose) argv.push('--purpose', String(args.purpose));
  if (args.field && action === 'report') argv.push('--field', String(args.field));

  const lines = [];
  let done;
  const say = (s) => void lines.push(String(s));
  const io = { out: say, err: say, done: (d) => void (done = d) };
  // The CLI returns its exit code; a dry run returns nothing, which is a success.
  const code = (await main(argv, io, client)) ?? 0;
  const text = lines.join('\n').trim();
  if (args.dry_run && code === 0) return { dry_run: true, summary: text, cost: { quoted_credits: 0, charged_credits: 0 }, file };
  if (code !== 0 && !done) {
    const needsCap = /needs --max-credits/.test(text);
    const refusal = needsCap ? 'cap_required' : ({ 1: 'request.invalid', 2: 'auth.invalid_key', 3: 'cap_required', 4: 'list_failed', 5: 'unreachable' }[code] ?? 'list_failed');
    // Say it in the tool's own words, not the command's flags.
    const e = new AgenticIdError(0, refusal, (text || `The file run failed (exit ${code}).`).replace(/A file run needs --max-credits\./, 'A paid file run needs max_credits.').replace(/--([a-z]+)-column/g, 'columns.$1').replace(/--column/g, 'column'));
    e.local = code === 1 || code === 3;
    if (needsCap) e.fix = 'Run it once with dry_run: true to get the estimate, show the user the arithmetic, then call again with max_credits.';
    throw e;
  }
  return {
    summary: `${done?.summary ?? text} Result written to ${out}.`,
    cost: done?.cost ?? { quoted_credits: 0, charged_credits: 0 },
    rows: done?.rows,
    out_file: out,
    added_columns: done?.added_columns,
    ...(code !== 0 ? { partial: true, messages: text } : {}),
  };
}
