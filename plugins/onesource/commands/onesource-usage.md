---
description: Summarise local OneSource usage - credits per tool and the last 20 calls - from ~/.onesource/usage.jsonl
argument-hint: "[number of recent calls, default 20]"
allowed-tools: Bash(node:*)
---

Here is the local OneSource usage log, as summarised by the plugin's script:

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/usage-summary.mjs" $ARGUMENTS`

Present this to the user as-is: the per-tool credit table first, then the recent calls. Then add
at most three short observations, for example which tool spent the most credits, any errors and
their codes (`insufficient_credits`, `credit_cap_reached`, `provider_unavailable`, ...), and calls
with no credits recorded.

Notes for your answer:
- The log is written on this machine by the plugin's PostToolUse hook. It only covers calls made
  from Claude Code with this plugin enabled; it is not the OneSource ledger, which stays the
  source of truth for billing.
- The log holds no inputs or results (no emails, names or domains), only tool, outcome, request
  id and credits. Do not try to reconstruct who was looked up.
- If the log does not exist yet, say so and suggest running a OneSource tool first.
