---
name: agentic-id
description: Use for any B2B people or company data task - resolving a person or company (from a work email, LinkedIn URL, name plus company, or a domain) to one stable Agentic ID from a verified identity ledger, checking a mailbox before sending, filling in a contact's title / company / work email, listing the people in a role at a known company, building a net-new account list from ICP filters, finding companies like the user's best customers, de-duplicating a CRM export, or checking how sure Agentic ID is about a value. Covers the Agentic ID tools (validate, resolve, resolve_many, enrich, find, discover, lookalike, facts, ledger, estimate, status) through MCP or the agentic-id CLI, with the credit and B2B-only rules for every call.
---

# Agentic ID

iCustomer's B2B identity service. Every person and company resolves to one stable ID (`os_...`)
in a verified identity ledger (75M+ verified companies and people), every link needs evidence,
and every value comes with a **level** that says how far to trust it.

## Which tool

| The user wants to know | Tool | Cost |
| --- | --- | --- |
| Is this work email real? | `agentic_id_validate` | 1 per answer; unknown and rejected are free |
| Who is this? Give me one stable ID | `agentic_id_resolve` | 1 per ID; 0 if the workspace already holds it |
| Which rows in this list are the same person or company? | `agentic_id_resolve_many` | 1 per distinct ID |
| What is their title, company, work email? | `agentic_id_enrich` | 2 per person, 1 per company |
| Who holds role X at company Y? | `agentic_id_find` | 2 per person |
| Which companies (and people) match my ICP? | `agentic_id_discover` | 1 per account + 2 per person; `count_only` is free |
| Which companies look like my best customers? | `agentic_id_lookalike` | 1 per account |
| How sure are we about this ID's values? | `agentic_id_facts` | free |
| Why are these two records the same ID? | `agentic_id_ledger` | free |
| What would this call cost? | `agentic_id_estimate` | free |
| Is the plugin set up? | `agentic_id_status` | free |

Use the cheapest tool that answers the question and stop as soon as it is answered.

**Before the first call to a tool, read [references/tools.md](references/tools.md)** for its exact
arguments. Unknown arguments are refused, not ignored.

## MCP or CLI

- If tools ending in `agentic_id_validate` ... `agentic_id_status` are in your tool list, use them.
  Claude Code prefixes them: `mcp__plugin_agentic-id_agentic-id__agentic_id_validate`.
- A **CSV file**, or more than about 50 rows: use the `agentic-id` CLI with `--file`. It reads the
  file itself, pays for repeats once and writes one row per input, so the rows never pass through
  the conversation. See [references/cli.md](references/cli.md).
- If neither is available, tell the user how to connect Agentic ID. Never answer from memory.

## Levels: how far to trust a value

Enrich, find, discover and facts return a level with each value.

| Level | Means | What to do with it |
| --- | --- | --- |
| `verified` | Proved by a direct check, or by something the person did | Act on it |
| `corroborated` | Independent sources agree | Act on it |
| `claimed` | One source said so | Say it is unconfirmed; validate an email before sending |
| `contradicted` | Newer evidence disagrees | Do not use it; say so |
| `unknown` | Nothing to go on | Report as missing |

Always show the level next to a value you report. Never upgrade a level in your own words
("confirmed", "safe to send") unless it is `verified` or `corroborated`.

## Rules for every call

1. **Cap the spend.** Pass `max_credits` on every paid call, set to the smallest number that
   covers it. Calls that could cost more than 10 credits are refused without it (`cap_required`,
   with the estimate in the answer). Never raise a cap, or retry with a higher one, without the
   user's yes.
2. **Count before you buy.** Run `agentic_id_discover` with `count_only: true` first. It is free
   and says how many match.
3. **Report the cost.** After each call say `cost.charged_credits`, and `cost.quoted_credits` when
   it differs. For multi-step work, end with credits per step and the total.
4. **Batch.** Many emails go in one validate call (`emails`), many people in one enrich call
   (`contacts`), many rows in one `resolve_many` call.
5. **Read `input_notes`, `excluded` and `rejected`** in every answer and pass them on. They say
   what was held back on this machine, why candidates were left out, and which filter values
   could not be read.
6. **Stop on money errors.** `credits.insufficient` and `cap_required` mean stop and ask.

## B2B only

- Accept work emails, LinkedIn profile URLs, names with a company, and company domains.
- Personal mailboxes (gmail.com, outlook.com, ...) and phone numbers are held back on this machine
  and never sent. Say how many were held back; do not work around it.
- Never invent a person, title or email. An empty list, `outcome: "unresolvable"` or a missing
  field means Agentic ID does not know. Say so.
- Contact values (emails) come back masked unless the key may read them. Do not guess the hidden
  part.
- More than about 20 people: write a CSV file (ask where) and summarise in the chat.

## When something fails

Errors are `{ "error": "<code>", "message": "...", "fix": "..." }`. Follow `fix`. `"sent": false`
means the plugin refused it locally and nothing was charged. The full table is in
[references/errors.md](references/errors.md).

- `auth.missing_key` / `auth.invalid_key`: call `agentic_id_status`, then tell the user to set the
  key in the plugin options. Never ask them to paste a key into the chat.
- `unreachable`: the API URL is wrong or the server is down. Call `agentic_id_status`.
- `request.invalid`: fix the fields in `issues`.
