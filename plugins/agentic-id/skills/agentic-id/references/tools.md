# Agentic ID tools: exact arguments

These are the tools of iCustomer's hosted Agentic ID server. In Claude Code their ids are
`mcp__plugin_agentic-id_agentic-id__<tool>`.

Every paid tool takes `max_credits` (whole number, 0 to 100,000; the call is never charged past
it) and an optional `purpose` (`b2b_outbound` by default; `ad_audience`,
`own_customer_enrichment`, `fraud_check`). Every answer carries a `cost` block
(`quoted_credits`, `charged_credits`) and a `request_id`. Unknown arguments are refused.

Every paid tool also takes:
- `preview: true`: free. What the call would do and the most it could cost (`quote.credits_max`,
  `quote.results_expected`, `quote.runs_as`), with a `plan_id` good for 30 minutes. Nothing is
  delivered or charged. On `discover`, `count_only: true` is the old name and still works.
- `plan_id`: runs exactly what a preview quoted. Send it with `max_credits` in place of the other
  arguments. In apps that show the Agentic ID card, the user approves a preview in the card (with
  their own credit cap) and the card runs it. Run a `plan_id` yourself there only when the user
  asks in the chat. See "When the Agentic ID card shows the answer" in `agentic-id-credits`.

A call that is bigger than one answer (more than 25 people, 500 accounts, 1,000 emails or 250
contacts), or slower than about 10 seconds, carries on as a **run**: the answer has its first
`results`, a `run_id`, a `status` and a `summary`. See "Runs" below.

`identifiers` (resolve) and `contact` (enrich) are the same object:

```json
{ "email": "jane.doe@acme.io", "linkedin_url": "https://www.linkedin.com/in/jane-doe", "name": "Jane Doe", "company_name": "Acme", "company_domain": "acme.io" }
```

Also accepted: `id` (an `ic-...` ID the workspace holds, or a legacy ID), `crm_id`,
`customer_id`, `loyalty_id` (find a person you linked before; never create one), and `phone`
(used to match only, never to link). Any one strong identifier is enough. A name needs a company
with it. Do not send personal emails or personal phone numbers.

## validate

```json
{ "emails": ["jane.doe@acme.io", "bob@acme.io"], "max_credits": 2 }
```

- `email` (one), `emails` (up to 1,000 in one answer; up to 10,000 carry on as a run), or `domain` (is the company domain live).
- Read back each result: `email`, `verdict`, `reason`, and whether it is a shared role mailbox
  such as sales@.

| Verdict | Means | Charged |
| --- | --- | --- |
| `valid` | The mailbox exists | 1 |
| `invalid` | It does not | 1 |
| `catch-all` | The server accepts everything, so this address is not proven | 1 |
| `unknown` | No answer this time; not a verdict against the address | 0 |
| refused | Malformed, disposable or personal; never checked | 0 |

When `max_credits` is below the number of addresses, only as many as it can pay for are checked.
The rest come back not checked (free) and the answer is marked `partial: true`. Say how many were
checked and how many were not; never call a partial run done.

## resolve

```json
{ "identifiers": { "email": "jane.doe@acme.io" }, "max_credits": 1 }
```

- `identifiers` is required. One record per call.
- `kind`: `person` or `company`; inferred when omitted (a person if any person field is given).
- `spend: true` asks paid sources when the ledger alone cannot resolve it. Default false. Only
  set it when the user wants paid lookups, and always with `max_credits`.
- Read back `id`, `outcome`, `matched_on`, `confidence`, `reason`, `related[]`.

| Outcome | Means | What to do |
| --- | --- | --- |
| `known` | Already in the ledger (not necessarily held by this workspace) | Use the `id` |
| `new` | Just created | Use the `id` |
| `review` | Probably an existing ID, not sure enough to link | Show the user `reason`; add another identifier and resolve again |
| `conflict` | The identifiers point at two different IDs | Nothing was merged. Report both; do not pick one |
| `unresolvable` | Not enough to go on (free) | Say why (`reason`), ask for a stronger identifier |

`confidence` is how sure the identifier points at that ID, not how verified its facts are.
`related[]` lists companies that may belong with this one (a regional site, a brand). They are
linked for review, never merged.

**Duplicates in a short list.** There is no batch resolve. Call `resolve` once per row and group
the rows by the `id` that comes back: two rows with the same `id` are the same person or company.
Agree the budget first (up to 1 credit per row). For a CSV file, use the CLI's
`agentic-id resolve --file` instead (see [cli.md](cli.md)); it writes a `same_id_as_row` column.

## enrich

```json
{ "contact": { "email": "jane.doe@acme.io" }, "fields": ["title", "company_domain"], "max_credits": 2 }
```

- `max_credits` is required.
- `contact` (one), `contacts` (up to 250, looked up side by side), or
  `company: { "domain": "acme.io" }` (or `name`). For several companies, one call per company.
- `fields`: only these, or `["all"]`. People: `work_email`, `linkedin_url`, `title`,
  `seniority`, `company_name`, `company_domain`, `location`, `city`, `country`. Companies also
  have `industry`, `employees`, `revenue_range`, `founded`, `naics_codes`, technologies, funding,
  keywords and the head-office address; a company's extra fields cost nothing more.
- When `max_credits` is below the full cost, only what it can pay for is run; the answer is
  marked `partial: true`. Nothing is charged for what was not run.
- Read back each result: `id`, `status`, `reason`, and `fields[]` with `field`, `value`, `level`.
  Report each value with its level. A result with no fields found nothing and was not charged.

## find

```json
{ "account": { "domain": "acme.io" }, "title": ["VP Marketing", "Head of Growth"], "limit": 5, "max_credits": 10 }
```

- `account` (`domain` or `id`) and `max_credits` are required. To search people across
  companies use discover.
- `title` (job titles), `seniority` (`"director+"`, `["vp", "c_suite"]`, `"all"`) and
  `job_function` (`"marketing"`, `["sales", "information_technology"]`). Leave all three out for
  everyone at the company.
- `country`: where the person is (not the company's head office), as ISO codes. `limit`: default
  5; up to 25 answer in one call, more (up to 50,000) carry on as a run.
- `exclude_seen` (default true) skips people already delivered to this workspace, so the same call
  again returns the next people.
- `include_unconfirmed` (default true): people a source places at the company but whose employer
  cannot be confirmed come back flagged (`employment.status: "unconfirmed"`, with
  `employment.flag` saying why) **and are charged**. Set it to false to leave them out.
- Read back `status` (`found`, `none_found`, `not_checked`, `partly_checked`), `people[]` (`id`,
  `name`, `title`, `email`, `level`, `employment`), `excluded` and `rejected`.
- `not_checked` means a source was down: unknown, not "nobody works there".
- Former roles, advisors and board seats never count as holding the role.
- 2 credits per person returned; repeats and IDs the workspace holds are free. Budget
  `limit x 2`.

## discover

```json
{ "account_filters": { "industry": ["software"], "country": ["GB"], "employees_min": 100, "employees_max": 2000 }, "count_only": true }
```

Or in the user's own words, previewed first:

```json
{ "ask": "mid-size diagnostic imaging centres in Texas", "preview": true }
```

- `ask` (3 to 500 characters): the request in plain words. It is read into `account_filters` for
  free; `intent.read_as` says how. Filters sent as well win. When it could mean more than one
  search, a preview lists each reading (`intent.readings`) and a paid call is refused
  (`intent.ambiguous`, nothing charged) until the user picks one: send that reading's
  `account_filters`, or run the preview's `plan_id`.
- `account_filters`: `industry`, `naics` (codes of 2 to 6 digits; a short code covers its
  children), `sic` (2 to 4 digits), `country` (ISO codes), `employees_min`,
  `employees_max`, `revenue_min`, `revenue_max` (USD), `revenue_range` (e.g. `["10M-50M"]`),
  `founded_from`, `founded_to`, `funding_stage`, `technologies`, `keywords` (rank only, unless
  `keywords_required: true` or they are the only filter).
- `contact_filters` (optional): `title`, `seniority`, `job_function`, `country`, `per_account`
  (1 to 10), `min_company_size`, `include_unconfirmed` (as in find).
- `max_accounts`: default 25; up to 500 answer in one call, more (up to 50,000) carry on as a run.
  `exclude_seen`: default true.
- `min_trust` (`A`, `B`, `C` or `D`): deliver only accounts at that trust grade or better; the rest
  are left out (`excluded.below_min_trust`) and not charged.
- **Always run with `count_only: true` first**, even when the user already gave a budget. It is
  free and says how many companies match and what the search can filter by itself.
- Then the paid call with `max_credits`: at most `max_accounts x 1` plus
  `max_accounts x per_account x 2` when people are wanted.
- Read back `accounts[]`, `contacts[]`, `excluded`, `rejected`. A value in `rejected` was not
  applied: fix it before buying. `filters_read_as` says how a plain word was read (an industry
  word read as a NAICS code, for example).
- Each account has `domain`, `name`, `country`, `employees`, `industry`, `naics` (when known),
  `size_check` (`confirmed`: two independent sources agree on the size; `single`: one source
  only; charged either way) and `trust`: `grade` A to D and a one-line `summary`. Repeat both as
  given. People carry the same `trust` block.

## lookalike

```json
{ "seeds": ["acme.io", "globex.com", "initech.com"], "max_accounts": 10, "max_credits": 10 }
```

- `seeds` (required): 1 to 50 company domains. Three or more of a similar kind give a usable
  profile. Seeds are never returned.
- `max_accounts` (default 25; more than 500 carry on as a run), `exclude_seen` (default true),
  `min_trust` (as in discover). 1 credit per account.
- Read back the shared profile (what the seeds share: the search that was run), the accounts with
  how alike they are and why, and `bigger_than_seeds`.
- Show the user the profile before the list. If `bigger_than_seeds` is above 0.5, say the list
  leans to larger, well-known companies.

## facts

Free. For an ID this workspace holds (one it resolved, enriched, found or discovered).

```json
{ "id": "ic-1VcQFNN5zwWguwAUaHEBNk" }
```

Read back whether it is a Verified ID, what is missing for that, and each fact with its `level`,
`reason`, independent sources and evidence.

## ledger

Free. Same rule on which IDs.

```json
{ "id": "ic-1VcQFNN5zwWguwAUaHEBNk" }
```

Read back the entries (created, linked, merged, each hash-linked to the one before) and whether
the whole chain re-checked.

## feedback

Free. What happened after a value was used. One value per call.

```json
{ "id": "ic-1VcQFNN5zwWguwAUaHEBNk", "field": "work_email", "outcome": "bounced" }
```

- All three are required.
- `field`: `work_email`, `title`, `company_domain` (also `personal_email`, `mobile_phone`,
  `phone`, which this plugin's B2B rules do not use).
- `outcome`: `bounced`, `replied`, `wrong_person`, `left_company` (use with
  `company_domain`), `confirmed`. Nothing else.
- `id` must be an Agentic ID the workspace holds.
- It changes only this workspace's view: a value reported as wrong is no longer delivered to it
  and shows as `contradicted` in facts.

## credits

Free. No arguments are needed.

- `limit` (0-200, default 20): how many recent grants, charges and delivered IDs to list.

The answer starts with one line, for example "100 credits available (12 credits held by calls
still running). Spent 3 credits today and 41 credits in the last 30 days.", then the whole record:

| Field | What it holds |
| --- | --- |
| `credits.available` | What a new call can spend now. Report this as the balance |
| `credits.held` | Reserved by calls still running |
| `credits.balance` | `available` plus `held` |
| `spent.today`, `spent.last_30_days` | Credits spent (the day is UTC) |
| `spent.by_tool` | `tool`, `credits`, `calls` for each tool |
| `recent` | The latest grants and charges: `at`, `kind` (`grant` or `charge`), `credits`, `tool`, `note` |
| `recent_ids` | The latest IDs delivered and what each cost; a company carries its name or domain, a person only the ID |

It is the billing record. Use it for "how many credits do I have", "what did I spend" and "what was
that charge for". Never answer those from memory or from the `cost` blocks of this conversation.
Newer servers add `topups`: the latest credit purchases (`credits`, `amount_usd`, `status`
pending, paid, expired or failed, `created_at`, `paid_at`).

## topup

Free to call; it charges nothing. Returns a link to a secure payment page where the user buys
credits.

- `credits` (required): a whole number, 100 to 200,000. One credit is $0.05.

```json
{ "credits": 1000 }
```

The answer has `summary`, `url` (the payment page), `credits`, `amount_usd`, `topup_id` and
sometimes `expires_at`. Give the user the `url`. Nothing is charged until they pay there; the
credits land seconds after. `topup.unavailable` means this server cannot sell credits: the user
adds them through their iCustomer account or team.

## Runs

Free. For a call that answered with a `run_id`. The run carries on by itself whether or not
anyone reads it; reading its results again never charges again.

| Tool | Arguments | What it does |
| --- | --- | --- |
| `run_status` | `run_id` | Where it stands: `status`, `progress`, credits charged |
| `run_results` | `run_id`, `after` (from the last answer) | The next results, waiting up to 10 seconds for new ones |
| `run_export` | `run_id` | A download link for every result as CSV, good for an hour. Anyone with the link can open it: give it only to the user |
| `run_cancel` | `run_id` | Stops it: nothing more is spent; what was delivered stays delivered and charged |
| `run_resume` | `run_id`, `max_credits` | Carries on with a paused run. It spends again: only with the user's yes and their number |

What `status` means, in words the user understands:

| Status | Means |
| --- | --- |
| `completed` | Everything asked for was delivered |
| `exhausted` | Finished with fewer than asked: fewer exist that pass the checks. `why_fewer` has the numbers and the reasons |
| `running` | Still going; more is coming. `waiting` says why nothing is running right now and when it carries on |
| `paused` | Stopped for now. `reason`: `credits` (the workspace ran out: buy more, then resume), `max_credits` (its own cap: resume with a higher one), `source_cap` (its budget for paid data) |
| `cancelled` | It was stopped; what came stays delivered and charged |
| `failed` | It could not run (`error.code`) |

## Not on the hosted server

| Need | Use |
| --- | --- |
| A cost estimate before calling | The prices in the `agentic-id-credits` skill; `discover` with `count_only`; `agentic-id estimate` (CLI) |
| A whole CSV file (validate, resolve, enrich, report) | `agentic-id <command> --file ... --dry-run`, then with `--max-credits` (CLI) |
| Sign in, check the connection | `/mcp` in Claude Code; for the CLI, `agentic-id login` and `agentic-id doctor` |
| Make, list or revoke API keys | `agentic-id keys` (CLI, signed in). The user runs it; the key is shown to them once |

Check the CLI is installed with `agentic-id --version` before relying on it. If it is not, the
user can install it from npm: https://www.npmjs.com/package/agentic-id.
