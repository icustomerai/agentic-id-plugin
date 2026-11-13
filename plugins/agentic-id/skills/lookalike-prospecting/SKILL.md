---
name: lookalike-prospecting
description: Build a net-new account list from the user's best customers - turn seed companies into a shared profile, find companies like them with Agentic ID, check the list is not just famous names, and optionally find the right people in each. Use for "find companies like our top customers", "lookalike accounts", "more accounts like these", "expand our ICP from closed-won", "TAM from seeds".
---

# Lookalike prospecting

## 1. Get good seeds

Ask for the domains of 3 to 20 customers of a similar kind (same segment, similar size). Seeds
from a CRM export: take the domain column, not names.

- Mixed seeds (a 20-person agency and a 50,000-person bank) share nothing useful. If the user's
  list is mixed, split it into groups and run each group on its own.
- One or two seeds work but give a thin profile. Say so.
- Seeds are never returned as results.

## 2. Run small first

`agentic_id_lookalike` with `seeds`, `max_accounts: 10`, `max_credits: 10`.

Before showing any company, show `profile`: the industries, countries, size range and
technologies the seeds share. That is the search that was run. Ask: "Is this what your best
customers have in common?" If not, change the seeds; do not buy a bigger list.

Then check:
- `seeds_rejected`: seeds that could not be used and why (does not resolve, no data).
- `bigger_than_seeds`: above 0.5 means the list leans to companies larger than any seed, usually
  well-known names. Tell the user, and offer a size ceiling with `agentic_id_discover` instead.
- each account's `similarity` and `why`: report the reasons, not only the score.

## 3. Scale with a budget

With the user's yes, run again with the agreed `max_accounts` and a matching `max_credits`
(1 credit per account). Companies already delivered to this workspace are skipped, so the same
call again returns new ones.

For tighter control (a hard size range, one country), use the profile as the starting filters
for `agentic_id_discover`: count first with `count_only: true`, then buy.

## 4. People, only when asked

For the accounts the user picks, `agentic_id_find` with `account.id` from the lookalike result,
the agreed roles and a small `limit`. 2 credits per person: show the arithmetic first.

## 5. Deliver

A table of domain, name, country, size, similarity and why; over 20 rows goes to a CSV. End with
credits charged per step against the budget.
