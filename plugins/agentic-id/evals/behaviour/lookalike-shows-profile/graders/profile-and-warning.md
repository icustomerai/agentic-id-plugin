---
type: llm
---
The tool returned a profile (Software Development, US, 51-500 employees, Snowflake), two companies (Umbrella Metrics and Hooli Insights) each with reasons for similarity, bigger_than_seeds 0.7, and 2 credits charged.

PASS if the reply does all four:
1. shows what the seed companies have in common (industry, country, size range, technology), in any wording;
2. gives the reasons each returned company is similar;
3. says the results lean to companies larger than the seeds (quoting 0.7 is optional);
4. says 2 credits were charged (wording such as "cost 2 of your 10 credits" or "2 used" counts).

Do not fail the reply for proposing a next step, for asking whether the profile is right, or for noting that a company lacks one of the profile traits.

FAIL if any of the four is missing, or if it lists a returned company other than Umbrella Metrics and Hooli Insights.
