---
name: who-matters
description: Work out who matters for the user's ICP with the five Agentic ID tools - validate the identifiers in hand, resolve them to Agentic ID identities, enrich the gaps, find the buying group inside known accounts, and discover net-new accounts and contacts - within an agreed credit budget. Use for "who should I talk to at <company>", "build me a contact list for <ICP>", "check and enrich these leads", "find the marketing leadership at these accounts".
---

# Who matters

A playbook on top of the `agentic-id` skill (read it for tool details and the credit rules).

## 0. Agree the scope and the budget first

Before any paid call, confirm in one short message:
- the ICP: roles or job functions, seniority, and for discover the industry, country, employee or
  revenue ranges;
- how many people per account (`limit` for find) and in total (`limit` for discover);
- the credit budget. Estimate it with the `agentic-id-credits` skill and show the arithmetic
  (for example "3 accounts x 5 people x 1 credit = up to 15 credits").

If the user already gave all three, do not ask again; proceed. If the budget is smaller than the
plan, shrink the plan (fewer people per account, or fewer accounts) and say what you cut.

Exact arguments for each call are in the `agentic-id` skill's `references/tools.md`. Every step
below works the same through the MCP tools or the `agentic-id` CLI.

## 1. Validate what the user handed over

Call `agentic_id_validate`, with `emails` for more than one address. Keep `valid` and
`catch-all`. Report `invalid` and rejected addresses in one line each. `unknown` is not a verdict
against the address; keep it but flag it.

## 2. Resolve the keepers to identities

Call `agentic_id_resolve` with each email or LinkedIn URL. Keep the `universal_did`.
`found: true` means Agentic ID already holds an enriched record, which usually makes enrich
cheaper or unnecessary. Handle `needs_evidence` and `conflict` as the `agentic-id` skill says.

## 3. Enrich only the gaps that matter

For the identities worth working, call `agentic_id_enrich` with the DID (or `contacts` for people
Agentic ID has not seen). Ask for the fields the task needs (`required_fields`), not everything.
Report `missing_fields` honestly.

## 4. Find the rest of the buying group

For each target account, call `agentic_id_find` with `account.domain` (a DID alone is not enough), the
agreed `roles` (job titles) / `seniority` (or `job_function`), the agreed `limit` and a
`max_credits` that matches it. Stop early when the budget is spent. If the people returned do not
match the roles asked for, report that plainly and do not count them as the buying group.

## 5. Discover net-new accounts (only when asked)

Call `agentic_id_discover` with `account_filters` and `contact_filters`, an explicit `limit`, and
`max_credits` set to the agreed budget. Repeat calls page through net-new contacts; only page
again with the user's yes.

## 6. Deliver

- Group by account. For each person: name, title, seniority, DID, and only the fields that were
  actually returned. Mark provider emails from find/discover as unverified unless validated.
- Lists longer than about 20 rows go to a CSV file (ask where), not into the chat.
- Finish with a credits table: step, calls, credits charged, and the total against the budget.
- Never send email, never write to a CRM, never raise a budget without a yes.
