---
type: fixed
---
2 accounts delivered of about 1,637 that match. 2 credits charged.
{
  "request_id": "req_eval_discover_01",
  "cost": {
    "quoted_credits": 10,
    "charged_credits": 2
  },
  "total_matching": 1637,
  "accounts": [
    {
      "id": "ic-evalCompany000000002",
      "name": "Globex Data",
      "domain": "globex-synthetic.com",
      "country": "GB",
      "employees": {
        "min": 201,
        "max": 500
      },
      "size_check": "confirmed",
      "charged": true
    },
    {
      "id": "ic-evalCompany000000003",
      "name": "Initech Cloud",
      "domain": "initech-synthetic.com",
      "country": "GB",
      "employees": {
        "min": 501,
        "max": 1000
      },
      "size_check": "confirmed",
      "charged": true
    }
  ],
  "contacts": [],
  "excluded": {
    "size_outside_range": 41,
    "industry_mismatch": 9
  },
  "rejected": [],
  "plan": [
    {
      "why": "applies countries, industries; we check size"
    }
  ]
}
