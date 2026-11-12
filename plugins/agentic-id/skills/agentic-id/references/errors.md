# Agentic ID errors

Every error is JSON: `{ "error": "<code>", "message": "...", "fix": "..." }`. The `fix` line says
what to do. In MCP the result is marked as an error; the CLI exits non-zero (see
[cli.md](cli.md#exit-codes)).

`"sent": false` means the plugin refused the call on this machine: nothing reached Agentic ID and
nothing was charged.

## Refused on this machine

| Code | Means | What to do |
| --- | --- | --- |
| `cap_required` | The call could cost more than 10 credits and has no `max_credits` | Show the user `estimate.arithmetic`, agree a budget, call again with `max_credits` |
| `nothing_to_resolve` | Only personal or malformed identifiers were given | Ask for a work email, LinkedIn profile URL, name with company, or a domain |
| `name_alone` | A name with nothing to anchor it | Ask for the company, a work email or a LinkedIn URL |
| `nothing_to_enrich` | No contact had a usable work identifier | Same as above |
| `phone_not_supported` | A phone field was asked for | Remove it from `fields` |
| `account_required` | find without a company | Give `account.domain`, or use discover |
| `not_a_company` | A mail provider was given as the company | Give the company's own domain |
| `not_an_agentic_id` | facts or ledger was given something that is not an `ic-...` ID | Resolve first |
| `too_many_rows` | More than 500 rows in `resolve_many` | Split it, or use the CLI with `--file` |
| `request.invalid` | A missing, unknown or contradictory argument | Fix what the message names |

## Refused by Agentic ID

| Code | Status | Means | What to do |
| --- | --- | --- | --- |
| `auth.missing_key` / `auth.invalid_key` | 401 | No key, or the key is wrong or revoked | Call `agentic_id_status`. Tell the user to set the key in the plugin options. Never ask for it in chat |
| `credits.insufficient` | 402 | The wallet cannot cover the call (`available_credits` says what is left) | Stop and tell the user. Do not retry |
| `request.invalid` | 400 | A field failed the schema; `issues` lists each one | Fix them and call again |
| `find.persona_unreadable` | 400 | No job title or seniority could be read | Ask which roles matter |
| `lookalike.no_profile` | 400 | The seeds share nothing readable | Use 3 or more domains of a similar kind |
| `purpose.not_allowed` / `purpose.mismatch` | 403 | The data may not be used for this purpose | Use the right `purpose`; do not relabel to get around it |
| `pii.scope_required` | 403 | The key cannot read contact values | Values stay masked; the workspace owner can issue a key that reads them |
| `identity.merge_blocked` | 409 | Two records disagree on a strong identifier | Report both to the user; do not force it |
| `rate_limited` | 429 | Too many requests | The plugin waits and retries once. If it still fails, wait `retry_after_seconds` |
| `service.unavailable` | 503 | Agentic ID's service is down behind the API | Nothing was charged. Try once more later |

## No answer

| Code | Means | What to do |
| --- | --- | --- |
| `unreachable` | The API URL did not answer | Call `agentic_id_status`; check the URL in the plugin options |
| `timeout` | The call took too long | Discover and lookalike can take minutes. Narrow the filters or lower `max_accounts`, then retry once. A timed-out paid call may still have been charged: check with the user before repeating it |

## Not errors

- `outcome: "unresolvable"`, an empty `people[]` or `accounts[]`, or a result with no `fields`:
  Agentic ID does not know. Nothing was charged. Say so; never fill the gap yourself.
- `verdict: "unknown"` from validate: no answer this time, free, not a verdict against the address.
