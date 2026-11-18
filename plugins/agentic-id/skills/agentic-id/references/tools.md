# Agentic ID tools: exact arguments

These are the tools of iCustomer's hosted Agentic ID server. In Claude Code their ids are
`mcp__plugin_agentic-id_agentic-id__<tool>`.

Every paid tool takes `max_credits` (whole number, 0 to 100,000; the call is never charged past
it) and an optional `purpose` (`b2b_outbound` by default; `ad_audience`,
`own_customer_enrichment`, `fraud_check`). Every answer carries a `cost` block
(`quoted_credits`, `charged_credits`) and a `request_id`. Unknown arguments are refused.

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

- `email` (one), `emails` (up to 1,000), or `domain` (is the company domain live).
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
- `country`: where the person is (not the company's head office), as ISO codes. `limit`: 1 to 25,
  default 5.
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

- `account_filters` (required): `industry`, `country` (ISO codes), `employees_min`,
  `employees_max`, `revenue_min`, `revenue_max` (USD), `revenue_range` (e.g. `["10M-50M"]`),
  `founded_from`, `founded_to`, `funding_stage`, `technologies`, `keywords` (rank only, unless
  `keywords_required: true` or they are the only filter).
- `contact_filters` (optional): `title`, `seniority`, `job_function`, `country`, `per_account`
  (1 to 10), `min_company_size`, `include_unconfirmed` (as in find).
- `max_accounts`: 1 to 500, default 25. `exclude_seen`: default true.
- **Always run with `count_only: true` first**, even when the user already gave a budget. It is
  free and says how many companies match and what the search can filter by itself.
- Then the paid call with `max_credits`: at most `max_accounts x 1` plus
  `max_accounts x per_account x 2` when people are wanted.
- Read back `accounts[]`, `contacts[]`, `excluded`, `rejected`. A value in `rejected` was not
  applied: fix it before buying.

## lookalike

```json
{ "seeds": ["acme.io", "globex.com", "initech.com"], "max_accounts": 10, "max_credits": 10 }
```

- `seeds` (required): 1 to 50 company domains. Three or more of a similar kind give a usable
  profile. Seeds are never returned.
- `max_accounts` (default 25), `exclude_seen` (default true). 1 credit per account.
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

## Not on the hosted server

| Need | Use |
| --- | --- |
| A cost estimate before calling | The prices in the `agentic-id-credits` skill; `discover` with `count_only`; `agentic-id estimate` (CLI) |
| A whole CSV file (validate, resolve, enrich, report) | `agentic-id <command> --file ... --dry-run`, then with `--max-credits` (CLI) |
| Sign in, check the connection | `/mcp` in Claude Code; for the CLI, `agentic-id login` and `agentic-id doctor` |

Check the CLI is installed with `agentic-id --version` before relying on it. If it is not, the
user can install it from npm: https://www.npmjs.com/package/agentic-id.
