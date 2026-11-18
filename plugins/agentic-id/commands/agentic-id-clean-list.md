---
description: Clean a lead or CRM CSV - mark duplicate people and companies and check which emails are real, within a budget you agree first
argument-hint: "<path to a .csv file> [budget in credits]"
---

Clean this list with the `clean-a-list` skill: $ARGUMENTS

If no file path was given, ask for one.

A whole CSV file is worked with the `agentic-id` command-line tool, because the hosted Agentic ID
tools do not read files. First check it is installed by running `agentic-id --version`. If it is
not, tell the user they can install it from npm (https://www.npmjs.com/package/agentic-id), and
offer to work a sample of up to about 50 rows with the hosted tools instead.

Always start with the skill's free first step (read the header, run the two `--dry-run`
commands) and tell the user the row count, the columns that will be used and the estimate for
each step.

Then:
- If the user already gave a budget in credits (in this request or earlier), go on and do the
  paid steps inside that budget without asking again. Every paid run gets `--max-credits`, and
  the caps of all steps add up to the budget or less.
- If they gave no budget, stop after the estimate and ask for a number of credits.
- Never overwrite the user's original file.
