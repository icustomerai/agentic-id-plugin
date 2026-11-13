---
type: fixed
---
{
  "request_id": "req_eval_validate_01",
  "summary": "3 emails checked: 1 valid, 1 catch-all, 1 invalid. 3 credits charged.",
  "cost": {
    "quoted_credits": 3,
    "charged_credits": 3
  },
  "results": [
    {
      "email": "jordan.lee@acme-analytics-synthetic.com",
      "verdict": "valid",
      "role": false,
      "checked_at": "2026-11-11T00:00:00Z"
    },
    {
      "email": "priya.shah@globex-synthetic.com",
      "verdict": "catch-all",
      "reason": "domain_accepts_all",
      "role": false,
      "checked_at": "2026-11-11T00:00:00Z"
    },
    {
      "email": "no.one@initech-synthetic.com",
      "verdict": "invalid",
      "reason": "mailbox_rejects",
      "role": false,
      "checked_at": "2026-11-11T00:00:00Z"
    }
  ]
}
