# Using Agentic ID through the CLI

Use the CLI when:
- the Agentic ID MCP tools are not in your tool list but you can run shell commands (agents without
  MCP support, CI jobs, scripts), or
- the user has a **file** of more than about 100 rows: `--file` sends it in budgeted chunks and
  writes one CSV row per input, which is cheaper in tokens and safer than looping tool calls.

The CLI calls the same API as the MCP tools, so inputs, outputs, error codes and credits are
identical.

## Check it is there and signed in

```bash
agentic-id --version
agentic-id whoami --json      # free: which credential, which workspace, credits available
```

If the command is missing, tell the user: the CLI is in preview and installs from source (see the
README, "CLI"). Do not install software without the user's yes.

If `whoami` exits 3 ("Not signed in"), ask the user to run one of these **themselves**:
- `agentic-id login` (opens a browser; for people at a terminal)
- `agentic-id login --with-api-key < key.txt` (for CI and servers)

`agentic-id doctor` prints every check with a fix; suggest it when something is off.

## Authentication

The CLI finds a credential on its own, in this order: `--api-key`, `AGENTIC_ID_API_KEY`, the
`agentic-id login` session, `~/.agentic-id/api-key`. The Claude Code plugin does not read that file; it
uses its own `api_key` option.
`AGENTIC_ID_API_URL` sets the server; the default is the hosted development server.

Never ask the user to paste a key into the chat, never put a key on the command line (it lands in
shell history and logs), and never write one into a file in the repository.

## Always use machine output

- `--json`: the raw API answer, with the same fields as the MCP tool result in [tools.md](tools.md).
- `-o csv` / `-o jsonl`: one row per result (validate, enrich, find, discover, resolve). Use these
  for files and write them where the user asked, e.g. `-o csv > verdicts.csv`.

Parse these rather than the readable view.

## Command map

| MCP tool | CLI |
| --- | --- |
| `agentic_id_validate` | `agentic-id validate --email <e> --max-credits <n> --json` (or `--domain`, `--id`) |
| `agentic_id_validate` (batch) | `agentic-id validate --file <csv> [--column <name>] --max-credits <budget> -o csv` |
| `agentic_id_resolve` | `agentic-id resolve --email <e> \| --linkedin-url <u> \| --name <n> --company-domain <d> --max-credits <n> --json` |
| `agentic_id_enrich` | `agentic-id enrich --email <e> \| --linkedin-url <u> \| --name <n> --company-domain <d> [--job-title <t>] \| --id <did> --max-credits <n> --json` |
| `agentic_id_enrich` (companies) | `agentic-id enrich --account <domain-or-name>[,...] --required-fields industry,employee_size --max-credits <n> --json` |
| `agentic_id_enrich` (batch) | `agentic-id enrich --file <csv> --required-fields email,job_title --max-credits <budget> -o csv` |
| `agentic_id_find` | `agentic-id find --domain <d> --roles "<r>" --seniority <s> --limit <n> --max-credits <n> --json` |
| `agentic_id_discover` | `agentic-id discover --industry "<i>" --country <c> --employee <band> [--keyword <k>] [--tech <t>] --job-title "<t>" --limit <n> --max-credits <n> --json` |
| (no MCP tool) | `agentic-id credits --json`: balance, holds and recent movements. Free. |

## Files and budgets

- With `--file`, `--max-credits` is the budget for **the whole file**. Agree it with the user first
  (validate: up to 1 credit per email; enrich: up to 5 held per contact, about 2 charged).
- Enrich rows carry `status` (Enriched with email / Enriched / Not Enriched), `confidence`,
  `outreach_ready` and `reason`. Only `outreach_ready` rows are safe to email.
- `--required-fields` takes the backend's names (`email`, `job_title`, `linkedin`, ...). A wrong
  name stops the whole file before anything is charged; fix the name from the error and rerun.
- Rows come back with a `status` when they were not processed:
  - `skipped`: the budget ran out first. Tell the user how many, and ask before spending more.
  - `rejected`: refused before lookup (personal email, placeholder name). Not charged.
  - `not_sent`: the run stopped part-way (exit code 1). Everything before it was paid for and is
    in the output; report the error and ask before re-running.
- Validate takes a CSV with an `email` / `work_email` column (or `--column`), or one email per line.
  Enrich reads `email`, `linkedin_url`, `name` / `first_name` + `last_name`, `company`,
  `company_domain` / `website`.

## Retries

Pass `--idempotency-key <unique-key>` on paid calls you might retry. A retried call with the same
key returns the first answer instead of charging again; in file mode each chunk gets its own
derived key, so re-running the same file with the same key does not pay twice.

## Exit codes

| Code | Meaning | What to do |
| --- | --- | --- |
| 0 | OK | Read the output |
| 1 | API error, or a file run that stopped part-way | Read `error` and `fix` on stderr (see [errors.md](errors.md)); keep the rows already printed |
| 2 | Bad input, refused before sending | Fix the flag the message names |
| 3 | Configuration, sign-in or connection problem | Ask the user to run `agentic-id doctor` and follow its fix |
