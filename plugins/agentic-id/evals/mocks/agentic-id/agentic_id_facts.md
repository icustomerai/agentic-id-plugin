---
type: fixed
---
{
  "id": "ic-evalPerson0000000001",
  "summary": "Not a Verified ID yet: the work email is claimed by one source.",
  "kind": "person",
  "verified_id": false,
  "missing": [
    "no verified way to reach them"
  ],
  "facts": [
    {
      "fact": "employer",
      "level": "corroborated",
      "reason": "two independent sources agree",
      "independent_sources": 2,
      "recheck_at": "2027-02-01T00:00:00Z",
      "evidence": [
        {
          "kind": "profile_lists_employer",
          "lineage": "professional-profile",
          "source": "provider-a",
          "observed_at": "2026-11-01T00:00:00Z"
        },
        {
          "kind": "company_site_lists_person",
          "lineage": "company-site",
          "source": "web",
          "observed_at": "2026-10-15T00:00:00Z"
        }
      ]
    },
    {
      "fact": "work_email",
      "level": "claimed",
      "reason": "one source, no mailbox check yet",
      "independent_sources": 1,
      "recheck_at": "2026-12-01T00:00:00Z",
      "evidence": [
        {
          "kind": "provider_claim",
          "lineage": "provider-b",
          "source": "provider-b",
          "observed_at": "2026-10-20T00:00:00Z"
        }
      ]
    }
  ]
}
