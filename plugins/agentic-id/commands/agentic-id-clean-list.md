---
description: Clean a lead or CRM CSV - mark duplicate people and companies and check which emails are real, within a budget you agree first
argument-hint: "<path to a .csv file> [budget in credits]"
---

Clean this list with the `clean-a-list` skill: $ARGUMENTS

Always start with its free first step (read the header, run the two `agentic_id_list` dry runs)
and tell the user the row count, the columns that will be used and the estimate for each step.

Then:
- If the user already gave a budget in credits (in this request or earlier), go on and do the
  paid steps inside that budget without asking again.
- If they gave no budget, stop after the estimate and ask for one.
- If no file path was given, ask for one.
