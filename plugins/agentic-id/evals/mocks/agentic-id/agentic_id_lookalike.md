---
type: fixed
---
{
  "request_id": "req_eval_lookalike_01",
  "summary": "2 companies like your 3 seeds. 2 credits charged.",
  "cost": {
    "quoted_credits": 10,
    "charged_credits": 2
  },
  "profile": {
    "countries": [
      "US"
    ],
    "industries": [
      "Software Development"
    ],
    "employees": {
      "min": 51,
      "max": 500
    },
    "technologies": [
      "Snowflake"
    ],
    "seeds_used": 3
  },
  "seeds_rejected": [],
  "bigger_than_seeds": 0.7,
  "accounts": [
    {
      "id": "ic-evalCompany000000004",
      "name": "Umbrella Metrics",
      "domain": "umbrella-synthetic.com",
      "country": "US",
      "employees": {
        "min": 1001,
        "max": 5000
      },
      "size_check": "confirmed",
      "charged": true,
      "similarity": 0.81,
      "why": [
        "same industry",
        "same country",
        "uses Snowflake"
      ]
    },
    {
      "id": "ic-evalCompany000000005",
      "name": "Hooli Insights",
      "domain": "hooli-synthetic.com",
      "country": "US",
      "employees": {
        "min": 5001,
        "max": 10000
      },
      "size_check": "confirmed",
      "charged": true,
      "similarity": 0.74,
      "why": [
        "same industry",
        "same country"
      ]
    }
  ],
  "excluded": {},
  "plan": [
    {
      "provider": "provider-a",
      "why": "applies countries, industries; we check size"
    }
  ]
}
