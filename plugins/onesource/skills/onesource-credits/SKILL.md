---
name: onesource-credits
description: Estimate and control OneSource credit spend - what each of the five tools costs (development prices), how to size max_credits and limit before a call, and how to read quoted_credits versus charged_credits afterwards. Use before any paid OneSource call that touches more than a handful of records, and whenever the user asks "how much will this cost", "how many credits did that use", "why was I charged" or "set a budget".
---

# OneSource credits

OneSource bills in credits from one workspace wallet. There is no separate "quote" tool in the
current catalog, so cost control works in three moves: **estimate, cap, read back**.

## Prices (development defaults - not approved production pricing)

| Tool | What is charged | Free |
| --- | --- | --- |
| `onesource_validate` | 1 per address that gets a `valid`, `catch-all` or `risky` verdict | `invalid`, `unknown`, non-existent domains, locally rejected input, domain-only checks, re-checks of a fresh stored status |
| `onesource_resolve` | free on the live OneSource backend (no lookup is bought) | always free there; the reference contract prices a full resolve at 0.25 email check + 1 person + 1 company (+2 work email in `full` mode), charged only for lookups that found something |
| `onesource_enrich` | per lookup that filled a field: person profile 1, company profile 1, work email 2 | fields already stored and fresh, misses, rejected input, provider failures |
| `onesource_find` | per person returned: 1 per the live tool description, 2 per the reference contract | no match, dropped duplicates or off-filter candidates, provider failures |
| `onesource_discover` | 1 per contact returned | empty results |

When the live tool description and the contract disagree (resolve, find), **budget at the higher
price** until the first real response shows the actual charge, then use what the response says.
The `cost` block in each answer is always authoritative.

## 1. Estimate before spending

Do the arithmetic and show it to the user before any call that could cost more than about 10
credits:

- validate: number of addresses x 1 (upper bound; invalid and unknown come back free).
- enrich: records x (1 person + 1 company + 2 work email), or fewer when only some fields are
  requested with `required_fields` / `fields`.
- find: accounts x `limit` x price per person.
- discover: `limit` x 1.

Example: "Find up to 5 VPs at each of 4 accounts: 4 x 5 x 2 = at most 40 credits (likely 20).
Shall I go ahead with a 40-credit cap?"

For a large job, run a small sample first (one account, `limit: 5`) to see the real price, then
scale with the user's yes.

## 2. Cap every call

- `max_credits` is required on validate, resolve, enrich and find, and optional on discover
  (where it caps the row count up front). Set it to the agreed estimate, not to a large number
  "just in case".
- `limit` is the second cap on find (default 20, max 100) and discover (default 100). Always pass
  it explicitly.
- If the server answers `credit_cap_reached`, the cap is below the cheapest paid step and nothing
  ran. Tell the user the minimum needed and ask before raising it.
- `insufficient_credits` means the wallet cannot cover the hold. Stop; do not retry.

## 3. Read back: quoted vs charged

Every answer carries `cost.quoted_credits` and `cost.charged_credits` (discover also reports
`credits_charged`).

- **quoted_credits** is the reservation made before the work: the most this call could cost,
  never above `max_credits`. It is reported unchanged after the call.
- **charged_credits** is what was actually taken: only lookups that found something. It is never
  above the quote. The difference (misses, duplicates, provider failures) is released back to the
  wallet.

Always tell the user the charged figure, and the quote when they differ, for example:
"Charged 6 credits (quoted 10: 4 lookups found nothing and were not charged)."

## Balance

- **After a paid call:** `ledger.available_after` in the answer is the wallet balance after that
  call. `ledger.held` and `ledger.charged` show what was reserved and what was taken.
- **With the CLI:** `onesource credits --json` shows the balance, open holds and recent movements,
  for free.
- **Neither:** there is no balance tool in the MCP catalog. Say so, and give the credits spent in
  this session instead.

## Local usage log

This plugin logs every OneSource call (tool, request id, credits; never the inputs) to
`~/.onesource/usage.jsonl`. Run `/onesource-usage` for credits per tool and the last 20 calls.
The log is a local convenience; the OneSource ledger is the billing record.
