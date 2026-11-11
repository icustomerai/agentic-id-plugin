---
name: who-matters
description: Work out who matters for the user's ICP with Agentic ID - check the identifiers in hand, resolve them, enrich the gaps, find the buying group inside known accounts, and discover net-new accounts and people - within an agreed credit budget. Use for "who should I talk to at <company>", "build me a contact list for <ICP>", "check and enrich these leads", "find the marketing leadership at these accounts", "map the buying committee".
---

# Who matters

A playbook on top of the `agentic-id` skill (tool arguments are in its `references/tools.md`;
prices are in `agentic-id-credits`).

## 0. Agree the scope and the budget

Before any paid call, settle in one short message:
- the persona: job titles or seniority; for discover also industry, country and size range;
- how many people per account, and how many accounts;
- the credit budget. Get the number from `agentic_id_estimate` and show the arithmetic
  ("3 accounts x 5 people x 2 = up to 30 credits").

If the user already gave all three, do not ask again. If the budget is smaller than the plan,
shrink the plan (fewer people per account, or fewer accounts) and say what you cut.

## 1. Start from what the user has

- Emails in hand: `agentic_id_validate` with `emails`. Keep `valid`. Keep `catch-all` and
  `unknown` but flag them. Drop `invalid` and `rejected`, one line each with the reason.
- Then `agentic_id_resolve_many` on the keepers: one ID per person, and `same_id` shows the
  duplicates. `review` and `conflict` rows go to the user, not into the list.

## 2. Enrich only the gaps that matter

`agentic_id_enrich` with `contacts` and the `fields` the task needs, not everything. Report each
value with its level. A result with no fields found nothing: say so.

## 3. Find the rest of the buying group

For each target account, `agentic_id_find` with `account.domain`, the agreed `roles` or
`seniority`, the agreed `limit`, and a matching `max_credits`.

- Read `excluded`: it says why candidates were left out (former role, wrong company, already
  delivered). If few people came back, tell the user the main reason before widening anything.
- If the titles returned are not the ones asked for, say so plainly. Do not count them.
- Calling again returns the next people (already delivered ones are skipped). Only page with the
  user's yes.
- Stop early when the budget is spent.

## 4. Discover net-new accounts (only when asked)

1. `agentic_id_discover` with `count_only: true`. Report the count and the `plan`.
2. If the count is far larger than wanted, tighten the filters with the user. If `rejected` lists
   a filter value, fix that value first: it was not applied.
3. Run the paid call with `max_accounts`, `contact_filters` when people are wanted, and
   `max_credits` set to the agreed budget.

For "more companies like these", use `agentic_id_lookalike` with the user's best customers as
seeds, and show `profile` before the list.

## 5. Deliver

- Group by account. For each person: name, title, Agentic ID, and only the values that were
  returned, each with its level.
- Emails from find and discover are masked unless the key may read them. To send, the user needs
  the values through a key with that right, and anything below `corroborated` validated first.
- Lists longer than about 20 rows go to a CSV file (ask where), not into the chat.
- End with a credits table: step, calls, credits charged, and the total against the budget.
- Never send email, never write to a CRM, never raise a budget without a yes.
