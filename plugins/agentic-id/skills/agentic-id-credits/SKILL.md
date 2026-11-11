---
name: agentic-id-credits
description: Estimate and control Agentic ID credit spend - what each tool costs, how to get a free estimate or a free count before buying, how to size max_credits, and how to read quoted_credits versus charged_credits afterwards. Use before any paid Agentic ID call that touches more than a handful of records, and whenever the user asks "how much will this cost", "how many credits did that use", "why was I charged", "why was that free" or "set a budget".
---

# Agentic ID credits

Agentic ID bills in credits from one workspace wallet. Only results are charged: a miss, a
refusal or a failed lookup costs nothing. Cost control is four moves: **estimate, count, cap,
read back**.

## Prices

| Tool | Charged | Free |
| --- | --- | --- |
| `agentic_id_validate` | 1 per address answered `valid`, `invalid` or `catch-all` | `unknown`, `rejected`, a domain-only check, anything held back on this machine |
| `agentic_id_resolve`, `agentic_id_resolve_many` | 1 per ID returned | an ID the workspace already holds, `unresolvable`, repeated rows |
| `agentic_id_enrich` | 2 per person enriched, 1 per company | nothing found |
| `agentic_id_find` | 2 per person delivered | no match, people left out by a check |
| `agentic_id_discover` | 1 per account delivered, plus 2 per person | `count_only`, accounts whose size only one source confirmed (`charged: false`), accounts left out |
| `agentic_id_lookalike` | 1 per account delivered | seeds, accounts left out |
| `agentic_id_facts`, `agentic_id_ledger`, `agentic_id_estimate`, `agentic_id_status` | never | always |

The `cost` block in each answer is the authority, not this table.

## 1. Estimate (free)

Call `agentic_id_estimate` with the tool and the arguments you plan to send. It answers on this
machine with `max_credits` and the `arithmetic`. Show the arithmetic to the user before any call
over 10 credits:

"Find up to 5 people at each of 4 accounts: 4 x 5 x 2 = at most 40 credits. Go ahead with a
40-credit cap?"

For a CSV, `agentic-id <command> --file <csv> --dry-run` prints the same for the whole file.

## 2. Count before you buy (free)

`agentic_id_discover` with `count_only: true` says how many companies match and which source
would be asked. Always run it before a paid discover. A count far above what the user wants means
tighten the filters, not raise the budget.

## 3. Cap every paid call

- Calls that could cost 10 credits or less are capped at their own estimate automatically.
- Anything larger is refused without `max_credits` (`cap_required`; the answer carries the
  estimate). Set it to the agreed number, never to a large one "just in case".
- Size is the second cap: `limit` on find (default 5, max 25), `max_accounts` and
  `contact_filters.per_account` on discover, `max_accounts` on lookalike.
- Long lists are sent in batches inside one cap; the run stops when the cap is reached and says
  how far it got.
- For a large job, run a sample first (one account, `limit: 3`, or `--limit-rows 20` on a file),
  read the real price, then scale with the user's yes.
- `credits.insufficient`: the wallet cannot cover it. Stop; do not retry.

## 4. Read back: quoted vs charged

- `quoted_credits`: the most the call could have cost (the hold), never above `max_credits`.
- `charged_credits`: what was taken. Never above the quote. The rest went back to the wallet.

Always state the charged figure, and why it differs from the quote when it does:
"Charged 6 credits (quoted 10: two people were already delivered to you and were skipped)."

`excluded`, `input_notes` and `charged: false` on a row explain most differences.

## Budgets for a whole session

The plugin's optional session budget (plugin option "Session credit budget") blocks further paid
calls once the calls logged in this session have charged that many credits. When a call is
blocked for that reason, tell the user the total spent and ask before they raise it. Do not
suggest ways around it.

## Balance and history

- There is no balance tool. `credits.insufficient` reports `available_credits`.
- `/agentic-id-usage` (or `agentic-id usage`) shows credits per tool and the latest calls from the
  local log at `~/.agentic-id/usage.jsonl`. The log holds no inputs. It covers calls made through
  this plugin on this machine only; Agentic ID's own record is the billing record.
