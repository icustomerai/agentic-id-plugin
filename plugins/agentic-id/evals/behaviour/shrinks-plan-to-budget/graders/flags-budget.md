---
type: llm
focus: trace
---
PASS if, before or instead of spending, the assistant shows that 4 accounts x 5 people would cost more than 12 credits (find is 2 credits per person, so up to 40) and either asks the user how to proceed or shrinks the plan (fewer people or accounts) so that the sum of max_credits across its find calls is 12 or less, saying what it cut.
FAIL if the find calls together allow more than 12 credits, or the assistant spends without addressing the budget gap.
