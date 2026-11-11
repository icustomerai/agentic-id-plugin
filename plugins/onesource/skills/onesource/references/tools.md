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

Fill missing fields on a person or a company.

By contact, without resolving first (add `job_title` when the list has one; it is used to check
the match):
```json
{ "contact": { "name": "Jane Doe", "company_domain": "acme.com", "job_title": "VP Marketing" }, "required_fields": ["email", "job_title", "linkedin"], "max_credits": 5 }
```

Many contacts (up to 100):
```json
{ "contacts": [ { "email": "jane@acme.com" }, { "name": "Raj Patel", "company_domain": "globex.com" } ], "required_fields": ["job_title"], "max_credits": 20 }
```

Companies (up to 100), by domain or name:
```json
{ "accounts": [ { "domain": "acme.com" }, { "name": "Globex" } ], "required_fields": ["industry", "employee_size", "location"], "max_credits": 10 }
```

By identity (from resolve; a company DID goes to company enrichment):
```json
{ "id": "did:icustomer:global:person:4f1c...", "fields": ["title", "company"], "max_credits": 2 }
```

- Use exactly one of `id`, `contact`/`contacts` or `account`/`accounts`.
- `required_fields` returns only those fields and is cheaper. Contact names: `email`,
  `job_title`, `linkedin`, `location`, `phone`. Company names: `industry`, `employee_size`,
  `location`, `revenue`, `country`, `description`, `linkedin`, `phone`. An unknown name is
  refused for free, with the allowed list in the message: pick from that list, do not guess
  (`work_email` is not a name; use `email`).
- Contacts only: `trust_mode: "enforce"` drops contradicted fields and holds back unverified
  email/LinkedIn; `list_context` ("VP Marketing at B2B SaaS") helps judge fit.
- No other top-level keys are accepted. Identity values go inside `contact` / `account`.

CLI: `onesource enrich --name "Jane Doe" --company-domain acme.com --job-title "VP Marketing" --max-credits 5 --json`,
`onesource enrich --account acme.com,globex.com --required-fields industry,employee_size --max-credits 10`.

Read back, contacts:
- `trust.status` per person: **Enriched with email** (outreach-ready: the email is verified and
  belongs to this person), **Enriched** (trustworthy data, but no email safe to send to), or
  **Not Enriched** (no match, or the match was rejected). `trust.verdict`, `trust.confidence`
  and `trust.reason` explain it. Batch: each `results[]` row has `status`, `confidence` and
  `reason`, and `outreach_ready` counts the rows safe to email.
- Only outreach-ready rows belong in an email campaign. For an Enriched row, say the email is not
  confirmed; do not present it as safe.

Read back, all:
- `enriched`: field → value.
- `coverage_pct` (a fraction: 1 = every requested field).
- `missing_fields`: report these as missing. Never fill them in yourself.
- `provenance`: where each field came from.
- Batch: `results[]`.

## find

The decision makers at a known company.

```json
{ "account": { "domain": "acme.com" }, "roles": ["VP Marketing"], "seniority": ["VP"], "limit": 5, "max_credits": 5 }
```

- Identify the company by `account.domain` (required; add `account.id` / `account.name` if
  known). Without a domain, `roles` search across companies.
- `roles` are job titles; `job_function` (e.g. "Marketing") and `seniority` (VP, Director,
  C-Level, Head) narrow further. With none of them, decision makers (C-level, VP, head, director)
  are searched, and the summary says so.
- Always pass `limit`: default 20, max 100. 1 credit per person returned.

CLI: `onesource find --domain acme.com --roles "VP Marketing" --seniority VP --limit 5 --max-credits 5 --json`

Read back:
- `people[]`, each with `name`, `title`, `seniority`, `company`, `company_domain`,
  `linkedin_url`, `work_email` and `source`.
- `total_found` and `warnings` (why fewer came back).

`work_email` from find is an unverified claim. Validate it before anyone sends to it. If the
people returned do not match the roles you asked for, say so. Do not present them as matches.

## discover

Net-new companies, and the decision makers in them, that match an ICP. Every account returned
meets every account filter.

```json
{
  "account_filters": { "industry": ["Software Development"], "country": ["US"], "employee": ["1001-5000"] },
  "contact_filters": { "job_title": ["VP Marketing"], "job_level": ["VP", "Head"] },
  "limit": 10,
  "max_credits": 15
}
```

- At least one filter is required.
- Account filters: `industry`, `country`, `employee` (size bands: `51-200`, `201-500`,
  `1001-5000`, `10001+`), `revenue` (`10M-50M`, `1B+`, `<5M`), `keywords` (in the company
  description), `tech_stack`.
- Contact filters: `job_title`, `job_function`, `job_level` (seniority), `exclude_titles`.
- Account filters alone return accounts only (`mode: accounts_only`). Contact filters alone (a
  country may be added) search people across companies (`mode: persona`).
- Price: 1 credit per account plus 1 per contact. `max_credits` is split across both before
  anything runs, so the call can never cost more; `contacts_per_account` (default 2) and `limit`
  size it.
- `group_by_account` (default `true`) nests contacts under their accounts.

CLI: `onesource discover --industry "Software Development" --country US --employee 1001-5000 --job-title "VP Marketing" --limit 10 --max-credits 15 --json`

Read back:
- `accounts[]` (each with its contacts) or `contacts[]`
- `returned_count`, `account_count`, `credits_charged`
- `dropped`: how many candidate accounts each filter left out, largest first. On a short result,
  tell the user which filter to widen.
- `warnings`, and `partial: true` if the contact step failed after the accounts were charged.
