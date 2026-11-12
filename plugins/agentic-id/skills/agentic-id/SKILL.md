---
name: agentic-id
description: Use for any work-identity task about people or companies - resolving a person or company (from a work email, LinkedIn URL, or name plus company) to one stable Agentic ID from its verified identity ledger, filling in a contact's title / company / work email, listing the people in a role at a known company, building a net-new prospect list from ICP filters, or checking a mailbox is deliverable before sending. Covers the five Agentic ID tools (validate, resolve, enrich, find, discover) through MCP or the agentic-id CLI, with the credit and work-identifier rules for every call.
---

# Agentic ID

One open ID for every person, company and agent: an open identity protocol and a shared ledger.
Every person and company resolves to one stable ID (75M+ people and companies resolved and
verified), and every link needs evidence. Five verbs, each available as an MCP tool and as
a CLI command with the same inputs, outputs, errors and credits.

## Which verb

| The user wants to know | Verb | MCP tool | CLI |
| --- | --- | --- | --- |
| Is this work email real and safe to send to? | validate | `agentic_id_validate` | `agentic-id validate` |
| Who is this? (a stable ID for an email or LinkedIn URL) | resolve | `agentic_id_resolve` | `agentic-id resolve` |
| What is their title, company, work email...? | enrich | `agentic_id_enrich` | `agentic-id enrich` |
| Who holds role X at company Y? | find | `agentic_id_find` | `agentic-id find` |
| Which companies and people match my ICP? | discover | `agentic_id_discover` | `agentic-id discover` |

Use the cheapest verb that answers the question, in this order: validate, resolve, enrich, find,
discover. Stop as soon as the question is answered.

**Before the first call to a verb, read [references/tools.md](references/tools.md)** for its
exact arguments. Each verb has a specific input shape (for example validate takes
`identifiers.email`, not `email`); guessing costs a failed call.

## MCP or CLI

- If tools ending in `agentic_id_validate` ... `agentic_id_discover` are in your tool list, use them.
  Agents prefix the names (Claude Code: `mcp__plugin_agentic-id_agentic-id__agentic_id_validate`).
- If not, and you can run shell commands, use the `agentic-id` CLI with `--json`. See
  [references/cli.md](references/cli.md) for setup, flags and exit codes.
- If neither is available, tell the user how to connect Agentic ID (the README's "Choose your
  integration") instead of answering from memory.
- A **file** of more than about 100 rows: if the CLI is available, prefer
  `agentic-id validate|enrich --file <csv> --max-credits <budget> -o csv > <out.csv>` over looping
  tool calls. Agree the budget first; see [references/cli.md](references/cli.md#files-and-budgets).

## Rules for every call

1. **Cap the spend.** Pass `max_credits` (CLI `--max-credits`) on every call, set to the smallest
   value that covers the request. Prices are in the `agentic-id-credits` skill. Never raise a cap,
   or retry with a higher one, without the user's yes.
2. **Always pass `limit` to find and discover.** Agree the number with the user when it would
   cost more than a few credits; for a first look use 5.
3. **Report the cost.** After each call, state `cost.charged_credits`, and `cost.quoted_credits`
   when it differs. For multi-step work, end with credits per step and the total.
4. **Batch.** Several emails go in one validate call (`emails`); several contacts in one enrich
   call (`contacts`).
5. **Stop on money errors.** `insufficient_credits` and `credit_cap_reached` mean stop and ask;
   never retry them.

## Work identifiers only (for now)

- Accept work emails, LinkedIn profile URLs, names with a company, and company domains.
- Never send, ask for or look up personal emails (gmail.com, outlook.com, ...), phone or mobile
  numbers, device IDs or home addresses. If the user's data contains them, drop those values and
  say how many you dropped. The server refuses them with `consumer_data_v2`; do not work around it.
- Never invent a person, title or email. `found: false`, `id: null` or an empty list means
  Agentic ID does not know; say so.
- Emails returned by find or discover are unverified until validated. Label them that way.
- More than about 20 people: write a CSV file (ask where) and summarise in the chat.

## When something fails

Errors come back as `{ "error": "<code>", "message": "...", "fix": "..." }`. Follow `fix`.
The full table is in [references/errors.md](references/errors.md). The common ones:

- `invalid_input`: fix the named field. Test data (`test@`, `example.com`, `Test User`) is refused
  on purpose; ask for real input.
- `no_match` / `not_found`: nothing found and nothing charged.
- 401 or a sign-in prompt: the user must sign in (Claude Code: `/mcp`, pick `agentic-id`,
  Authenticate). Do not ask them to paste an API key into the chat.
