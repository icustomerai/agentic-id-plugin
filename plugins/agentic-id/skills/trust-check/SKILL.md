---
name: trust-check
description: Check how far a person or company record can be trusted before acting on it - read each fact's level (verified, corroborated, claimed, contradicted) and evidence from Agentic ID, say whether the ID is a Verified ID and what is missing, and explain an ID's history from the ledger. Use for "is this email safe to send to", "is this title still current", "can I trust this record", "is this a verified ID", "why were these two contacts merged", "audit this ID", "where did this value come from".
---

# Trust check

Both tools here are free.

## From an identifier to an ID

If the user gives an email, LinkedIn URL or domain, call `agentic_id_resolve` first (1 credit at
most) and use the `id`. If the outcome is `review`, `conflict` or `unresolvable`, stop and report
that: there is no single record to check.

## What can be proved: agentic_id_facts

Read back and report, in this order:

1. `verified_id`. A person is a Verified ID with fresh proof they exist, a verified way to reach
   them, and an employer confirmed by two independent sources. A company is one when it is proven
   to exist with a verified live domain.
2. `missing`: what stops it being a Verified ID, in plain words.
3. Each fact: its `level`, the `reason`, how many `independent_sources`, and `recheck_at`.

| Question | Answer from |
| --- | --- |
| Safe to email? | `work_email` is `verified`: yes. `corroborated` or `claimed`: validate first. `contradicted`: no |
| Still works there? | `employer` level and its `recheck_at`. Past the re-check date means it needs checking again, not that it is wrong |
| Where did this come from? | `evidence[]`: kind, source and date. Sources that share a lineage count once |

Never round a level up. "Two sources say so" is `corroborated`, not verified. No facts recorded
is "no evidence yet", not "wrong".

## What happened to it: agentic_id_ledger

`entries[]` is the ID's history, oldest first: created, an identifier linked, merged, split.
`verified: true` means every link in the hash chain was re-checked.

- "Why are these two the same?" Find the `linked` or `merged` entry and report what evidence it
  names in `detail`.
- "Was this changed?" If `verified` is false, say the chain did not verify and stop: that is for
  the workspace owner and iCustomer, not something to explain away.

## What not to do

- Do not enrich to "improve" a level: enrichment adds claims, not proof.
- Do not report contact values the key cannot read; masked stays masked.
