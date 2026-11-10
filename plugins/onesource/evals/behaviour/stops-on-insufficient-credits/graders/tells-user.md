---
type: llm
---
PASS if the reply says the call could not run because the workspace does not have enough credits, says nothing was charged or enriched, and asks the user to top up or decide next steps.
FAIL if the reply retries with a different cap, claims fields were filled, or hides the error.
