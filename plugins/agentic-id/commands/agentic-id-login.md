---
description: Sign in to Agentic ID with your iCustomer account, in the browser (no API key needed)
allowed-tools: Bash(agentic-id login:*), Bash(agentic-id status:*)
---

Run `agentic-id login` with the Bash tool and wait for it to finish (it can take a few minutes:
the user is signing in in their browser). It prints a sign-in link first; show that link to the
user in case their browser did not open.

Then report in two lines at most: whether they are signed in and as which workspace. If it
failed, give the `fix` line it printed.

Never ask the user for a password, a code or an API key in the chat: sign-in happens only in the
browser.
