---
name: who-matters
description: Work out who matters for the user's ICP with Agentic ID - check the identifiers in hand, resolve them, enrich the gaps, find the buying group inside known accounts, and discover net-new accounts and people - within an agreed credit budget. Use for "who should I talk to at <company>", "build me a contact list for <ICP>", "check and enrich these leads", "find the marketing leadership at these accounts", "map the buying committee".
---

# Who matters

A playbook on top of the `agentic-id` skill (tool arguments are in its `references/tools.md`;
prices are in `agentic-id-credits`).

## 0. Agree the scope and the budget

Before any paid call, settle in one short message:
- the persona: job titles, seniority or job function; for discover also industry, country and
  size range;
- how many people per account, and how many accounts;
- the credit budget, as a number. Work out the most the plan can cost from the prices and show
  the arithmetic ("3 accounts x 5 people x 2 = up to 30 credits").

If the user already gave all three, do not ask again. If the budget is smaller than the plan,
shrink the plan (fewer people per account, or fewer accounts) so the `max_credits` of all calls
add up to the budget or less. Say so before the first paid call, in one line with the arithmetic
and what you cut ("4 accounts x 5 people x 2 = 40, over your 12: I'll take up to 2 people at two
accounts and 1 at the other two"). Do not shrink silently. Anything over 10 credits needs a
number from the user; "go ahead" is not one.

## 1. Start from what the user has

- Emails in hand: `validate` with `emails` and `max_credits` (1 per address). Keep `valid`. Keep
  `catch-all` and `unknown` but flag them. Drop `invalid` and refused, one line each with the
  reason.
- Then `resolve` each keeper, one call per person, with `max_credits: 1`: one ID per person. Rows
  that come back with the same `id` are duplicates. `review` and `conflict` rows go to the user,
  not into the list. For more than about 50 rows, or a file, use the `clean-a-list` skill.

## 2. Enrich only the gaps that matter

`enrich` with `contacts`, the `fields` the task needs (not everything) and `max_credits` (2 per
person). Report each value with its level. A result with no fields found nothing: say so.

## 3. Find the rest of the buying group

For each target account, `find` with `account: { "domain": ... }`, the agreed `title`,
`seniority` or `job_function`, the agreed `limit`, and `max_credits` of `limit x 2`.

- Unconfirmed people (`employment.status: "unconfirmed"`) are returned and charged. If the user
  wants only confirmed employees, set `include_unconfirmed: false`; otherwise flag them in the list.
- Read `status`: `not_checked` or `partly_checked` means a source was down, not that nobody holds
  the role. Say so.
- Read `excluded`: it says why candidates were left out (former role, wrong company, already
  delivered). If few people came back, tell the user the main reason before widening anything.
- If the titles returned are not the ones asked for, say so plainly. Do not count them.
- Calling again returns the next people (already delivered ones are skipped). Only page with the
  user's yes.
- Stop early when the budget is spent.

## 4. Discover net-new accounts (only when asked)

1. `discover` with `count_only: true`. Report the count.
2. If the count is far larger than wanted, tighten the filters with the user. If `rejected` lists
   a filter value, fix that value first: it was not applied.
3. Run the paid call with `max_accounts`, `contact_filters` (`title`, `seniority`, `per_account`)
   when people are wanted, and `max_credits` set to the agreed budget.

For "more companies like these", use `lookalike` with the user's best customers as seeds, and
show the shared profile before the list (see `lookalike-prospecting`).

## 5. Deliver

- Group by account. For each person: name, title, Agentic ID, and only the values that were
  returned, each with its level.
- Emails from find and discover may be masked. To send, the user needs the readable values, and
  anything below `corroborated` validated first.
- Lists longer than about 20 rows go to a CSV file (ask where), not into the chat.
- End with a credits table: step, calls, credits charged, and the total against the budget.
- Never send email, never write to a CRM, never raise a budget without a yes.
