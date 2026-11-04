---
name: onesource
description: Guide to the five OneSource tools - validate (B2B email deliverability), resolve (identifier to OneSource identity), enrich (fill missing fields), find (people inside a known company), discover (net-new accounts and contacts from ICP filters) - and the credit rules for calling them. Use whenever a task involves checking a work email, looking up or enriching a B2B contact or company, finding a buying group, or building a prospect list. B2B only.
---

# OneSource

OneSource is iCustomer's B2B identity and enrichment service. Its MCP server exposes exactly five
tools. In Claude Code they appear as `mcp__plugin_onesource_onesource__onesource_<verb>` (or
`mcp__<server>__onesource_<verb>` when the server is configured by hand). This guide calls them by
their short names.

## Which tool, when

| Need | Tool | Key input | Typical cost |
| --- | --- | --- | --- |
| Is this work email real / deliverable? | `onesource_validate` | `identifiers.email`, or `emails` (batch, up to 1000), or `domain` alone | 1 credit per address with a verdict; `invalid`, `unknown`, rejected and domain-only are free |
| Who is this? Give me a stable ID | `onesource_resolve` | `identifiers.email` or `identifiers.linkedin_url` (or name plus company) | free on the live backend; see `onesource-credits` |
| Fill in title, company, work email... | `onesource_enrich` | `id` (a DID from resolve), or `contact` / `contacts` (up to 100) | per lookup that filled a field |
| Who works at this company in role X? | `onesource_find` | `account.domain` or `account.id`, `roles` / `seniority` (or `job_function` / `job_level`), `limit` | per person returned |
| Which companies and people match my ICP? | `onesource_discover` | `account_filters`, `contact_filters`, `limit` | 1 credit per contact returned |

Work in this order of need and stop as soon as the question is answered: validate, then resolve,
then enrich, then find, then discover. Do not enrich to answer a question validate or resolve
already answered.

### Tool notes

- **validate** - verdicts are `valid`, `invalid`, `catch-all`, `risky` and `unknown`. `unknown`
  means the verifier could not decide; it is free and is not a claim the address is bad.
  `catch-all` means the domain accepts everything, so the mailbox itself is unconfirmed. A
  `domain` on its own verifies the company domain for free. Batch with `emails` whenever there is
  more than one address.
- **resolve** - returns `universal_did`, `golden_record_did` and `found` (whether OneSource already
  holds an enriched record). A name with no company, domain, email or LinkedIn URL comes back as
  `identity_state: "needs_evidence"`: ask the user for one of the `required_evidence` items rather
  than guessing. `identity_state: "conflict"` means the identifiers point at two records; report
  both `conflict_ids`, do not pick one.
- **enrich** - read back `coverage_pct`, `missing_fields` and `field_sources` / `provenance`.
  Use `required_fields` when the user only needs specific fields; it is cheaper than a full fill.
  Report missing fields as missing; never fill them in yourself.
- **find** - scope by `account.domain` or a company DID in `account.id`. `limit` defaults to 20
  and maxes at 100 (above that needs `confirm: true` and the user's explicit yes). Repeat calls
  page through net-new people. Provider emails returned by find are unverified claims; validate
  them before anyone sends to them.
- **discover** - at least one filter is required. Results are grouped by account unless
  `group_by_account: false`. `exclude_seen` (default true) makes repeat calls page through the
  segment instead of returning the same people.

## Credit rules (always)

1. **State the credits.** After every call, tell the user `cost.charged_credits` (and
   `cost.quoted_credits` when it differs). For a multi-step task, finish with credits per step and
   the total. If a response carries no cost block, say so rather than assuming zero.
2. **`max_credits` is the user's budget, not yours.** validate, resolve, enrich and find require
   it. Set it to the smallest value that covers the request (see the `onesource-credits` skill for
   prices). Never raise it, or retry with a higher one, without the user's yes.
3. **Never call `find` or `discover` without an explicit `limit`.** Agree the number with the user
   when it would cost more than a few credits; for exploration start with 5 to 10.
4. **Batch when you can** (`emails` for validate, `contacts` for enrich): one call, one quote.
5. **Do not retry paid calls blindly.** `insufficient_credits` means stop and tell the user.
   `credit_cap_reached` means the budget is below the cheapest paid step; ask before raising it.

## B2B only (hard rule)

- Work emails, LinkedIn profile URLs, names with a company, company domains. Nothing else.
- Never send, ask for or try to obtain personal email addresses, phone or mobile numbers, device
  IDs or home addresses. Free-mail addresses (gmail.com, outlook.com, yahoo.com, ...) are refused
  with `consumer_data_v2`; do not work around that.
- Never invent identities. `found: false`, `id: null` or an empty result means OneSource does not
  know them. Say that.
- Do not paste bulk personal data back into the chat unless the user asked for it; summarise and
  offer to write a file instead.

## Errors

Error results are JSON: `{ "error": "<code>", "message": "...", "fix": "..." }`. Follow the `fix`.

| Code | What to do |
| --- | --- |
| `invalid_input` | Correct the named field. Placeholder or test data (`test@`, `Test User`, `example.com`) is refused on purpose; ask for real input. |
| `consumer_data_v2` | Personal data was sent. Drop it; B2B identifiers only. |
| `credit_cap_reached` | `max_credits` is below the cheapest paid step. Ask the user before raising it. |
| `insufficient_credits` | The workspace balance cannot cover the quote. Stop and tell the user. |
| `no_match` / `not_found` | Nothing found; nothing charged. Suggest broader filters or another identifier. |
| `provider_unavailable` | Upstream failure; nothing charged. Retry once later, then report. |
| 401 / sign-in prompt | The user is not signed in. Ask them to run `/mcp` and authenticate the `onesource` server. |
