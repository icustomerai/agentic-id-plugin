---
type: fixed
---
{
  "id": null,
  "email": null,
  "domain": null,
  "email_validation": null,
  "results": [
    { "email": "jordan.lee@acme-analytics-synthetic.com", "status": "valid", "credits_charged": 1 },
    { "email": "priya.shah@globex-synthetic.com", "status": "catch-all", "credits_charged": 1 },
    { "email": "no.one@initech-synthetic.com", "status": "invalid", "credits_charged": 0 }
  ],
  "total": 3,
  "rejected": 0,
  "cost": { "quoted_credits": 3, "charged_credits": 2 },
  "ledger": { "held": 3, "charged": 2, "available_after": 48 },
  "request_id": "req_eval_validate_01",
  "summary": "3 checked: 1 valid, 1 catch-all, 1 invalid. Charged 2 credits."
}
