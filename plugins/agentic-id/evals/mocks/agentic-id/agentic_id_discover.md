---
type: fixed
---
{
  "mode": "accounts",
  "job_id": "job_eval_01",
  "requested_count": 4,
  "returned_count": 2,
  "account_count": 2,
  "accounts": [
    { "company_name": "Globex Data", "domain": "globex-synthetic.com", "industry": "Software Development", "size_band": "51-200", "country": "United States",
      "contact_count": 1, "contacts": [ { "name": "Alex Kim", "title": "VP Sales", "seniority": "vp", "work_email": "alex.kim@globex-synthetic.com", "email_verified": false } ] },
    { "company_name": "Initech Cloud", "domain": "initech-synthetic.com", "industry": "Software Development", "size_band": "51-200", "country": "United States",
      "contact_count": 1, "contacts": [ { "name": "Rita Gomez", "title": "Head of Sales", "seniority": "head", "work_email": "rita.gomez@initech-synthetic.com", "email_verified": false } ] }
  ],
  "filters_applied": { "account_icp": { "industries": ["Software Development"], "size_bands": ["51-200"] }, "people_icp": { "seniority": ["vp", "head"], "job_functions": ["Sales"] } },
  "dropped": { "size_band": 41, "industry": 9 },
  "credits_charged": 4,
  "cost": { "quoted_credits": 4, "charged_credits": 4 },
  "ledger": { "held": 6, "charged": 4, "available_after": 40 },
  "request_id": "req_eval_discover_01",
  "summary": "Discovered 2 contact(s) at 2 account(s); 4 credit(s) charged."
}
