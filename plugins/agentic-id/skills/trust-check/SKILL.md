---
name: trust-check
description: Check how far a person or company record can be trusted before acting on it - read each fact's level (verified, corroborated, claimed, contradicted) and evidence from Agentic ID, say whether the ID is a Verified ID and what is missing, and explain an ID's history from the ledger. Use for "is this email safe to send to", "is this title still current", "can I trust this record", "is this a verified ID", "why were these two contacts merged", "audit this ID", "where did this value come from".
---

# Trust check

Both tools here (`facts` and `ledger`) are free.

## From an identifier to an ID

If the user gives an email, LinkedIn URL or domain, call `resolve` first with `identifiers` and
`max_credits: 1` (1 credit at most) and use the `id`. If the outcome is `review`, `conflict` or
`unresolvable`, stop and report that: there is no single record to check.

## What can be proved: facts

Read back and report, in this order:

1. Whether it is a Verified ID. A person is one with fresh proof they exist, a verified way to
   reach them, and an employer confirmed by two independent sources. A company is one when it is
   proven to exist with a verified live domain.
2. What is missing for that, in plain words.
3. Each fact: its `level`, the reason, how many independent sources, and when it is due a
   re-check.

| Question | Answer from |
| --- | --- |
| Safe to email? | `work_email` is `verified`: yes. `corroborated` or `claimed`: validate first. `contradicted`: no |
| Still works there? | `employer` level and its re-check date. Past the re-check date means it needs checking again, not that it is wrong |
| Where did this come from? | The evidence: kind and date. Sources that share a lineage count once. Never name the data source or vendor |

Never round a level up. "Two sources say so" is `corroborated`, not verified. No facts recorded
is "no evidence yet", not "wrong".

## What happened to it: ledger

The entries are the ID's history, oldest first: created, an identifier linked, merged. Each is
hash-linked to the one before, and the answer says whether the whole chain re-checked.

- "Why are these two the same?" Find the linked or merged entry and report what evidence it
  names.
- "Was this changed?" If the chain did not verify, say so and stop: that is for the workspace
  owner and iCustomer, not something to explain away.

## When the user says a value was wrong

If the user says the email bounced, the person left, or the title is wrong, offer to record it
with `feedback` (free): `id`, `field` (`work_email`, `title`, `company_domain`) and `outcome`
(`bounced`, `wrong_person`, `left_company`, ...). It changes only this workspace's view.

## What not to do

- Do not enrich to "improve" a level: enrichment adds claims, not proof.
- Do not report contact values that came back masked; masked stays masked.
