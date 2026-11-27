---
name: agentic-id-credits
description: Estimate and control Agentic ID credit spend - what each tool costs, how to work out the most a call can cost and get a free count before buying, how to size max_credits, and how to read quoted_credits versus charged_credits afterwards. Use before any paid Agentic ID call that touches more than a handful of records, and whenever the user asks "how much will this cost", "how many credits do I have", "how many credits did that use", "why was I charged", "why was that free", "set a budget" or "buy more credits".
---

# Agentic ID credits

Agentic ID bills in credits from one workspace wallet. Only results are charged: a miss, a
refusal or a failed lookup costs nothing. Cost control is four moves: **estimate, count, cap,
read back**.

Nothing on the user's machine stops a costly call any more. These rules are the only guard, so
follow them every time.

## Prices

| Tool | Charged | Free |
| --- | --- | --- |
| `validate` | 1 per address answered `valid`, `invalid` or `catch-all` | `unknown`, refused (personal, disposable, malformed) |
| `resolve` | 1 per ID returned | an ID the workspace already holds, `unresolvable` |
| `enrich` | 2 per person enriched, 1 per company | nothing found |
| `find` | 2 per person returned, unconfirmed ones included | no match, repeats, IDs the workspace holds |
| `discover` | 1 per account delivered, plus 2 per person | `count_only`, `preview`, accounts left out (below `min_trust` too) |
| `lookalike` | 1 per account delivered | seeds, accounts left out |
| `facts`, `ledger`, `feedback`, the run tools (except what a resumed run then delivers) | never | always |

`preview: true` on any paid tool is free: it says what the call would do and the most it could
cost (`quote.credits_max`), with a `plan_id` that runs exactly that for 30 minutes.

The `cost` block in each answer is the authority, not this table.

## When the Agentic ID card shows the answer

Apps that support MCP Apps (Claude, ChatGPT, VS Code and others) show each Agentic ID answer as
an interactive card instead of text. For a preview, the card has an **Approve** button and a
credit cap that the user sets. When the user approves there, the card runs the plan and tells you
what it charged.

- After a preview in such an app, say what it would do and the most it could cost, then tell the
  user they can approve it in the card. Do not run its `plan_id` yourself unless the user asks you
  to in the chat. Otherwise the plan could run twice.
- When the card reports a run, add what it charged to your running total. Do not call the tool
  again to confirm.
- The caps still apply. The user's cap in the card is their budget for that plan. If they ask you
  in the chat to run it, the rules below apply as usual (a number in their own words above 10
  credits).
- Apps without the card show the text answer. There, preview, show the quote, and run the
  `plan_id` with the user's yes, as before.

## 1. Estimate

The hosted server has no estimate tool. Work out the most a call can cost from the table and show
the arithmetic to the user before any call over 10 credits:

"Find up to 5 people at each of 4 accounts: 4 x 5 x 2 = at most 40 credits. Go ahead with a
40-credit cap?"

If the `agentic-id` CLI is installed (`agentic-id --version`), `agentic-id estimate <command>
[flags]` prints the same arithmetic for free, and `agentic-id <command> --file <csv> --dry-run`
does it for a whole file.

## 2. Count before you buy (free)

`discover` with `count_only: true` says how many companies match. Always run it before a paid
discover, even when the user already gave a budget. (`preview: true` is the newer name: the same
count plus a quote and a plan. Either is free.) A count far above what the user wants means
tighten the filters, not raise the budget.

## 3. Cap every paid call

- Set `max_credits` on **every** paid call (validate, resolve with `spend`, enrich, find, discover,
  lookalike) to the smallest number that covers it. The server never charges past it.
- Above 10 credits, the cap must be a number the user gave in their own words. "Go ahead", "I
  don't care what it costs" or "50 companies" is not a budget: show the arithmetic and ask for a
  number. Never choose a cap above what the user said, and never set a large one "just in case".
- If the user gave a budget, use it without asking again. If several calls share one budget, make
  their caps add up to it or less.
- Size is the second cap: `limit` on find (default 5), `max_accounts` and
  `contact_filters.per_account` on discover, `max_accounts` on lookalike. Past 25 people or 500
  accounts (up to 50,000) the call carries on as a run, still within `max_credits`: a run that
  reaches its cap pauses, and resuming it with a higher cap needs the user's number.
- For a large job, run a sample first (one account, `limit: 3`, or `--limit-rows 20` on a file
  with the CLI), read the real price, then scale with the user's yes.
- `credits.insufficient`: the wallet cannot cover it. Stop; do not retry. Offer to buy credits
  (below).

## 4. Read back: quoted vs charged

- `quoted_credits`: the most the call could have cost (the hold), never above `max_credits`.
- `charged_credits`: what was taken. Never above the quote. The rest went back to the wallet.

Always state the charged figure, and why it differs from the quote when it does:
"Charged 6 credits (quoted 10: two people were already delivered to you and were skipped)."

`excluded` and the per-row notes in the answer explain most differences.

## Keeping a running total

Over a session, keep your own running total of `charged_credits` and say it when the user asks or
when a multi-step job ends. Before each call in a budgeted job, check what is left of the budget
and cap the call at no more than that. When the budget is spent, stop and ask.

## Balance and history

- Call the `credits` tool (free). It is the billing record: credits available and held by calls
  still running, spend today (UTC) and in the last 30 days by tool, and the latest grants and
  charges with the IDs they were for. `limit` (0-200, default 20) sets how many recent items.
  Use it for "how many credits do I have", "what did I spend" and "what was that charge for".
- Lead with its first line (what is available), then what the user asked about. Report
  `available`, not `balance`: held credits belong to calls still running.
- Only if the `credits` tool is not there (an older server): `agentic-id workspace` if the CLI is
  installed, or the user's iCustomer account.
- Never guess a balance, and never conclude "nothing was spent" from your own memory of the
  session. Before a job over about 50 credits, check the balance if you can.

## Buying credits

When the user wants more credits, or a call stopped on `credits.insufficient`:

- Ask how many if they did not say (100 to 200,000; one credit is $0.05, so 1,000 is $50).
- Call the `topup` tool with `credits` (CLI: `agentic-id topup <credits>`). It charges nothing and
  returns a link to a secure payment page. Give the user the link and the amount; do not open it
  for them.
- Never say the payment went through, or that credits were added, until the `credits` tool shows
  them. After the user says they paid, check the balance (they land within seconds).
- `topup.unavailable`: buying is not set up on this server; they add credits through their
  iCustomer account or team.
