# Agentic ID errors

Every error is JSON: `{ "error": "<code>", "message": "...", "fix": "..." }`. The `fix` line says
what to change. In MCP the result is marked as an error; the CLI exits with code 1 (API) or 2
(refused locally).

A refused request never reaches a data provider and costs nothing.

| Code | Means | What to do |
| --- | --- | --- |
| `invalid_input` | A field is missing, malformed, or test data | Fix the named field. Placeholders (`test@`, `demo@`, `Test User`, `example.com`, `.test` domains, `aaaa@`, `1234@`) are refused on purpose: ask the user for real input. |
| `consumer_data_v2` | Personal data was sent (free-mail address, phone, mobile, device ID) | Drop those values. Use B2B identifiers only. Do not retry with the same data. |
| `purpose_not_allowed` | `purpose` is not one of `b2b_outbound`, `ad_audience`, `own_customer_enrichment`, `fraud_check` | Omit `purpose` (the server default applies) or use an allowed value. |
| `name_only` | A person's name with nothing to anchor it | Ask for a company name or domain, a work email or a LinkedIn URL. |
| `verification_needed` | The input is well-formed but too weak to create or reuse an identity safely | Add corroborating evidence: a LinkedIn URL, a work email at the company domain, or a company domain for the name. |
| `identity_conflict` | The identifiers belong to two different existing records | Nothing was merged. Report both records to the user; do not pick one. |
| `bulk_confirm_required` | A find above 100 rows | Show the user the estimate. Resend with `confirm: true` only after their yes. |
| `credit_cap_reached` | `max_credits` cannot pay for even the cheapest paid step | Tell the user the minimum needed and ask before raising the cap. |
| `insufficient_credits` | The workspace balance cannot cover the call | Stop and tell the user. Do not retry. |
| `no_match` / `not_found` | Nothing found | Nothing was charged. Suggest another identifier or broader filters. |
| `idempotency_key_reused` | The same idempotency key was sent with a different request | Use a new key for a new request. |
| `rate_limited` | Too many requests | Wait for `Retry-After`, then retry once. |
| `provider_unavailable` | An upstream source failed or timed out | Nothing was charged. Retry once later, then report it with the `request_id`. |
| `internal_error` | Server fault | Nothing was charged. Retry once, then report it with the `request_id`. |
| `unauthorized` / 401 | Not signed in, or the key is wrong | MCP: sign in again (Claude Code: `/mcp`, pick `agentic-id`, Authenticate). CLI: ask the user to run `agentic-id doctor`, then `agentic-id login`. Never ask for the key in chat. |
