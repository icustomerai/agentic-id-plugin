---
type: fixed
---
{
  "summary": "4 rows: 4 known. 1 ID shared by more than one row. 3 credits charged.",
  "cost": {
    "quoted_credits": 3,
    "charged_credits": 3
  },
  "counts": {
    "known": 4
  },
  "rows": [
    {
      "row": 1,
      "id": "os_evalPerson0000000001",
      "outcome": "known",
      "matched_on": "email",
      "confidence": 0.99
    },
    {
      "row": 2,
      "id": "os_evalPerson0000000001",
      "outcome": "known",
      "matched_on": "linkedin",
      "confidence": 0.99
    },
    {
      "row": 3,
      "id": "os_evalPerson0000000002",
      "outcome": "known",
      "matched_on": "email",
      "confidence": 0.99
    },
    {
      "row": 4,
      "id": "os_evalPerson0000000003",
      "outcome": "known",
      "matched_on": "email",
      "confidence": 0.99
    }
  ],
  "same_id": [
    {
      "id": "os_evalPerson0000000001",
      "rows": [
        1,
        2
      ]
    }
  ]
}
