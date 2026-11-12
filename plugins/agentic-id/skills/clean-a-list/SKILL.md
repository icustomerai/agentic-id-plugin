---
name: clean-a-list
description: Clean a lead or CRM list before it is used - find duplicate people and companies by resolving every row to one Agentic ID, check which emails are real, separate personal addresses and shared mailboxes, and hand back the same file with verdict and duplicate columns. Use for "dedupe this CSV", "clean my HubSpot / Salesforce export", "which of these emails will bounce", "check this event list before we import it", "how many real people are in this list", "prepare this list for a campaign".
---

# Clean a list

List hygiene with Agentic ID. The output is the user's own file with extra columns; nothing is
deleted, merged or imported for them.

## 1. Look at the file first (free)

Read the header and a few rows. Then call `agentic_id_list` twice with `dry_run: true`, once with
`action: "validate"` and once with `action: "resolve"`, giving the file's full path. Each answers
with the rows, how many distinct lookups will really be sent, the columns it will read, and the
most the run could cost. Tell the user: row count, the columns used (and any warning about a
column that looks like emails but was not recognised), the estimate for each step, and what they
get back. If the user already gave a budget in credits, go on within it; if not, ask for one and
stop.

If the columns are not found, name them in `columns` (`email`, `linkedin`, `name`, `company`,
`domain`).

For a pasted list of under about 50 rows, use `agentic_id_validate` with `emails`, then
`agentic_id_resolve_many` with `records`.

Use the `agentic_id_list` tool, not the `agentic-id` command, from inside Claude Code: the tool
runs with the plugin's own sign-in or key, which shell commands do not get. In a terminal of
their own the user can run the same steps as `agentic-id validate --file ...`
([cli.md](../agentic-id/references/cli.md)).

## 2. Sample, then run

Run a sample first: `action: "validate"`, `limit_rows: 20`, `max_credits: 20`, `out` set to a
sample file. Read its summary: if most addresses are `rejected` or `invalid`, tell the user before
spending on the rest. Then the full run, each step writing a new file (`out`): validate the
original into `<name>.checked.csv`, then resolve that file into `<name>.clean.csv`, each with the
agreed `max_credits`.

The tool never overwrites the input. Never overwrite the user's original file yourself either.

If a run stops at its cap, the result file holds what was done and marks the rest `not_run`:
say how many rows were left and what it would cost to finish.

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
- Do not paste rows from the file into the chat beyond a short sample the user can already see,
  and never repeat a personal email address or phone number from the file: say "row 7" instead.
- Read only the header and the first few lines of a file to understand it; the tool reads the rest.
