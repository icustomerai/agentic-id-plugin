---
name: onesource
description: Use for any B2B people or company data task - resolving a person or company (from a work email, LinkedIn URL, or name plus company) to one stable OneSource ID from its verified identity ledger, filling in a contact's title / company / work email, listing the people in a role at a known company, building a net-new prospect list from ICP filters, or checking a mailbox is deliverable before sending. Covers the five OneSource tools (validate, resolve, enrich, find, discover) through MCP or the onesource CLI, with the credit and B2B-only rules for every call.
---

# OneSource

iCustomer's B2B identity resolution service: every person and company resolves to one stable ID
in a verified identity ledger (75M+ companies and people), and every link needs evidence. Five verbs, each available as an MCP tool and as
a CLI command with the same inputs, outputs, errors and credits.

## Which verb

| The user wants to know | Verb | MCP tool | CLI |
| --- | --- | --- | --- |
| Is this work email real and safe to send to? | validate | `onesource_validate` | `onesource validate` |
| Who is this? (a stable ID for an email or LinkedIn URL) | resolve | `onesource_resolve` | `onesource resolve` |
| What is their title, company, work email...? | enrich | `onesource_enrich` | `onesource enrich` |
| Who holds role X at company Y? | find | `onesource_find` | `onesource find` |
| Which companies and people match my ICP? | discover | `onesource_discover` | `onesource discover` |

Use the cheapest verb that answers the question, in this order: validate, resolve, enrich, find,
discover. Stop as soon as the question is answered.

**Before the first call to a verb, read [references/tools.md](references/tools.md)** for its
exact arguments. Each verb has a specific input shape (for example validate takes
`identifiers.email`, not `email`); guessing costs a failed call.

## MCP or CLI

- If tools ending in `onesource_validate` ... `onesource_discover` are in your tool list, use them.
  Agents prefix the names (Claude Code: `mcp__plugin_onesource_onesource__onesource_validate`).
- If not, and you can run shell commands, use the `onesource` CLI with `--json`. See
  [references/cli.md](references/cli.md) for setup, flags and exit codes.
- If neither is available, tell the user how to connect OneSource (the README's "Choose your
  integration") instead of answering from memory.
- A **file** of more than about 100 rows: if the CLI is available, prefer
  `onesource validate|enrich --file <csv> --max-credits <budget> -o csv > <out.csv>` over looping
  tool calls. Agree the budget first; see [references/cli.md](references/cli.md#files-and-budgets).

## Rules for every call

1. **Cap the spend.** Pass `max_credits` (CLI `--max-credits`) on every call, set to the smallest
   value that covers the request. Prices are in the `onesource-credits` skill. Never raise a cap,
   or retry with a higher one, without the user's yes.
2. **Always pass `limit` to find and discover.** Agree the number with the user when it would
   cost more than a few credits; for a first look use 5.
3. **Report the cost.** After each call, state `cost.charged_credits`, and `cost.quoted_credits`
   when it differs. For multi-step work, end with credits per step and the total.
4. **Batch.** Several emails go in one validate call (`emails`); several contacts in one enrich
   call (`contacts`).
5. **Stop on money errors.** `insufficient_credits` and `credit_cap_reached` mean stop and ask;
   never retry them.

## B2B only

- Accept work emails, LinkedIn profile URLs, names with a company, and company domains.
- Never send, ask for or look up personal emails (gmail.com, outlook.com, ...), phone or mobile
  numbers, device IDs or home addresses. If the user's data contains them, drop those values and
  say how many you dropped. The server refuses them with `consumer_data_v2`; do not work around it.
- Never invent a person, title or email. `found: false`, `id: null` or an empty list means
  OneSource does not know; say so.
- Emails returned by find or discover are unverified until validated. Label them that way.
- More than about 20 people: write a CSV file (ask where) and summarise in the chat.

## When something fails

Errors come back as `{ "error": "<code>", "message": "...", "fix": "..." }`. Follow `fix`.
The full table is in [references/errors.md](references/errors.md). The common ones:

- `invalid_input`: fix the named field. Test data (`test@`, `example.com`, `Test User`) is refused
  on purpose; ask for real input.
- `no_match` / `not_found`: nothing found and nothing charged.
- 401 or a sign-in prompt: the user must sign in (Claude Code: `/mcp`, pick `onesource`,
  Authenticate). Do not ask them to paste an API key into the chat.
