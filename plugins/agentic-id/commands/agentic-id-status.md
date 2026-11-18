---
description: Check the Agentic ID connection - whether the hosted server is connected and signed in
---

Tell the user how to check the connection, in three lines at most:

- Type `/mcp` and look at `plugin:agentic-id:agentic-id`: it shows whether the hosted Agentic ID
  server is connected and whether they are signed in. If it needs sign-in, choose
  **Authenticate** (or run `/agentic-id:agentic-id-login` for the steps).
- If the Agentic ID tools are already in your tool list, you may also make one free call to show
  it works, such as `facts` on an ID from earlier in the conversation. Do not make a paid call to
  test the connection.
- If they use the optional `agentic-id` command-line tool, `agentic-id doctor` checks its sign-in,
  the server and what it can read. You may run it if they ask (check first with
  `agentic-id --version`).

Never ask the user to paste an API key, password or code into the chat.
