# OneSource tools: exact calls

Each verb below shows the MCP arguments, the same call through the CLI, and the fields to read
back. Every answer also carries `cost` (`quoted_credits`, `charged_credits`), a one-line
`summary`, and a `request_id` to quote when something looks wrong.

## validate

Is a work email deliverable? Or is a company domain real?

Three input shapes. Use exactly one.

```json
{ "identifiers": { "email": "jane@acme.com" }, "max_credits": 1 }
```
```json
{ "emails": ["jane@acme.com", "raj@globex.com"], "max_credits": 2 }
```
```json
{ "domain": "acme.com", "max_credits": 1 }
```

- One address: `identifiers.email`. Not `email` at the top level.
- Two or more: `emails` (up to 1000). One call, one quote.
- Domain only: free, no email check, no identity created.
- An existing identity: `{ "identifiers": { "id": "os_..." }, "max_credits": 1 }`.

CLI: `onesource validate --email jane@acme.com --max-credits 1 --json`. Batch:
`echo '{"emails":[...],"max_credits":2}' | onesource validate --input - --json`.
Domain: `onesource validate --domain acme.com --max-credits 1 --json`.

Read back:
- `email_validation.status`: `valid`, `invalid`, `catch-all`, `risky` or `unknown`.
  - `catch-all`: the domain accepts everything, so the mailbox itself is unconfirmed.
  - `unknown`: the verifier could not decide. It is free, and it does not mean the address is bad.
- Batch: `results[]` (one per address), `total`, `rejected`.
- `domain_verification` for the domain check.

## resolve

Who is this? Returns a stable OneSource identity.

```json
{ "identifiers": { "email": "jane@acme.com" }, "max_credits": 1 }
```
```json
{ "identifiers": { "linkedin_url": "https://www.linkedin.com/in/jane-doe" }, "max_credits": 1 }
```
```json
{ "identifiers": { "name": "Jane Doe", "company_domain": "acme.com" }, "max_credits": 1 }
```

- Put identifiers inside `identifiers`.
- A name alone is not enough. Add a company domain, company name, email or LinkedIn URL.

CLI: `onesource resolve --email jane@acme.com --max-credits 1 --json` (also `--linkedin-url`,
`--name`, `--company-domain`, `--company-name`).

Read back:
- `universal_did`: the identity to carry into enrich.
- `golden_record_did`: your workspace's record of the same person.
- `found`: `true` means OneSource already holds an enriched record, so enrich may be unnecessary.
- `identity_state`:
  - `needs_evidence`: ask the user for one of the `required_evidence` items. Do not guess.
  - `conflict`: the identifiers point at two records. Report both `conflict_ids` and pick neither.

## enrich

Fill missing fields on a person.

By identity (from resolve):
```json
{ "id": "did:icustomer:global:person:4f1c...", "fields": ["title", "company"], "max_credits": 2 }
```

By contact, without resolving first:
```json
{ "contact": { "email": "jane@acme.com" }, "required_fields": ["job_title", "company"], "max_credits": 3 }
```

Many contacts (up to 100):
```json
{ "contacts": [ { "email": "jane@acme.com" }, { "name": "Raj Patel", "company_domain": "globex.com" } ], "required_fields": ["job_title"], "max_credits": 10 }
```

- Use exactly one of `id`, `contact` or `contacts`.
- `required_fields` returns only those fields and is cheaper. Use it when the user needs specific
  fields.
- No other top-level keys are accepted. Identity values go inside `contact`.

CLI: `onesource enrich --id <did> --fields title,company --max-credits 2 --json`. For `contact` or
`contacts`, send the JSON body with `--input -`.

Read back:
- `enriched`: field → value.
- `coverage_pct`.
- `missing_fields`: report these as missing. Never fill them in yourself.
- `provenance`: where each field came from.
- Batch: `results[]`.

## find

The people in a role at a known company.

```json
{ "account": { "domain": "acme.com" }, "roles": ["VP Marketing"], "seniority": ["VP"], "limit": 5, "max_credits": 10 }
```

- Identify the company by `account.domain`, `account.id` (a company DID) or `account.name`.
- Narrow with `roles` and `seniority`, or the exact taxonomy filters `job_function` and
  `job_level`.
- Always pass `limit`: default 20, max 100. Above 100 needs `confirm: true` and the user's yes.
- Set `max_credits` to at least `limit` × the price per person (see the `onesource-credits`
  skill).
- Repeat calls page through people you have not been shown yet.

CLI: `onesource find --domain acme.com --roles "VP Marketing" --seniority VP --limit 5 --max-credits 10 --json`

Read back:
- `people[]`, each with `name`, `title`, `seniority`, `company`, `company_domain`,
  `linkedin_url`, `work_email`, `match_confidence` and `source`.
- `total_found`: how many exist at the account.

`work_email` from find is an unverified claim. Validate it before anyone sends to it. If the
people returned do not match the roles you asked for, say so. Do not present them as matches.

## discover

Net-new companies and people that match an ICP.

```json
{
  "account_filters": { "industry": ["Software Development"], "country": ["United States"], "employee": ["51-200"] },
  "contact_filters": { "job_level": ["VP / Head"], "job_function": ["Sales & Business Development"] },
  "limit": 10,
  "max_credits": 10
}
```

- At least one filter is required.
- Account filters: `industry`, `country`, `employee`, `revenue`.
- Contact filters: `job_function`, `job_level`, `job_title`.
- Always pass `limit`. Discover charges 1 credit per contact returned, and `max_credits` also caps
  the row count.
- `group_by_account` (default `true`) nests contacts under their accounts.
- `exclude_seen` (default `true`) makes a repeat call return the next page of net-new people.
  Page again only with the user's yes.
- `max_accounts` caps how many companies contribute.

CLI: `onesource discover --industry "Software Development" --country "United States" --job-level "VP / Head" --limit 10 --max-credits 10 --json`

Read back:
- `accounts[]` (each with its contacts) or `contacts[]`
- `returned_count` and `account_count`
- `filters_applied`
- `credits_charged`
