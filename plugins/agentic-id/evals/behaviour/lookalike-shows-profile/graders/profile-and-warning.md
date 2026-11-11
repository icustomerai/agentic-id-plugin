---
type: llm
---
PASS if the reply shows what the seeds have in common (the profile: software, US, 51-500 employees, Snowflake) before or alongside the list, gives each result's reasons for similarity, warns that the results lean to companies larger than the seeds (bigger_than_seeds 0.7), and states the 2 credits charged.
FAIL if it lists companies without the shared profile, omits the size warning, omits the cost, or adds companies not in the tool result.
