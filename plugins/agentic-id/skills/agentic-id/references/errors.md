# Agentic ID errors

An error from the hosted tools carries a code, a message and usually a `fix` line that says what
to do. In MCP the result is marked as an error; the CLI prints the same JSON and exits non-zero
(see [cli.md](cli.md#exit-codes)).

## Refused before anything was charged

| Code | Status | Means | What to do |
| --- | --- | --- | --- |
| `request.invalid` | 400 | A missing, unknown or contradictory argument; `issues` lists each one | Fix what it names and call again |
| `find.persona_unreadable` | 400 | No job title, seniority or function could be read | Ask which roles matter |
| `lookalike.no_profile` | 400 | The seeds share nothing readable | Use 3 or more domains of a similar kind |
| `credits.insufficient` | 402 | The wallet cannot cover the call (`available_credits` says what is left) | Stop and tell the user. Do not retry. Offer to buy credits: the `topup` tool (CLI: `agentic-id topup <credits>`) returns a payment link for the user to open |
| `topup.unavailable` | 503 | Buying credits is not available on this server | The user adds credits through their iCustomer account or team. Nothing was charged |
| `purpose.not_allowed` / `purpose.mismatch` | 403 | The data may not be used for this purpose | Use the right `purpose`; do not relabel to get around it |
| `pii.scope_required` | 403 | This workspace cannot read contact values | Values stay masked; the workspace owner can change that with iCustomer |
| `identity.merge_blocked` | 409 | Two records disagree on a strong identifier | Report both to the user; do not force it |
| `id.not_held` | - | Facts or history were asked for an ID this workspace does not hold | Resolve the person or company first, then ask again |
| `feedback.not_held` | - | Feedback was sent for an ID this workspace does not hold | Resolve or enrich it first, or drop that value |
| `intent.ambiguous` | 409 | A plain-language `ask` can mean more than one search; `readings` lists each | Show the user the readings and let them pick; send that reading's `account_filters`, or preview and run the `plan_id` |
| `intent.unclear` | 422 | The `ask` could not be read | Ask the user to say it another way, or use filters |
| `intent.unavailable` | 503 | Plain-language asks cannot be read right now | Use filters instead, or try later |
| `plan.not_found` | 404 | No such plan | Preview again for a new `plan_id` |
| `plan.expired` | 409 | The plan is more than 30 minutes old; a fresh preview comes with the error | Show the fresh quote; run its `plan_id` only with the user's yes |
| `run.not_found` | 404 | No run with that ID in this workspace | Check the `run_id`; `agentic-id runs` lists them |
| `run.not_finished` | 409 | The run is still going | Read what is ready with `run_results`, or check back later |
| `key.not_found` | 404 | No active API key with that prefix | `agentic-id keys` lists them |
| `key.limit_reached` | 409 | The workspace has as many active keys as it may | Revoke one no longer used, then make the new one |

## Sign-in and connection

| Symptom | Means | What to do |
| --- | --- | --- |
| A 401, "not signed in", `auth.token_expired` | The sign-in is missing or ended | The user types `/mcp`, selects `plugin:agentic-id:agentic-id`, and chooses Authenticate. Never ask for a password, code or key in the chat |
| The Agentic ID tools are not in your tool list | The server is not connected, or not signed in yet | Ask the user to open `/mcp` and check agentic-id. Do not answer from memory |
| CLI exit code 2 | The CLI is not signed in | The user runs `agentic-id login` |
| `auth.sign_in_required` (403) | API keys can be made or revoked only by a signed-in user, not with an API key | The user runs `agentic-id login` and unsets `AGENTIC_ID_API_KEY` for that command |

## Retry once at most

| Code | Status | Means | What to do |
| --- | --- | --- | --- |
| `rate_limited` | 429 | Too many requests | Wait `retry_after_seconds`, then once more |
| `service.unavailable` | 503 | Agentic ID is not taking requests for a moment | Nothing was charged. Wait, then try once more |
| `service.timeout` | - | The call may have completed | Do not repeat a paid call blindly: ask the user, and check the spend with the `credits` tool |
| `idempotency.in_progress` | - | The same request is still running | Wait; ask again later. It is charged once |
| `source.unavailable` | 503 | A data source behind Agentic ID was down | Say so in one line. Nothing was charged for it. Not the user's account or credits. Try again later; do not loop |

Discover and lookalike can take minutes. If one times out, narrow the filters or lower
`max_accounts` before trying again, and remember a timed-out paid call may still have been
charged.

Every error carries a `request_id`: quote it when reporting a problem.

## Not errors

- A `run_id` with `status` `running`: the call was too big or too slow for one answer and carries
  on by itself. Not an error and not finished: say how many came so far and how to read the rest.
- `status: "paused"` on a run: credits or a cap ran out (`reason`). What came is kept. Ask before
  resuming.
- `status: "exhausted"` on a run: it finished with fewer than asked, because fewer exist that pass
  the checks. `why_fewer` says how many and why.
- `partial: true`: a run stopped at the cap, or on an error after earlier parts were done. What was
  done is kept; the rest was not run and was not charged. Say both numbers.
- `source_unavailable: true` on an answer, or `status: "not_checked"` / `"partly_checked"` from
  find: some results are missing because a data source was down; only results that came back are
  charged. Unknown, not "nobody".
- `outcome: "unresolvable"`, an empty `people[]` or `accounts[]`, or a result with no `fields`:
  Agentic ID does not know. Nothing was charged. Say so; never fill the gap yourself.
- `verdict: "unknown"` from validate: no answer this time, free, not a verdict against the address.
