# Agentic ID tools: exact arguments

Every paid tool takes `max_credits` (whole number) and an optional `purpose`
(`b2b_outbound` by default; `ad_audience`, `own_customer_enrichment`, `fraud_check`).
Every answer carries `summary`, `cost: { quoted_credits, charged_credits }` and `request_id`.
Unknown arguments are refused before anything is sent.

`identifiers` is the same object everywhere:

```json
{ "email": "jane.doe@acme.io", "linkedin_url": "https://www.linkedin.com/in/jane-doe", "name": "Jane Doe", "company_name": "Acme", "company_domain": "acme.io" }
```

Any one strong identifier is enough. A name needs a company with it. Full URLs, `Name <email>`
and tracking parameters are cleaned for you.

## agentic_id_validate

```json
{ "emails": ["jane.doe@acme.io", "bob@acme.io"], "max_credits": 2 }
```

- `email` (one), `emails` (many; lists over 1,000 go in batches inside `max_credits`), `domain`
  (is the company domain live; free).
- Read back `results[]`: `email`, `verdict`, `reason`, `role` (true for shared mailboxes such as
  sales@).

| Verdict | Means | Charged |
| --- | --- | --- |
| `valid` | The mailbox exists | 1 |
| `invalid` | It does not | 1 |
| `catch-all` | The server accepts everything, so this address is not proven | 1 |
| `unknown` | No answer this time; not a verdict against the address | 0 |
| `rejected` | Malformed, disposable or personal; never checked | 0 |

Rows with `"checked": "locally"` were held back on this machine and never sent.

When `max_credits` is below the number of addresses, only as many as it can pay for are sent. The
rest come back `not_checked` (free), the answer is marked `partial: true`, and `stopped` says why.
Say how many were checked and how many were not; never call a partial run done.

## agentic_id_resolve

```json
{ "identifiers": { "email": "jane.doe@acme.io" } }
```

- `kind`: `person` or `company`; inferred when omitted (a company when only a domain or company
  name is given).
- `spend: true` asks paid sources when the ledger alone cannot resolve it. Default false.
- Read back `id`, `outcome`, `matched_on`, `confidence`, `reason`, `related[]`.

| Outcome | Means | What to do |
| --- | --- | --- |
| `known` | Already in the ledger | Use the `id` |
| `new` | Just created | Use the `id` |
| `review` | Probably an existing ID, not sure enough to link | Show the user `reason`; add another identifier and resolve again |
| `conflict` | The identifiers point at two different IDs | Nothing was merged. Report both; do not pick one |
| `unresolvable` | Not enough to go on (free) | Say why (`reason`), ask for a stronger identifier |

`related[]` lists companies that may belong with this one (a regional site, a brand). They are
linked for review, never merged.

## agentic_id_resolve_many

```json
{ "records": [{ "email": "jane.doe@acme.io" }, { "linkedin_url": "linkedin.com/in/jane-doe" }, { "company_domain": "acme.io" }], "max_credits": 3 }
```

- Up to 500 rows per call. Rows that are the same lookup are paid once.
- Read back `rows[]` (one per input row, in order: `row`, `id`, `outcome`, `repeat_of_row`),
  `counts`, and `same_id[]`: each `{ id, rows }` lists the input rows that are the same person or
  company. That is the duplicate report.
- `outcome: "skipped"` rows had only personal data and were not sent. `not_run` rows were not
  reached before the cap; `stopped` says why.
- A personal email, a phone number or a mail provider in the company field is held back too.

## agentic_id_enrich

```json
{ "contact": { "email": "jane.doe@acme.io" }, "fields": ["title", "company_domain"], "max_credits": 2 }
```

- `contact` (one), `contacts` (many; over 100 go in batches), `company: { "domain": "acme.io" }`
  (one), or `companies: [{ "domain": "acme.io" }, { "name": "Globex" }]` (an account list, 1 credit
  each). A contact with only a company on it (no email, LinkedIn URL or name) is enriched and
  priced as a company. Company results come back in `company_results[]`.
- When `max_credits` is below the full cost, only what it can pay for is sent: the rest comes back
  `not_run`, the answer is marked `partial: true` and `stopped` says why. Nothing is charged for
  what was not run.
- `fields`: only these; leave it out for everything. People: `work_email`, `linkedin_url`,
  `title`, `seniority`, `company_name`, `company_domain`, `location`, `city`, `country`.
  Companies: `name`, `domain`, `linkedin_url`, `industry`, `employees`, `revenue_usd`, `country`,
  `city`, `founded`, `description`. Other names are refused with the allowed list; phone fields
  are always refused.
- `status` per result: `outreach_ready` (the work email is verified and belongs to this person),
  `enriched` (trustworthy data, no email safe to send to), or a not-enriched status with the
  `reason`.
- Read back `results[]`: `id`, `status`, `reason`, and `fields[]` with `field`, `value`, `level`,
  `source`, `observed_at`. Report each value with its level.
- A result with no `fields` found nothing and was not charged.

## agentic_id_find

```json
{ "account": { "domain": "acme.io" }, "roles": ["VP Marketing", "Head of Growth"], "limit": 5, "max_credits": 10 }
```

- `account.domain` or `account.id` is required. To search people across companies use discover.
- `roles` (job titles) or `seniority` (`"director+"`, `"vp"`, `["vp", "c_suite"]`): at least one.
- `countries`: where the person is, as ISO codes. `limit`: default 5, max 25.
- `exclude_seen` (default true) skips people already delivered to this workspace, so the same call
  again returns the next people.
- Read back `people[]` (`id`, `name`, `title`, `email`, `level`), `excluded` (why candidates were
  left out, with counts) and `rejected` (filter values that could not be read).
- Former roles, advisors and board seats never count as holding the role.

## agentic_id_discover

```json
{ "account_filters": { "industry": ["software"], "country": ["GB"], "employees_min": 100, "employees_max": 2000 }, "count_only": true }
```

- `account_filters`: `industry`, `country` (ISO codes), `employees_min`, `employees_max`,
  `technologies`, `keywords` (rank only, unless `keywords_required: true`).
- `contact_filters` (optional): `job_title`, `job_level`, `countries`, `per_account` (default 1),
  `min_company_size`. Needs a title or a level.
- `max_accounts`: default 25, max 500. `exclude_seen`: default true.
- **Always run with `count_only: true` first**, even when the user already gave a budget. It is
  free and returns `total_matching` (how many companies match) and `plan` (what the search can
  filter by itself, and what Agentic ID checks after).
- Read back `accounts[]` (`id`, `domain`, `name`, `country`, `employees`, `size_check`,
  `charged`), `contacts[]`, `excluded`, `rejected`, `plan`.
- `size_check: "single"` means only one source confirmed the size; that account is delivered but
  not charged. Say so if size matters to the user.

## agentic_id_lookalike

```json
{ "seeds": ["acme.io", "globex.com", "initech.com"], "max_accounts": 10, "max_credits": 10 }
```

- `seeds`: 1 to 50 company domains. Three or more of a similar kind give a usable profile.
- Read back `profile` (what the seeds share: the search that was run), `seeds_rejected`,
  `accounts[]` with `similarity` and `why`, and `bigger_than_seeds` (share of results larger than
  the largest seed).
- Show the user `profile` before the list. If `bigger_than_seeds` is above 0.5, say the list leans
  to larger, well-known companies.

## agentic_id_facts

Only for an ID this workspace holds (one it resolved, enriched, found or discovered). Any other ID answers `id.not_held`; the same goes for `agentic_id_ledger`.

```json
{ "id": "ic-1VcQFNN5zwWguwAUaHEBNk" }
```

Read back `verified_id` (true or false), `missing[]` (what stops it being a Verified ID) and
`facts[]`: `fact`, `level`, `reason`, `independent_sources`, `recheck_at`, `evidence[]`. Free.

## agentic_id_ledger

```json
{ "id": "ic-1VcQFNN5zwWguwAUaHEBNk" }
```

Read back `entries[]` (`seq`, `kind`, `at`, `hash`, `prev_hash`, `detail`) and `verified` (the
whole hash chain re-checked). Free.

## agentic_id_workspace

Free. The workspace this caller acts as, in one answer.

```json
{ "recent": 10 }
```

- `recent` (0 to 200, default 10): how many of the latest grants and charges to list.
- Answer: `credits` (`balance`, `held`, `available`), `spent` (`today`, `last_30_days`, `by_tool`),
  `recent` (each with `at`, `kind` grant or charge, `credits`, `tool`), `ids_held`, `contributes`,
  `allowed_purposes`, `signed_in_as` (`account` or `api_key`), `contact_values`.
- `available` is what a new call can spend. `held` is reserved by calls still running.
- `contributes: true`: identifiers this workspace sends help every workspace resolve the same
  entity, and resolving an ID it already holds is free. `false`: they stay private to it.

## agentic_id_report

Free. What happened after a value was used.

```json
{ "id": "ic-1VcQFNN5zwWguwAUaHEBNk", "field": "work_email", "outcome": "bounced" }
```

```json
{ "reports": [ { "id": "ic-...", "outcome": "replied" }, { "id": "ic-...", "field": "title", "outcome": "wrong_person" } ] }
```

- `outcome`: `bounced`, `replied`, `wrong_person`, `confirmed`. Nothing else.
- `field`: `work_email` (default), `title`, `company_domain`. Phones and personal emails are
  refused on this machine.
- `id` must be an Agentic ID the workspace holds; otherwise that row comes back
  `feedback.not_held` and the rest still go.
- Up to 200 in `reports`. The same ID and field twice is sent once (the last one).
- Answer: `recorded` (count), `results` (one per report, with `recorded` and a `note`), `summary`.

## agentic_id_list

One action over a whole CSV file. Paid as the action; `dry_run` is free.

```json
{ "action": "resolve", "file": "/full/path/leads.csv", "dry_run": true }
```

```json
{ "action": "validate", "file": "/full/path/leads.csv", "max_credits": 200, "out": "/full/path/leads.checked.csv" }
```

- `action`: `validate`, `resolve`, `enrich`, `report`.
- Always `dry_run: true` first, then the real call with `max_credits`. Without `max_credits` a
  paid run is refused with the estimate.
- `out` defaults to `<name>.agentic-id.csv` next to the input. The input is never overwritten.
- `fields` (enrich), `column` / `columns` (when headers are unusual), `limit_rows` (a sample),
  `field` (report: what every outcome is about).
- Answer: `summary`, `cost`, `rows`, `out_file`, `added_columns`. Rows are not returned: read the
  result file's first lines if the user wants a look.

## agentic_id_login

Free. `{}` to sign in, `{ "action": "logout" }` to sign out.

- The first call opens the browser and answers `status: "waiting_for_browser"` with a `link`.
  Show the link. After the user says they signed in, call again: it answers `signed_in: true`
  with the workspace.
- An API key in the plugin options takes precedence over a sign-in.

## agentic_id_estimate

```json
{ "tool": "discover", "arguments": { "max_accounts": 50, "contact_filters": { "job_title": ["CTO"], "per_account": 2 } } }
```

Returns `max_credits` and `arithmetic` without contacting Agentic ID. Free.

## agentic_id_status

No arguments. Returns `ok`, `server_url`, `workspace_id`, `scopes` and whether contact values are
readable or masked. Never returns the key. Free.
