---
description: Check the Agentic ID connection - which server, which workspace, what this key can read
---

Call the `agentic_id_status` tool (no arguments) and report what it says in three lines at most:
whether it is connected, to which server and workspace, and whether contact values come back
readable or masked.

If `ok` is false, give the `fix` line as the next step: usually `/agentic-id-login` to sign in.
Never ask the user to paste an API key into the chat: a key goes in the plugin options
(`/plugin`, agentic-id, Configure).
