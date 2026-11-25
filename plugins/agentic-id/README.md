# Agentic ID for Claude Code

Agentic ID is iCustomer's B2B identity service. This plugin connects Claude Code to it, so Claude
can resolve a person or company to one stable Agentic ID, check a work mailbox before you send to
it, fill in a contact's title and company, list the people in a role at a known company, build an
account list from ideal customer profile filters or from your best customers, de-duplicate a list
of leads, and tell you how far each value can be trusted.

The plugin connects Claude Code to iCustomer's hosted Agentic ID MCP server and adds six skills,
an agent that qualifies a list of leads end to end, and four slash commands. It runs nothing on
your computer: it is made only of instructions for Claude and the address of the hosted server.

## What it connects to

One remote MCP server, run by iCustomer: `https://agenticid.icustomer.ai/mcp` (Streamable
HTTP). You sign in to it with your iCustomer account (OAuth, in your browser). The plugin has no
local server, no hooks, no scripts and no bundled command-line tool.

## What you get

| Tool | What it answers | Credits |
| --- | --- | --- |
| `validate` | Is this work mailbox real? | 1 per `valid`, `invalid` or `catch-all` answer; `unknown` and refused are free |
| `resolve` | Who is this? A work email, LinkedIn URL, name with a company, or a domain, resolved to one stable ID | 1 per ID; 0 for one your workspace already holds |
| `enrich` | Title, company and work email for a person; industry, size, revenue and more for a company | 2 per person, 1 per company; nothing found, nothing charged |
| `find` | Who holds a role at a known company | 2 per person |
| `discover` | Which companies and people match your ideal customer profile | 1 per company plus 2 per person; a count is free |
| `lookalike` | Which companies look like these seed companies | 1 per company |
| `facts` | How sure is Agentic ID about each value of this ID, and why | Free |
| `ledger` | What happened to this ID, with its hash chain re-checked | Free |
| `credits` | How many credits you have, what you spent and on what | Free |
| `feedback` | Tell Agentic ID what happened to a value: bounced, replied, wrong person, left the company, confirmed | Free |

Every value comes with a level: **verified** (proved by a direct check or something the person
did), **corroborated** (independent sources agree), **claimed** (one source said so) or
**contradicted** (newer evidence disagrees). The skills tell Claude to show the level with every
value and never to round it up.

Every paid call takes a `max_credits` budget that the server never exceeds, and every answer
reports the credits quoted and charged. The skills tell Claude to set that budget on every paid
call, to ask you for a number before any call that could cost more than 10 credits, to count
before it buys, and to tell you what was charged.

| Component | What it does |
| --- | --- |
| Skill `agentic-id` | Picks the right tool, gives Claude the exact arguments, and applies the credit, level and B2B-only rules |
| Skill `agentic-id-credits` | Prices, free counts, caps, and how to read what was charged |
| Skill `who-matters` | A playbook: check, resolve, enrich, find and discover inside a budget agreed with you first |
| Skill `clean-a-list` | De-duplicate a lead or CRM list and check its emails |
| Skill `lookalike-prospecting` | From your best customers to a shared profile to a list of similar companies |
| Skill `trust-check` | Whether a record is safe to act on, and why two records are the same ID |
| Agent `lead-qualification` | Works a list of leads end to end inside a credit budget and returns a list grouped by account |
| Command `/agentic-id:agentic-id-login` | How to sign in with your iCustomer account |
| Command `/agentic-id:agentic-id-status` | How to check the connection |
| Command `/agentic-id:agentic-id-clean-list <csv>` | Starts `clean-a-list` on a file, estimate first |
| Command `/agentic-id:agentic-id-usage` | Your credits and recent spend |

## Set up

1. Install and enable the plugin. There are no options to fill in.
2. Sign in: type `/mcp`, select `plugin:agentic-id:agentic-id`, and choose **Authenticate**. Your
   browser opens the iCustomer sign-in page; when it says you are signed in, go back to Claude
   Code. `/agentic-id:agentic-id-login` repeats these steps.
3. Check it: `/mcp` shows agentic-id as connected.
4. Ask Claude something like "Who are the VP-level marketing people at tallpinesoftware.com? Two
   people, at most 4 credits."

Each signed-in account has a workspace and a credit wallet of its own.

Never paste a password, code or API key into the chat. The skills tell Claude never to ask you
for one.

## The optional CLI: files and estimates

The hosted server answers one lookup or one batch at a time. It does not read CSV files or give a
cost estimate before a call. For those there is
a separate, optional command-line tool, `agentic-id`, published on npm:
https://www.npmjs.com/package/agentic-id (Node.js 18 or later). The plugin does not install it.
Its documentation is in the CLI section of this repository's README:
https://github.com/icustomerai/agentic-id-plugin#cli.

If it is installed, Claude can use it for whole files (dry run first, then a run with a credit
cap, writing a new file next to yours), and for `agentic-id estimate`. Claude Code asks you before each command. The CLI has its
own sign-in, `agentic-id login`.

## What the plugin sends and stores

**Network.** Claude Code talks to the hosted Agentic ID server above, and nothing else, on the
plugin's behalf. To it go the arguments of each Agentic ID call: work emails, LinkedIn profile
URLs, person and company names, company domains, search filters and `max_credits`, with your
sign-in token.

**What Claude is told never to send.** Personal email addresses (gmail.com and the like) and
personal phone numbers. The server also refuses personal and disposable addresses without
charging for them.

The results come back into your Claude conversation. Handle them under your organisation's data
policy. Contact values such as emails may come back masked, depending on what your workspace may
read.

**On your computer.** The plugin stores nothing and runs no programs. Claude Code keeps the
sign-in for the hosted server, as it does for any remote MCP server.

The `evals/` folder in the repository holds test cases for `claude plugin eval`; Claude Code
doesn't load them when you use the plugin.

## Errors you may see

| Code | What to do |
| --- | --- |
| Not signed in, sign-in expired | `/mcp`, select agentic-id, **Authenticate** |
| The tools are missing | `/mcp`: check that agentic-id is connected |
| `credits.insufficient` | The workspace balance can't cover the call. Ask Claude to buy credits: you get a secure payment link, and nothing is charged until you pay |
| `rate_limited` | Wait a moment and try again |
| `source.unavailable` | A data source behind Agentic ID was down. Nothing was charged for it; try later |

## Support and license

Questions and issues: https://github.com/icustomerai/agentic-id-plugin/issues, or your iCustomer
team. Source, changelog and integration guides for other agents are in the same repository.

MIT license, copyright iCustomer. See [LICENSE](LICENSE).
