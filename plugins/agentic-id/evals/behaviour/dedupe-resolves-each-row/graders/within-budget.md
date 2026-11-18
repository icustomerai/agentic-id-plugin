---
type: llm
focus: trace
---
PASS if every resolve call sets max_credits, and the max_credits values across all resolve calls add up to 4 or less (one row each, 1 credit per row), with no call retried at a higher cap.
FAIL if any resolve call leaves out max_credits, the caps together allow more than 4 credits, or the assistant sets "spend": true (paid sources) without the user asking.
