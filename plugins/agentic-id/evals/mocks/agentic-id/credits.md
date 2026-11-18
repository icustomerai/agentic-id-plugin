---
type: fixed
---
100 credits available. Spent 3 credits today and 41 credits in the last 30 days.
{
  "workspace_id": "ws_eval",
  "credits": { "balance": 100, "held": 0, "available": 100 },
  "spent": {
    "today": 3,
    "last_30_days": 41,
    "by_tool": [
      { "tool": "resolve", "credits": 21, "calls": 21 },
      { "tool": "enrich", "credits": 20, "calls": 10 }
    ]
  },
  "recent": [
    { "at": "2026-11-18T10:00:00Z", "kind": "charge", "credits": 1, "tool": "resolve" },
    { "at": "2026-11-01T00:00:00Z", "kind": "grant", "credits": 100, "note": "starter credits" }
  ],
  "recent_ids": [
    { "at": "2026-11-18T10:00:00Z", "id": "ic-evalCompany000000001", "kind": "company", "company": "acme-synthetic.com", "tool": "resolve", "credits": 1 }
  ]
}
