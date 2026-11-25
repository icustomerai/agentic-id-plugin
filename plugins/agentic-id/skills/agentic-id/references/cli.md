# Using Agentic ID through the CLI

`agentic-id` is an optional command-line tool, published on npm
(https://www.npmjs.com/package/agentic-id, Node 18 or later). The plugin does not ship it: the
user installs it themselves if they want it. Its own documentation is in the repository README's
CLI section: https://github.com/icustomerai/agentic-id-plugin#cli. It calls the same Agentic ID
API as the hosted tools, with the same caps and answers.

Use it for what the hosted tools do not do:
- a **CSV file**, or more than about 50 rows;
- a free worst-case estimate before a call (`agentic-id estimate`);
- recording a file of outcomes (`agentic-id report --file`);
- writing a big run's results to a CSV file (`agentic-id runs results <id> --out ...`);
- API keys for scripts and CI (`agentic-id keys`): the user runs these themselves.

You run it through the ordinary shell, so Claude Code asks the user before each command. Never
install it yourself unless the user asks; if it is missing, point them to the npm page.

## Check it is there and works

```bash
agentic-id --version
agentic-id doctor
```

`--version` says whether it is installed. `doctor` checks the sign-in, the server and what the
caller can read, and prints a fix for anything wrong.

Two ways to be let in:
- **Sign in:** the user runs `agentic-id login`. It opens the browser on the iCustomer sign-in
  page and keeps the session on their machine. `agentic-id logout` ends it. The CLI's sign-in is
  separate from the plugin's `/mcp` sign-in.
- **API key** (CI and scripts): the `AGENTIC_ID_API_KEY` environment variable, or the file named
  in `AGENTIC_ID_API_KEY_FILE`. A key, when set, is used instead of a sign-in.

Never ask the user to paste a key into the chat, never put a key on a command line, and never
write one into a file in the repository.

## Commands

| Hosted tool | CLI |
| --- | --- |
| `validate` | `agentic-id validate jane.doe@acme.io bob@acme.io --json` |
| `resolve` | `agentic-id resolve --email jane.doe@acme.io --json` (`--linkedin`, `--name` + `--company` or `--domain`, `--domain` alone for a company; `--spend` to ask paid sources) |
| `enrich` | `agentic-id enrich --email jane.doe@acme.io --fields title,company_domain --json`; a company: `agentic-id enrich --domain acme.io --json` |
| `find` | `agentic-id find acme.io --role "VP Marketing" --limit 5 --max-credits 10 --json` |
| `discover` | `agentic-id discover --industry software --country GB --min 100 --max 2000 --count` then the same with `--max-accounts 25 --max-credits 25 --json` |
| `discover` with `ask` | `agentic-id discover "mid-size diagnostic imaging centres in Texas" --preview`, then `agentic-id discover --plan <plan id> --max-credits <n> --json` |
| `lookalike` | `agentic-id lookalike acme.io globex.com initech.com --max-accounts 10 --max-credits 10 --json` |
| `run_status` | `agentic-id runs show <run id>` (`agentic-id runs` lists them; `--status running\|paused\|finished`) |
| `run_results` | `agentic-id runs results <run id> --out results.csv [--wait]` |
| `run_cancel` / `run_resume` | `agentic-id runs cancel <run id>` / `agentic-id runs resume <run id> [--max-credits N]` |
| `run_export` | `agentic-id runs export <run id>`: a download link, good for an hour |
| `facts` / `ledger` | `agentic-id facts <id>` / `agentic-id ledger <id>` |
| `feedback` | `agentic-id report <id> --outcome bounced [--field work_email]` |
| (none) | `agentic-id estimate discover --max-accounts 50 --title CTO --per-account 2` |
| (none) | `agentic-id workspace [n]` |
| `topup` | `agentic-id topup 1000` (also `buy-credits`): prints a payment link; nothing is charged until the user pays |
| (none) | `agentic-id keys`, `agentic-id keys create [--name laptop]`, `agentic-id keys revoke <prefix>` |

Always pass `--json` when you will read the answer yourself.

## Preview, plans and runs

- `--preview` on any paid command is free: what the call would do and the most it could cost,
  with a plan ID good for 30 minutes. `--plan <id> --max-credits N` runs exactly that plan.
  `--count` on discover is the old name for a preview and still works.
- `discover` takes the request in plain words, as words after `discover` or `--ask "..."`. Always
  preview it first: the answer says how it was read, and lists every reading when it could mean
  more than one search. Filters given as well (`--industry`, `--naics`, `--sic`, `--country`,
  `--min`, `--max`) win over the reading.
- `--min-trust B` on discover and lookalike delivers only accounts graded B or better; the rest
  are left out and not charged. Each account shows its industry, NAICS codes when known, whether
  its size rests on one source, and its trust grade and summary: repeat those as given.
- A big or slow ask (more than 25 people, 500 accounts, 1,000 emails, or slower than about 20
  seconds) prints its first results and a run ID, and carries on by itself. `agentic-id runs show
  <id>` says where it stands in plain words; `agentic-id runs results <id> --out file.csv --wait`
  follows it to the end and writes every result. Reading is free. `runs resume` spends again: only
  with the user's yes and their number.
- A file run (`--file`) works through the list in parts as before; a part that is slow is followed
  to its end on its own.

## API keys

The user runs these themselves, signed in (`agentic-id login`); an API key cannot make or revoke
keys (exit 2, `auth.sign_in_required`). `keys create` prints the new key once, with "copy it now,
it will not be shown again". Never run `keys create` for the user, never read, repeat or store its
output, and never ask them to paste a key into the chat. `agentic-id keys` lists keys by prefix
only, and `keys revoke <prefix>` takes the prefix, never the whole key.

`find` and `discover` return people whose employer is not confirmed yet flagged
(`employment.status` "unconfirmed"; marked with an exclamation mark in the human view) and charge for them. Add
`--confirmed-only` to leave them out, free.

Workspace and outcomes (both free):

```bash
agentic-id workspace            # credits available, spend by tool, the last 10 movements
agentic-id workspace 50 --json  # the last 50, as JSON (and the latest credit purchases, when the server reports them)
agentic-id topup 1000           # a payment link for 1,000 credits ($0.05 each, 100 to 200,000); the link is printed, not opened
agentic-id report ic-... --outcome bounced            # the work email bounced
agentic-id report ic-... --outcome confirmed --field title
agentic-id report --file outcomes.csv --out reported.csv   # columns agentic_id, outcome[, field]; adds report_status
```

`agentic-id workspace` shows the same billing record as the hosted `credits` tool; in Claude Code prefer the tool. Use it for "how many credits do I have", "what did
I spend" and "what was that charge for".

## Files and budgets

```bash
agentic-id validate --file leads.csv --dry-run                         # rows, distinct addresses, the most it could cost; sends nothing
agentic-id validate --file leads.csv --max-credits 200 --out checked.csv
agentic-id resolve  --file crm.csv   --max-credits 500 --out resolved.csv
agentic-id enrich   --file leads.csv --fields title,work_email --max-credits 400 --out enriched.csv
```

- Always run `--dry-run` first and show the user the estimate. A file run without `--max-credits`
  is refused. The `--max-credits` number is the user's, never yours.
- Columns are found by their usual names (Email, Work Email, LinkedIn, First Name, Last Name,
  Company, Website, Domain). Name one explicitly with `--column` or `--email-column`,
  `--linkedin-column`, `--name-column`, `--company-column`, `--domain-column`.
- Comma, semicolon and tab separated files all work. The output keeps every input column and row
  order and adds:
  - validate: `email_verdict`, `email_reason`
  - resolve: `agentic_id`, `resolve_outcome`, `resolve_note`, `same_id_as_row` (the first row with the same ID:
    the duplicate marker)
  - enrich: `agentic_id`, `enrich_status`, and for each field `aid_<field>` and `aid_<field>_level`
- Repeats are paid once. Personal emails and phone numbers are never sent.
- `--limit-rows 20` runs a sample; use it to see the real price before the full file.
- The run stops at the cap; rows not reached are marked `not_checked` or `not_run`.
- `--out` must differ from the input: the user's original file is never overwritten.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Done |
| 1 | The command or the file was wrong (a missing column, `--out` equal to the input, a bad flag). Nothing was sent |
| 2 | Not signed in, the key was refused, or a sign-in is needed (making or revoking API keys) |
| 3 | A budget matter: no `--max-credits` on a paid file run or a plan, the cap stopped the run (the result file holds what was done), the wallet is short, or a run is paused for credits or its cap |
| 4 | Agentic ID refused the request, or some rows of a report were not recorded |
| 5 | Agentic ID could not be reached, or an outage stopped a run part way |

With `--file --json --out <file>`, a JSON summary (`summary`, `cost`, `rows`, `out_file`, `cap_reached`) is printed; the rows go to the file. Every file command prints the columns it read.
