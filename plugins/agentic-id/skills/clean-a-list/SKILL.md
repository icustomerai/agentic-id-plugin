---
name: clean-a-list
description: Clean a lead or CRM list before it is used - find duplicate people and companies by resolving every row to one Agentic ID, check which emails are real, separate personal addresses and shared mailboxes, and hand back the same file with verdict and duplicate columns. Use for "dedupe this CSV", "clean my HubSpot / Salesforce export", "which of these emails will bounce", "check this event list before we import it", "how many real people are in this list", "prepare this list for a campaign".
---

# Clean a list

List hygiene with Agentic ID. The output is the user's own file with extra columns; nothing is
deleted, merged or imported for them.

## 1. Look at the file first (free)

Read the header and a few rows. Then:

```bash
agentic-id validate --file <csv> --dry-run
agentic-id resolve  --file <csv> --dry-run
```

Each prints the rows, how many carry an identifier, and the most the run could cost. Tell the
user: row count, which columns will be used, the estimate for each step, and what they get back.
Agree a budget.

If the columns are not found, pass them: `--email-column`, `--linkedin-column`, `--name-column`,
`--company-column`, `--domain-column`.

For a pasted list of under about 50 rows, use the MCP tools instead: `agentic_id_validate` with
`emails`, then `agentic_id_resolve_many` with `records`.

## 2. Sample, then run

```bash
agentic-id validate --file <csv> --limit-rows 20 --max-credits 20 --out sample.csv
```

Read the sample's summary: if most addresses are `rejected` or `invalid`, tell the user before
spending on the rest. Then the full run, each step writing a new file:

```bash
agentic-id validate --file <csv>          --max-credits <agreed> --out <name>.checked.csv
agentic-id resolve  --file <name>.checked.csv --max-credits <agreed> --out <name>.clean.csv
```

Never overwrite the user's original file.

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
| `same_id_as_row` | a row number | This row is the same person or company as that earlier row |

## 4. Report

Give counts, not rows:
- rows in, distinct people or companies (distinct `agentic_id`), duplicate rows;
- emails by verdict; how many personal addresses and shared mailboxes (sales@, info@);
- rows that need a person (`review`, `conflict`);
- credits charged per step against the budget, and where the output file is.

Then say what you would do next and ask: remove duplicates, suppress `invalid`, enrich the gaps.
Do none of it without a yes.

## Rules

- Personal emails and phone numbers stay on the machine; they show up as `rejected` or `skipped`.
  Do not move them into another column to get them through.
- A duplicate is two rows with the same `agentic_id`, not two rows that look alike. Same name at
  two companies is two people until Agentic ID says otherwise.
- Do not paste rows from the file into the chat beyond a short sample the user can already see.
