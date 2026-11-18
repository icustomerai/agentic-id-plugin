---
type: fixed
---
1 of 1 record enriched. 2 credits charged.
{
  "request_id": "req_eval_enrich_01",
  "cost": {
    "quoted_credits": 2,
    "charged_credits": 2
  },
  "results": [
    {
      "id": "ic-evalPerson0000000001",
      "status": "enriched",
      "reason": "Title confirmed by two independent sources; the work email comes from one source and was not verified.",
      "fields": [
        {
          "field": "title",
          "value": "VP Marketing",
          "level": "corroborated",
          "source": "agentic-id",
          "observed_at": "2026-11-01T00:00:00Z"
        },
        {
          "field": "company_name",
          "value": "Acme Analytics",
          "level": "corroborated",
          "source": "agentic-id",
          "observed_at": "2026-11-01T00:00:00Z"
        },
        {
          "field": "work_email",
          "value": "j***@acme-analytics-synthetic.com",
          "level": "claimed",
          "source": "provider",
          "observed_at": "2026-10-20T00:00:00Z"
        }
      ]
    }
  ]
}
