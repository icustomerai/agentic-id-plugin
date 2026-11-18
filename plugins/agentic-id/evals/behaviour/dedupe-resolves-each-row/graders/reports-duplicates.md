---
type: llm
---
PASS if the reply says rows 1 and 2 are the same person (same Agentic ID), that the list holds 3 distinct people, and states the 3 credits charged (the second lookup of the same ID was free).
FAIL if it guesses duplicates from the names or emails without the tool results, misses the duplicate, or omits the cost.
