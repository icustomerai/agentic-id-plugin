# Using Agentic ID through the CLI

`agentic-id` ships with the plugin, in its `scripts/` folder. In Claude Code a session-start hook
puts that folder on PATH, so the plain name works. If the shell says `command not found`, run it
by its full path instead: the `agentic-id` skill gives it under "MCP or CLI". It calls the same
API as the MCP tools, with the same cleaning, caps and answers.

Use it when:
- the user has a **CSV file**, or more than about 50 rows;
- the MCP tools are not in your tool list but you can run shell commands (CI jobs, scripts).

## Check it works

```bash
agentic-id doctor
```

It checks Node, the sign-in or key, the server and what the caller can read, and prints a fix for
anything wrong.

Two ways to be let in:
- **Sign in:** `agentic-id login` opens the browser on the iCustomer sign-in page and keeps the
  session in `~/.agentic-id/session.json` (renews itself for 30 days). `agentic-id logout` ends
  it. On a machine with no browser, set `AGENTIC_ID_NO_BROWSER=1` and open the printed link
  elsewhere on the same machine.
- **API key:** `AGENTIC_ID_API_KEY`, or the file named in `AGENTIC_ID_API_KEY_FILE`. A key, when
  set, is used instead of a sign-in.

The server comes from `AGENTIC_ID_URL`.

Never ask the user to paste a key into the chat, never put a key on a command line, and never
write one into a file in the repository.

## Commands

| Tool | CLI |
| --- | --- |
| `agentic_id_validate` | `agentic-id validate jane.doe@acme.io bob@acme.io --json` |
| `agentic_id_resolve` | `agentic-id resolve --email jane.doe@acme.io --json` (`--linkedin`, `--name` + `--company` or `--domain`, `--domain` alone for a company) |
| `agentic_id_enrich` | `agentic-id enrich --email jane.doe@acme.io --fields title,company_domain --json`; a company: `agentic-id enrich --domain acme.io --json` |
| `agentic_id_find` | `agentic-id find acme.io --role "VP Marketing" --limit 5 --max-credits 10 --json` |
| `agentic_id_discover` | `agentic-id discover --industry software --country GB --min 100 --max 2000 --count` then the same with `--max-accounts 25 --max-credits 25 --json` |
| `agentic_id_lookalike` | `agentic-id lookalike acme.io globex.com initech.com --max-accounts 10 --max-credits 10 --json` |
| `agentic_id_facts` / `agentic_id_ledger` | `agentic-id facts <id>` / `agentic-id ledger <id>` |
| `agentic_id_estimate` | `agentic-id estimate discover --max-accounts 50 --title CTO --per-account 2` |
| `agentic_id_status` | `agentic-id status --json` |

Always pass `--json` when you will read the answer yourself.

`find` and `discover` return people whose employer is not confirmed yet flagged (`employment.status` "unconfirmed"; a `!` line in the human view) and charge for them. Add `--confirmed-only` to leave them out, free.

Workspace and outcomes (both free):

```bash
agentic-id workspace            # credits available, spend by tool, the last 10 movements
agentic-id workspace 50 --json  # the last 50, as JSON
agentic-id report ic-... --outcome bounced            # the work email bounced
agentic-id report ic-... --outcome confirmed --field title
agentic-id report --file outcomes.csv --out reported.csv   # columns agentic_id, outcome[, field]; adds report_status
```

## Files and budgets

```bash
agentic-id validate --file leads.csv --dry-run                         # rows, distinct addresses, the most it could cost; sends nothing
agentic-id validate --file leads.csv --max-credits 200 --out checked.csv
agentic-id resolve  --file crm.csv   --max-credits 500 --out resolved.csv
agentic-id enrich   --file leads.csv --fields title,work_email --max-credits 400 --out enriched.csv
```

- Always run `--dry-run` first and show the user the estimate. A file run without `--max-credits`
  is refused.
- Columns are found by their usual names (Email, Work Email, LinkedIn, First Name, Last Name,
  Company, Website, Domain). Name one explicitly with `--column` or `--email-column`,
  `--linkedin-column`, `--name-column`, `--company-column`, `--domain-column`.
- Comma, semicolon and tab separated files all work. The output keeps every input column and row
  order and adds:
  - validate: `email_verdict`, `email_reason`
  - resolve: `agentic_id`, `resolve_outcome`, `same_id_as_row` (the first row with the same ID:
    the duplicate marker)
  - enrich: `agentic_id`, `enrich_status`, and for each field `aid_<field>` and `aid_<field>_level`
- Repeats are paid once. Personal emails and phone numbers never leave the machine.
- `--limit-rows 20` runs a sample; use it to see the real price before the full file.
- The run stops at the cap; rows not reached are marked `not_checked` or `not_run`.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Done |
| 1 | The command or the file was wrong (a missing column, `--out` equal to the input, a bad flag). Nothing was sent |
| 2 | Not signed in, or the key was refused |
| 3 | A budget matter: no `--max-credits` on a paid file run, the cap stopped the run (the result file holds what was done), or the wallet is short |
| 4 | Agentic ID refused the request, or some rows of a report were not recorded |
| 5 | Agentic ID could not be reached, or an outage stopped a run part way |

With `--file --json --out <file>`, a JSON summary (`summary`, `cost`, `rows`, `out_file`, `cap_reached`) is printed; the rows go to the file. Every file command prints the columns it read.
