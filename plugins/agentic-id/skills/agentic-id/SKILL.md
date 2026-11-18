---
name: agentic-id
description: Use for any B2B people or company data task, including plain questions such as "identify notion.so", "how many fintech companies are there in Germany", "find 50 companies like these", "is this email real", "how many credits do I have" and "what did I spend" - never answer those from memory - resolving a person or company (from a work email, LinkedIn URL, name plus company, or a domain) to one stable Agentic ID from a verified identity ledger, checking a mailbox before sending, filling in a contact's title / company / work email, listing the people in a role at a known company, building a net-new account list from ICP filters, finding companies like the user's best customers, de-duplicating a CRM export, or checking how sure Agentic ID is about a value. Covers the hosted Agentic ID tools (validate, resolve, enrich, find, discover, lookalike, facts, ledger, feedback) and the optional agentic-id CLI, with the credit and B2B-only rules for every call.
---

# Agentic ID

iCustomer's B2B identity service. Every person and company resolves to one stable ID (`ic-...`)
in a verified identity ledger (75M+ verified companies and people), every link needs evidence,
and every value comes with a **level** that says how far to trust it.

## Which tool

| The user wants to know | Tool | Cost |
| --- | --- | --- |
| Is this work email real? | `validate` | 1 per answer; unknown and refused are free |
| Who is this? Give me one stable ID | `resolve` | 1 per ID; 0 if the workspace already holds it |
| Which rows in this list are the same person or company? | `resolve`, once per row (a file: the CLI) | 1 per ID |
| What is their title, company, work email? | `enrich` | 2 per person, 1 per company |
| Who holds role X at company Y? | `find` | 2 per person |
| Which companies (and people) match my ICP? | `discover` | 1 per account + 2 per person; `count_only` is free |
| Which companies look like my best customers? | `lookalike` | 1 per account |
| How sure are we about this ID's values? | `facts` | free |
| Why are these two records the same ID? | `ledger` | free |
| This email bounced / they replied / wrong person / left the company / our CRM confirms it | `feedback` | free |
| How many credits are left? What did I spend, and on what? | `credits` | free |
| What would this cost? | the prices in `agentic-id-credits`, or `discover` with `count_only`; the CLI: `agentic-id estimate` | free |
| Work a whole CSV file | the CLI with `--file` | as the action; `--dry-run` is free |
| Is it connected? Sign in | `/mcp` (see below) | free |

Use the cheapest tool that answers the question and stop as soon as it is answered.

**Before the first call to a tool, read [references/tools.md](references/tools.md)** for its exact
arguments. Unknown arguments are refused, not ignored.

## Hosted tools, and the optional CLI

- The tools come from iCustomer's hosted Agentic ID server. In Claude Code they are named
  `mcp__plugin_agentic-id_agentic-id__validate` and so on. Nothing runs on the user's computer.
- If the tools are missing or answer that the user is not signed in: tell the user to type
  `/mcp`, select `plugin:agentic-id:agentic-id` and choose **Authenticate**. Sign-in happens in
  the browser with their iCustomer account. You cannot start it yourself.
- The hosted server has no tool for cost estimates or for whole CSV files. For those, use the `agentic-id` command if it is installed: check with
  `agentic-id --version` (Claude Code asks the user before each command). Its commands are in
  [references/cli.md](references/cli.md). The CLI signs in on its own with `agentic-id login`.
- If the CLI is not installed, say so and tell the user they can install it from npm
  (https://www.npmjs.com/package/agentic-id). Do not install it for them unless they ask.
- If neither the tools nor the CLI are available, tell the user how to connect Agentic ID. Never
  answer from memory.

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

Nothing on the user's machine checks the spend for you any more: these rules are the only guard.

1. **Cap the spend.** Pass `max_credits` on every paid call (validate, resolve with `spend`,
   enrich, find, discover, lookalike), set to the smallest number that covers it. The server never
   charges past it. Never raise a cap, or retry with a higher one, without the user's yes.
2. **Above 10 credits, the user names the number.** Before any call that could cost more than 10
   credits, the user must have given a number of credits in their own words. "Go ahead", "I don't
   care what it costs" or a count of companies is not a budget: show the arithmetic and ask for a
   number. Never pick `max_credits` yourself above what the user said. If they gave a budget, use
   it without asking again.
3. **Count before you buy.** Run `discover` with `count_only: true` first, every time, even when
   the user already gave a budget and said "go ahead". It is free and says how many match. Then
   run the paid call within the budget.
4. **Report the cost.** After each call say `cost.charged_credits`, and `cost.quoted_credits` when
   it differs. For multi-step work, end with credits per step and the total.
5. **Batch.** Many emails go in one validate call (`emails`, up to 1,000), many people in one
   enrich call (`contacts`, up to 250). Resolve takes one record per call: call it once per row for
   a short list, and use the CLI for a file.
6. **Read `excluded` and `rejected`** in every answer and pass them on. They say why candidates
   were left out and which filter values could not be read.
7. **Stop on money errors.** `credits.insufficient` means stop and ask; do not retry.

## After the user acts on a value: send feedback

When the user tells you what happened to a value Agentic ID gave them, record it with
`feedback` (free): an email **bounced**, the person **replied**, it reached the **wrong_person**,
the person **left_company**, or their CRM **confirmed** it. Only for IDs the workspace holds.

- A bounced or wrong value is no longer delivered to this workspace and shows as `contradicted`
  in facts. A reply or a confirmation is proof for this workspace.
- It changes only this workspace's view. Say so if the user asks.
- Offer it once, after a send or a campaign: "Tell me which bounced or replied and I'll record
  them." Do not record an outcome the user did not state. One call per value; a file of outcomes
  goes through `agentic-id report --file`.

## B2B only

- Accept work emails, LinkedIn profile URLs, names with a company, and company domains.
- Never send personal mailboxes (gmail.com, outlook.com, ...) or personal phone numbers. Leave
  them out of the call, say how many were held back, and do not work around it.
- Never invent a person, title or email. An empty list, `outcome: "unresolvable"` or a missing
  field means Agentic ID does not know. Say so.
- Contact values (emails) may come back masked. Do not guess the hidden part.
- More than about 20 people: write a CSV file (ask where) and summarise in the chat.

## When something fails

Errors carry a code, a message and usually a `fix`. Follow `fix`. The full table is in
[references/errors.md](references/errors.md).

- Not signed in, or the sign-in expired: the user re-authenticates from `/mcp` (agentic-id,
  Authenticate). Never ask for a key, a password or a code in the chat.
- The tools are missing or the server does not answer: ask the user to open `/mcp` and check that
  agentic-id shows as connected. It is not a reason to answer from memory.
- `source.unavailable` or `source_unavailable: true`: a data source behind Agentic ID was down.
  Say so in one line and what was charged. Never name the data source, and do not loop.
- `partial: true`: the run stopped before the end (cap or error). Report what was done and what was
  not; it is not finished.
- `request.invalid`: fix the fields in `issues`.
