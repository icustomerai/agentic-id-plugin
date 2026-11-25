---
description: What this workspace spent - credits available, spend by tool and recent charges
argument-hint: "[number of recent items, default 20]"
---

The user wants to know how many Agentic ID credits they have and what was spent.

1. Call the `credits` tool with `limit` set to $ARGUMENTS (20 if no number was given). It is free.
2. Lead with its first line: credits available, any held by calls still running, and what was
   spent today (UTC) and in the last 30 days. Then show spend by tool and the latest charges and
   the IDs they were for (companies by name or domain; people by ID only).
3. If the tool answers that the user is not signed in, tell them to type `/mcp`, select
   `plugin:agentic-id:agentic-id` and choose **Authenticate**.
4. Only if there is no `credits` tool (an older server): run `agentic-id workspace` if the CLI is
   installed (check with `agentic-id --version`), or tell the user they can see their balance in
   their iCustomer account.

If the user wants more credits, see "Buying credits" in the `agentic-id-credits` skill: the `topup`
tool returns a payment link; nothing is charged until they pay.

That answer is the billing record. Never guess a balance, and never conclude "nothing was spent"
from the `cost` blocks of this conversation.
