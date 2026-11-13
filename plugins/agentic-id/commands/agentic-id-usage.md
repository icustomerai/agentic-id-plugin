---
description: What this workspace spent - credits available, spend by tool, recent charges and which IDs they were for (the server's record), plus this machine's own call log
argument-hint: "[number of recent items, default 20]"
allowed-tools: Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/usage-summary.mjs *)
---

First call the `agentic_id_workspace` tool with `recent` set to $ARGUMENTS (20 if empty). That is
the billing record: credits available and held, what was spent today (the UTC day) and in the last
30 days by tool, the latest charges, and the IDs delivered with what each cost (companies carry
their name or domain; people are shown by ID only).

Present that first. It is the answer to "what did I spend" and "what was that charge for".

Then, only as a footnote, this machine's own log of calls made through the plugin (it may be
empty or old, and it never holds inputs):

!`node ${CLAUDE_PLUGIN_ROOT}/scripts/usage-summary.mjs $ARGUMENTS`

If the two disagree, the workspace answer is right: say so. Never conclude "nothing was spent"
from the local log.
