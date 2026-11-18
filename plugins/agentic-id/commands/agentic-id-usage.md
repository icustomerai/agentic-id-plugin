---
description: What this workspace spent - credits available, spend by tool and recent charges
argument-hint: "[number of recent items, default 20]"
---

The user wants to know what their Agentic ID workspace has spent. The hosted Agentic ID tools do
not report the balance or past charges, so:

1. Check whether the optional `agentic-id` command-line tool is installed by running
   `agentic-id --version`.
2. If it is, run `agentic-id workspace $ARGUMENTS --json` (20 if no number was given). That is the
   billing record: credits available and held, what was spent today (the UTC day) and in the last
   30 days by tool, and the latest grants and charges. Present it plainly. It is the answer to
   "what did I spend" and "what was that charge for". If it says it is not signed in, the user
   runs `agentic-id login`.
3. If it is not installed, say so in one line, and tell the user they can see their balance and
   spend in their iCustomer account, or install the CLI from npm
   (https://www.npmjs.com/package/agentic-id) and ask again.

You may add the credits charged by calls made in this conversation, from their `cost` blocks, as a
footnote. Never conclude "nothing was spent" from that alone, and never guess a balance.
