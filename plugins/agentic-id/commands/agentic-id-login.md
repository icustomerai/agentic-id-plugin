---
description: Sign in to Agentic ID with your iCustomer account, in the browser (no API key needed)
---

Explain to the user how to sign in, in a few short lines. You cannot start the sign-in yourself.

1. Type `/mcp`.
2. Select `plugin:agentic-id:agentic-id`.
3. Choose **Authenticate**. The browser opens the iCustomer sign-in page; when it says they are
   signed in, come back to Claude Code.

Once signed in, the Agentic ID tools work in this session. To sign out, the same `/mcp` screen has
the option to clear the authentication.

If they also use the optional `agentic-id` command-line tool, it has its own sign-in: they run
`agentic-id login` in a terminal (and `agentic-id logout` to end it).

Never ask the user for a password, a code or an API key in the chat: sign-in happens only in the
browser.
