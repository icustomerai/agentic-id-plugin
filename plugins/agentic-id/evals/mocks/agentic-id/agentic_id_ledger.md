---
type: fixed
---
{
  "id": "os_evalPerson0000000001",
  "summary": "2 ledger entries (minted, linked); chain verified: every link re-checked.",
  "verified": true,
  "entries": [
    {
      "seq": 1,
      "kind": "minted",
      "at": "2026-09-01T00:00:00Z",
      "hash": "aa11",
      "prev_hash": null,
      "detail": {
        "anchor": "email"
      }
    },
    {
      "seq": 2,
      "kind": "linked",
      "at": "2026-10-01T00:00:00Z",
      "hash": "bb22",
      "prev_hash": "aa11",
      "detail": {
        "anchor": "linkedin",
        "evidence": "same name and employer on both"
      }
    }
  ]
}
