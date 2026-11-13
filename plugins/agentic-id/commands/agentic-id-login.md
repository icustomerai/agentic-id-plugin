---
description: Sign in to Agentic ID with your iCustomer account, in the browser (no API key needed)
---

Call the `agentic_id_login` tool (no arguments). It opens the sign-in page in the browser and
returns a link: show the link to the user in case the browser did not open, and tell them to come
back when the page says they are signed in.

When they say they have signed in, call `agentic_id_login` again and report in two lines at most:
whether they are signed in and as which workspace.

Never ask the user for a password, a code or an API key in the chat: sign-in happens only in the
browser.
