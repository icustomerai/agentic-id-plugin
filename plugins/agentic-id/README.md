# Agentic ID for Claude Code

Agentic ID is one open ID for every person, company and agent: an open identity protocol and a
shared ledger, started at iCustomer. This plugin connects Claude Code to it, so Claude can resolve a person or company to one stable Agentic ID, fill in a contact's title, company and
work email, list the people in a role at a known company, build a prospect list from ideal
customer profile filters, and check that a work mailbox is deliverable before you send to it.

The plugin adds five MCP tools, three skills that teach Claude when and how to use them within a
credit budget, an agent that qualifies a list of leads end to end, and a local usage log.

## What you get

| Tool | What it answers | Credits |
| --- | --- | --- |
| `agentic_id_resolve` | Who is this? A work email, LinkedIn URL, or name with a company, resolved to one stable ID | Free |
| `agentic_id_enrich` | Title, company, work email and LinkedIn for a person; industry, size and HQ for a company. Up to 100 per call | 1 per data source that contributed, about 2 per person |
| `agentic_id_find` | Who holds a role at a known company | 1 per person returned |
| `agentic_id_discover` | Which companies and people match your ideal customer profile | 1 per company plus 1 per contact returned |
| `agentic_id_validate` | Is this work mailbox deliverable? Up to 1,000 per call | 1 per `valid`, `catch-all` or `risky` verdict; the rest are free |

Every paid call takes a `max_credits` budget that it never exceeds, and every answer reports the
credits quoted and charged. The `cost` block in each answer is authoritative.

| Component | What it does |
| --- | --- |
| Skill `agentic-id` | Picks the right tool, gives Claude the exact arguments, and applies the credit and work-identifier rules |
| Skill `who-matters` | A playbook: validate, resolve, enrich, find and discover inside a budget agreed with you first |
| Skill `agentic-id-credits` | Prices, how to estimate and cap a call, and how to read what was charged |
| Agent `lead-qualification` | Works a list of leads end to end inside a credit budget and returns a list grouped by account |
| Command `/agentic-id-usage` | Shows the credits used per tool and the last 20 calls, from the local usage log |
| Hook (after each Agentic ID tool call) | Adds one line to the local usage log. See below for exactly what it writes |

## Set up

1. Install and enable the plugin. Claude Code shows two options. Both have working defaults, so
   you can leave them as they are.
   - **Agentic ID API key (optional).** Leave it empty to sign in with your iCustomer account.
   - **Agentic ID MCP server URL.** Keep the default unless iCustomer gave you another one.
2. Sign in: run `/mcp`, pick `agentic-id`, and choose **Authenticate**. Your browser opens the
   iCustomer sign-in page. Claude Code keeps and renews the tokens.
3. Ask Claude something like "Who is the VP of Marketing at tallpinesoftware.com? Spend at most
   2 credits."

**API key instead of sign-in.** For CI, scripts and headless runs (`claude -p`), paste an Agentic ID
API key (`ic-live-...`) into the plugin's **API key** option. Claude Code stores it in your system
keychain, not in a settings file. To change it later, run
`/plugin configure agentic-id@icustomer`, or open `/plugin`, select Agentic ID on the
**Installed** tab, and choose **Configure options**. Clear the key to go back to sign-in.

Never paste an API key into the chat. The skills tell Claude never to ask you for one.

The hook and the `/agentic-id-usage` command run on Node.js 18 or later.

## What the plugin sends, runs and stores

**Network: one server, nothing else.** The plugin connects only to the Agentic ID MCP server in the
**Agentic ID MCP server URL** option, by default
`https://mcp-onesource-development.icustomer.ai/mcp`, over HTTPS. To that server it sends:

- the arguments of each Agentic ID tool call Claude makes: work emails, LinkedIn profile URLs,
  person and company names, company domains, search filters, `limit` and `max_credits`;
- your sign-in token, which Claude Code manages, or the API key you set in the plugin's options,
  in the `x-api-key` header;
- the header `x-agentic-id-client: claude-plugin/<version>`, which labels calls as coming from this
  plugin.

The results come back into your Claude conversation. Handle them under your organisation's data
policy. Neither the hook nor the command makes any network call.

**Local programs.** The plugin runs two small, readable Node.js scripts and nothing else:

- `hooks/log-usage.mjs` runs after each Agentic ID tool call. It appends one line to
  `~/.agentic-id/usage.jsonl`, or to `usage.jsonl` in the folder named by `AGENTIC_ID_CONFIG_DIR`
  when that is set. The line holds the time, the Claude Code session id, the tool, whether it
  succeeded, the error code, the request id, and the credits quoted and charged. It never writes
  tool inputs or results: no emails, names, domains or summaries. The file is created with mode
  `0600`, and you can delete it at any time. The hook never blocks or changes a tool call.
- `scripts/usage-summary.mjs` runs when you type `/agentic-id-usage`. It reads that file and prints
  a summary.

The plugin reads no credentials from your environment or your files, installs no packages, and
does not change Claude Code's permission settings. The `evals/` folder holds test cases for
`claude plugin eval`. Claude Code doesn't load them when you use the plugin.

**Work identifiers only for now.** Agentic ID accepts work emails, LinkedIn profile URLs, names with
a company, and company domains. Personal email addresses, phone numbers and device IDs are refused
until consumer identity ships with consent controls. Test
addresses and placeholder names are refused before any lookup runs, so they cost nothing.

## Errors you may see

| Code | What to do |
| --- | --- |
| `unauthorized` (401) | Sign in again through `/mcp`, or check the API key in the plugin's options |
| `credit_cap_reached` | The budget is below the cheapest paid step. Nothing ran. Raise `max_credits` or ask for fewer rows |
| `insufficient_credits` | The workspace balance can't cover the call. Top up with your iCustomer team |
| `consumer_data_v2` | Personal data was refused. Use a work email or a company domain |
| `rate_limited` | Wait for the time in `Retry-After`, then retry |

If `agentic-id` still shows **Needs authentication** after you set an API key, run `/mcp`, pick
`agentic-id` and choose **Reconnect**. Claude Code remembers that a server needed sign-in.

## Support and license

Questions and issues: https://github.com/icustomerai/onesource-plugin/issues, or your iCustomer
team. Source, changelog and integration guides for other agents are in the same repository.

MIT license, copyright iCustomer. See [LICENSE](LICENSE).
