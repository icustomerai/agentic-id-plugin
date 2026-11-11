# Agentic ID for Claude Code

Agentic ID is iCustomer's B2B identity service. This plugin connects Claude Code to it, so Claude
can resolve a person or company to one stable Agentic ID, check a work mailbox before you send to
it, fill in a contact's title and company, list the people in a role at a known company, build an
account list from ideal customer profile filters or from your best customers, de-duplicate a CRM
export, and tell you how far each value can be trusted.

The plugin adds eleven MCP tools, six skills, an agent that qualifies a list of leads end to end,
the `agentic-id` command for CSV files, an optional session credit budget and a local usage log.

## What you get

| Tool | What it answers | Credits |
| --- | --- | --- |
| `agentic_id_validate` | Is this work mailbox real? | 1 per `valid`, `invalid` or `catch-all` answer; `unknown` and `rejected` are free |
| `agentic_id_resolve` | Who is this? A work email, LinkedIn URL, name with a company, or a domain, resolved to one stable ID | 1 per ID; 0 for one your workspace already holds |
| `agentic_id_resolve_many` | Which rows in this list are the same person or company? Up to 500 rows | 1 per distinct ID |
| `agentic_id_enrich` | Title, company and work email for a person; industry, size and country for a company | 2 per person, 1 per company; nothing found, nothing charged |
| `agentic_id_find` | Who holds a role at a known company | 2 per person |
| `agentic_id_discover` | Which companies and people match your ideal customer profile | 1 per company plus 2 per person; a count is free |
| `agentic_id_lookalike` | Which companies look like these seed companies | 1 per company |
| `agentic_id_facts` | How sure is Agentic ID about each value of this ID, and why | Free |
| `agentic_id_ledger` | What happened to this ID, with its hash chain re-checked | Free |
| `agentic_id_estimate` | What would this call cost at most | Free |
| `agentic_id_status` | Is the plugin connected, and what can this key read | Free |

Every value comes with a level: **verified** (proved by a direct check or something the person
did), **corroborated** (independent sources agree), **claimed** (one source said so) or
**contradicted** (newer evidence disagrees). The skills tell Claude to show the level with every
value and never to round it up.

Every paid call takes a `max_credits` budget that it never exceeds, and every answer reports the
credits quoted and charged. The `cost` block in each answer is authoritative.

| Component | What it does |
| --- | --- |
| Skill `agentic-id` | Picks the right tool, gives Claude the exact arguments, and applies the credit, level and B2B-only rules |
| Skill `agentic-id-credits` | Prices, free estimates and counts, caps, and how to read what was charged |
| Skill `who-matters` | A playbook: check, resolve, enrich, find and discover inside a budget agreed with you first |
| Skill `clean-a-list` | De-duplicate a lead or CRM file and check its emails, written back as extra columns |
| Skill `lookalike-prospecting` | From your best customers to a shared profile to a list of similar companies |
| Skill `trust-check` | Whether a record is safe to act on, and why two records are the same ID |
| Agent `lead-qualification` | Works a list of leads end to end inside a credit budget and returns a list grouped by account |
| Command `/agentic-id-status` | Checks the connection |
| Command `/agentic-id-clean-list <csv>` | Starts `clean-a-list` on a file, estimate first |
| Command `/agentic-id-usage` | Credits used per tool and the last 20 calls, from the local usage log |
| CLI `agentic-id` | The same tools from a terminal, with CSV in and out |

## Set up

1. Install and enable the plugin. Claude Code asks for three options:
   - **Agentic ID API key.** Your key. Claude Code stores it in your system keychain.
   - **Agentic ID API URL.** Where the Agentic ID API runs. The default is a local V3 stack
     (`http://127.0.0.1:3100`); set the URL iCustomer gave you otherwise.
   - **Session credit budget (optional).** The most one Claude Code session may spend, e.g. `100`.
2. Type `/agentic-id-status`. It should say which workspace you are connected as.
3. Ask Claude something like "Who are the VP-level marketing people at tallpinesoftware.com? Two
   people, at most 4 credits."

To change an option later, run `/plugin configure agentic-id@icustomer`, or open `/plugin`,
select Agentic ID on the **Installed** tab, and choose **Configure options**.

Never paste an API key into the chat. The skills tell Claude never to ask you for one.

The plugin needs Node.js 18 or later. It installs no packages.

## Working with files

```bash
agentic-id validate --file leads.csv --dry-run                  # what it would cost; sends nothing
agentic-id validate --file leads.csv --max-credits 200 --out leads.checked.csv
agentic-id resolve  --file leads.checked.csv --max-credits 500 --out leads.clean.csv
```

The output keeps every column and row of your file and adds verdict, ID and duplicate columns.
Repeated rows are paid once. Outside Claude Code, the command reads the key from
`AGENTIC_ID_API_KEY`, or from the file named in `AGENTIC_ID_API_KEY_FILE`, and the server from
`AGENTIC_ID_URL`. `agentic-id doctor` checks the setup; `agentic-id --help` lists everything.

## What the plugin sends, runs and stores

**Network: one server, nothing else.** The plugin talks only to the Agentic ID API at the URL in
the **Agentic ID API URL** option. To it, it sends:

- the arguments of each Agentic ID call: work emails, LinkedIn profile URLs, person and company
  names, company domains, search filters and `max_credits`;
- your API key, as a Bearer token;
- the header `x-agentic-id-client: agentic-id-plugin/<version>`.

**What never leaves your machine.** Personal email addresses (gmail.com and the like), phone
numbers and malformed input are held back before any call is made, and the answer says how many
were held back. A call that could cost more than 10 credits is not sent without a budget.

The results come back into your Claude conversation. Handle them under your organisation's data
policy. Contact values such as emails come back masked unless your key is allowed to read them.

**Local programs.** The plugin runs its own readable Node.js scripts and nothing else:

- `server/mcp.mjs` is the MCP server Claude Code starts for the tools. It reads the key and URL
  from the plugin options and makes the API calls above. It writes no files.
- `hooks/log-usage.mjs` runs after each Agentic ID tool call. It appends one line to
  `~/.agentic-id/usage.jsonl` (or `usage.jsonl` in the folder named by `AGENTIC_ID_CONFIG_DIR`):
  the time, the Claude Code session id, the tool, whether it succeeded, the error code, the
  request id, and the credits quoted and charged. It never writes tool inputs or results. The
  file is created with mode `0600`, and you can delete it at any time.
- `hooks/budget-guard.mjs` runs before each Agentic ID tool call. With no session budget set it
  does nothing. With one, it reads that log, and blocks a paid call once the session has spent
  the budget.
- `scripts/usage-summary.mjs` runs when you type `/agentic-id-usage`.
- `bin/agentic-id` runs only when you or Claude type the command.

The plugin does not change Claude Code's permission settings. The `evals/` folder holds test
cases for `claude plugin eval`; Claude Code doesn't load them when you use the plugin.

## Errors you may see

| Code | What to do |
| --- | --- |
| `auth.missing_key`, `auth.invalid_key` | Set or correct the API key in the plugin's options |
| `unreachable` | Check the API URL in the plugin's options; run `/agentic-id-status` |
| `cap_required` | The call could cost more than 10 credits. Agree a budget and pass `max_credits` |
| `credits.insufficient` | The workspace balance can't cover the call. Top up with your iCustomer team |
| `rate_limited` | The plugin waits and retries once; if it persists, slow down |
| "session budget ... is spent" | Raise **Session credit budget** in the plugin's options, or start a new session |

## Support and license

Questions and issues: https://github.com/icustomerai/onesource-plugin/issues, or your iCustomer
team. Source, changelog and integration guides for other agents are in the same repository.

MIT license, copyright iCustomer. See [LICENSE](LICENSE).
