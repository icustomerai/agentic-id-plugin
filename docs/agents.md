# Connect Agentic ID to your agent

> **Branch `v3/plugin-on-v3`.** This page still describes the hosted v2 endpoint. On V3 the tools
> come from the plugin's own stdio server. Any MCP client can start it:
> `{ "command": "node", "args": ["<repo>/plugins/agentic-id/server/mcp.mjs"], "env": { "AGENTIC_ID_API_KEY_FILE": "<file that holds the key>", "AGENTIC_ID_URL": "<V3 API URL>" } }`.
> Agents without MCP can use `plugins/agentic-id/scripts/agentic-id`. See [v3.md](v3.md).

Agentic ID has two parts that work in any agent:
- **the MCP server** (the five tools)
- **the Agent Skills** (they teach the agent when to use each tool and how credits work)

This page shows how to set up both in each agent we know about.

| Agent | Tools (MCP) | Skills | Status |
| --- | --- | --- | --- |
| [Claude Code](#claude-code) | Plugin, OAuth sign-in | Plugin | Tested end to end |
| [Codex](#codex) | `config.toml`, OAuth sign-in | `~/.agents/skills` | Documented, not yet tested |
| [Hermes Agent](#hermes-agent) | `config.yaml`, API key | `~/.hermes/skills` | Documented, not yet tested |
| [Pi](#pi) | `pi-mcp-adapter` extension | `~/.pi/agent/skills` | Documented, not yet tested |
| [Muse Code](#muse-code) | Not possible yet (no MCP in the beta) | `~/.agents/skills` | Skills only; use the CLI for the tools |
| [Any other agent](#any-other-agent) | Connection details below | If it reads `SKILL.md` | Should work |

"Documented, not yet tested" means the setup follows that agent's own docs but nobody has run it
against an Agentic ID server yet. If you try one, please open an issue with what happened.

## Connection details

| Setting | Value |
| --- | --- |
| Transport | Streamable HTTP |
| URL | `https://mcp-onesource-development.icustomer.ai/mcp` (development) |
| Sign-in for people | OAuth with your iCustomer account. The agent opens a browser the first time. |
| Sign-in for scripts and CI | An API key in the `x-api-key` header |

Never put an API key in a URL, a chat message or a committed file.

## Install the skills

Every agent except Claude Code loads skills from a folder. Clone this repo once and link the
skill folders into the folder your agent reads:

```bash
git clone https://github.com/icustomerai/agentic-id-plugin ~/agentic-id-plugin

SKILLS_DIR=~/.agents/skills   # Codex, Muse Code. Hermes: ~/.hermes/skills. Pi: ~/.pi/agent/skills
mkdir -p "$SKILLS_DIR"
for s in agentic-id who-matters agentic-id-credits; do
  ln -s ~/agentic-id-plugin/plugins/agentic-id/skills/$s "$SKILLS_DIR/$s"
done
```

Links rather than copies mean a `git pull` updates the skills everywhere. To load the skills for
one project only, link them into that project's `.agents/skills/` instead.

## Claude Code

```bash
claude plugin marketplace add icustomerai/agentic-id-plugin
claude plugin install agentic-id@agentic-id
```

Restart Claude Code and ask "How many Agentic ID credits do I have?". Claude opens the iCustomer
sign-in page (or type `/agentic-id:agentic-id-login`). The plugin runs its own small local MCP server
(`server/mcp.mjs`, Node 18 or later, no packages) that calls the Agentic ID API; it is not the
hosted MCP endpoint above.

Try it without installing: `claude --plugin-dir /path/to/agentic-id-plugin/plugins/agentic-id`.

**Plugin options.** Claude Code asks for them when you enable the plugin; change them later with
`/plugin configure agentic-id@agentic-id`, or in `/plugin` → **Installed** → Agentic ID →
**Configure options**.

- `api_url`: where the Agentic ID API runs. Leave the default (`https://onesource-v3.icustomer.ai`).
  For a local V3 stack, set `http://127.0.0.1:3100`. If the address is wrong, the tools say that
  nothing answered there (or that it is not an Agentic ID server), not that you are signed out.
- `api_key` (sensitive): empty by default, which means sign-in with your iCustomer account. For
  CI, paste an Agentic ID API key. Claude Code stores it in the system keychain and passes it only
  to the local server, which sends it to the API as a Bearer token.

**API-key mode (CI, headless).** A machine without a keychain prompt can set the options in a
settings file, kept at mode 0600 and out of the repository:

```json
{ "pluginConfigs": { "agentic-id@agentic-id": {
  "options": { "api_key": "<your key>" } } } }
```

```bash
claude -p "..." --settings /secure/agentic-id-settings.json \
  --allowedTools mcp__plugin_agentic-id_agentic-id__agentic_id_validate
```

The id is `agentic-id@agentic-id` for the installed plugin and `agentic-id@inline` for one
loaded with `--plugin-dir`.

## Codex

Add the server to `~/.codex/config.toml`, or to `.codex/config.toml` in a trusted project:

```toml
[mcp_servers.agentic-id]
url = "https://mcp-onesource-development.icustomer.ai/mcp"
```

Sign in once with `codex mcp login agentic-id`. For CI, use an API key instead of OAuth:

```toml
[mcp_servers.agentic-id]
url = "https://mcp-onesource-development.icustomer.ai/mcp"
env_http_headers = { "x-api-key" = "AGENTIC_ID_API_KEY" }
```

Then [install the skills](#install-the-skills) into `~/.agents/skills`.

## Hermes Agent

Add the server to `~/.hermes/config.yaml`:

```yaml
mcp_servers:
  agentic-id:
    url: "https://mcp-onesource-development.icustomer.ai/mcp"
    headers:
      x-api-key: "${AGENTIC_ID_API_KEY}"
```

Run `/reload-mcp` in an open chat to pick it up. Then [install the skills](#install-the-skills)
into `~/.hermes/skills`.

## Pi

Pi has no built-in MCP support. Add it with the `pi-mcp-adapter` extension, then add the server
to `~/.pi/agent/mcp.json`, or to `.pi/mcp.json` for one project:

```json
{ "mcpServers": { "agentic-id": {
  "url": "https://mcp-onesource-development.icustomer.ai/mcp",
  "auth": "oauth" } } }
```

Sign in with `/mcp auth agentic-id`. Then [install the skills](#install-the-skills) into
`~/.pi/agent/skills`. The adapter's config keys vary between its forks, so check the README of the
version you install.

## Muse Code

The Muse Code beta does not support MCP servers. It does read skills from `~/.agents/skills`, and
the `agentic-id` skill tells the agent to use the `agentic-id` CLI when the MCP tools are missing.
So install the skills and the [CLI](../README.md#cli-preview), run `agentic-id login` once in your
terminal, and Muse Code can call Agentic ID through the shell.

## Any other agent

Point any MCP client at the [connection details](#connection-details). If the agent reads
`SKILL.md` skills, link the skill folders as shown in [Install the skills](#install-the-skills).
If it reads neither, the `agentic-id` skill file is plain Markdown and works as a system prompt or
project instructions file.
