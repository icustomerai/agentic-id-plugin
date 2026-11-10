---
type: fixed
---
{
  "id": "did:icustomer:global:person:7a1e0c9f3b",
  "enriched": { "title": "VP Marketing", "company": "Acme Analytics", "company_domain": "acme-analytics-synthetic.com" },
  "provenance": [
    { "field": "title", "provider": "onesource", "retrieved_at": "2026-11-01T00:00:00Z" },
    { "field": "company", "provider": "onesource", "retrieved_at": "2026-11-01T00:00:00Z" }
  ],
  "coverage_pct": 75,
  "missing_fields": ["location"],
  "cost": { "quoted_credits": 3, "charged_credits": 2 },
  "ledger": { "held": 3, "charged": 2, "available_after": 46 },
  "request_id": "req_eval_enrich_01",
  "summary": "Filled title, company and company_domain; location not found. Charged 2 credits."
}
