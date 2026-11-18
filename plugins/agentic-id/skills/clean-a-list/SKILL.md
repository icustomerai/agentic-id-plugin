---
name: clean-a-list
description: Clean a lead or CRM list before it is used - find duplicate people and companies by resolving every row to one Agentic ID, check which emails are real, separate personal addresses and shared mailboxes, and hand back the same file with verdict and duplicate columns. Use for "dedupe this CSV", "clean my HubSpot / Salesforce export", "which of these emails will bounce", "check this event list before we import it", "how many real people are in this list", "prepare this list for a campaign".
---

# Clean a list

List hygiene with Agentic ID. The output is the user's own file with extra columns; nothing is
deleted, merged or imported for them.

## 0. Which route

- **A pasted list of under about 50 rows:** use the hosted tools directly (step 4 below).
- **A CSV file, or more rows:** the hosted server has no file tool. Use the `agentic-id` CLI,
  which reads and writes the file itself, pays for repeats once and keeps the rows out of the
  conversation. Check it is installed with `agentic-id --version` (Claude Code asks the user
  before each command). If it is not installed, tell the user they can install it from npm
  (https://www.npmjs.com/package/agentic-id) and stop there, or offer to work a sample of up to
  about 50 rows with the hosted tools instead. Never paste a whole file through the conversation.
  If the CLI says it is not signed in (exit code 2), the user runs `agentic-id login`.

## 1. Look at the file first (free)

Read the header and a few rows. Then do two dry runs, which send nothing:

```bash
agentic-id validate --file <path> --dry-run
agentic-id resolve  --file <path> --dry-run
```

Each prints the rows, how many distinct lookups will really be sent, the columns it will read,
and the most the run could cost. Tell the user: row count, the columns used (and any warning
about a column that looks like emails but was not recognised), the estimate for each step, and
what they get back. If the user already gave a budget in credits, go on within it; if not, ask
for one and stop.

If the columns are not found, name them with `--email-column`, `--linkedin-column`,
`--name-column`, `--company-column` or `--domain-column`.

## 2. Sample, then run

Run a sample first: `agentic-id validate --file <path> --limit-rows 20 --max-credits 20 --out
<name>.sample.csv --json`. Read its summary: if most addresses are refused or `invalid`, tell
the user before spending on the rest. Then the full run, each step writing a new file (`--out`):
validate the original into `<name>.checked.csv`, then resolve that file into `<name>.clean.csv`,
each with the agreed `--max-credits`. The caps of all steps add up to the budget or less.

The CLI never overwrites the input. Never overwrite the user's original file yourself either.

If a run stops at its cap (exit code 3), the result file holds what was done and marks the rest
`not_run` or `not_checked`: say how many rows were left and what it would cost to finish. The
same holds when a run stops part-way on an error: the file still holds every row done so far, and
only those were charged. Never call a partial run done.

If a data source behind Agentic ID was down, say so in one line and what was charged (often
nothing).

## 3. Read the result

| Column | Values | Meaning |
| --- | --- | --- |
| `email_verdict` | `valid` | Keep |
| | `catch-all` | The server accepts everything; not proven. Keep, send carefully |
| | `unknown` | No answer this time. Not a verdict against it; re-check later |
| | `invalid` | Will bounce. Remove from sends |
| | `rejected` | `email_reason` says why: personal mailbox, disposable, malformed |
| | `not_checked` | The cap was reached before this row |
| `resolve_outcome` | `known`, `new` | Has an `agentic_id` |
| | `review`, `conflict` | Needs a person to look; never auto-merge these |
| | `unresolvable`, `skipped` | Not enough to identify, or only personal data |
| `resolve_note` | a few words | Why a row has no ID: personal data only, a name alone, the cap was reached |
| `same_id_as_row` | a data row number | This row is the same person or company as that earlier row. Data rows are counted from 1 under the header, so data row 3 is line 4 of the file |

## 4. A short pasted list (hosted tools)

- `validate` with `emails` (all of them in one call) and `max_credits` set to the number of
  addresses (1 each).
- Then `resolve` once per row with `max_credits: 1`, and group the rows by the `id` that comes
  back: rows with the same `id` are duplicates. Agree the budget first (up to 1 credit per row;
  over 10 needs a number from the user).
- Report the same counts as below, in the chat or as a CSV the user asked for.

## 5. Report

Give counts, not rows:
- rows in, distinct people or companies (distinct `agentic_id`), duplicate rows;
- emails by verdict; how many personal addresses and shared mailboxes (sales@, info@);
- rows that need a person (`review`, `conflict`);
- credits charged per step against the budget, and where the output file is.

Then say what you would do next and ask: remove duplicates, suppress `invalid`, enrich the gaps.
Do none of it without a yes.

## Rules

- Personal emails and phone numbers are never sent; they show up as `rejected` or `skipped`.
  Do not move them into another column to get them through.
- A duplicate is two rows with the same `agentic_id`, not two rows that look alike. Same name at
  two companies is two people until Agentic ID says otherwise.
- Do not paste rows from the file into the chat beyond a short sample the user can already see,
  and never repeat a personal email address or phone number from the file: say "data row 7"
  instead.
- Read only the header and the first few lines of a file to understand it; the CLI reads the rest.
