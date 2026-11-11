# Connect Agentic ID to your agent

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
git clone https://github.com/<github-org>/onesource-plugin ~/onesource-plugin

SKILLS_DIR=~/.agents/skills   # Codex, Muse Code. Hermes: ~/.hermes/skills. Pi: ~/.pi/agent/skills
mkdir -p "$SKILLS_DIR"
for s in agentic-id who-matters agentic-id-credits; do
  ln -s ~/onesource-plugin/plugins/agentic-id/skills/$s "$SKILLS_DIR/$s"
done
```

Links rather than copies mean a `git pull` updates the skills everywhere. To load the skills for
one project only, link them into that project's `.agents/skills/` instead.

## Claude Code

```bash
claude plugin marketplace add <github-org>/onesource-plugin
claude plugin install agentic-id@icustomer
```

Restart Claude Code, run `/mcp`, pick `plugin:agentic-id:agentic-id` and choose **Authenticate**.
Claude Code stores the tokens, not the plugin. The usage hook and `/agentic-id-usage` need `node` 18
or later.

Try it without installing: `claude --plugin-dir /path/to/onesource-plugin/plugins/agentic-id`.

**Plugin options.** The plugin declares two `userConfig` options. Claude Code asks for them when you
enable the plugin; change them later with `/plugin configure agentic-id@icustomer`, or in
`/plugin` → **Installed** → Agentic ID → **Configure options**.

- The MCP endpoint is not an option: it is fixed in the plugin's `.mcp.json`
  (`https://mcp-onesource-development.icustomer.ai/mcp`). To test against a local server, pass your own
  server entry with `--mcp-config`.
- `api_key` (sensitive): empty by default, which means OAuth sign-in. Paste an `os_live_` key for
  API-key mode. Claude Code stores it in the system keychain and sends it as `x-api-key`.

The plugin reads no credential from your environment or your files. The CLI's
`~/.agentic-id/api-key` is not used by the plugin.

**API-key mode (CI, headless).** A machine without a keychain prompt can set the options in a
settings file, kept at mode 0600 and out of the repository:

```json
{ "pluginConfigs": { "agentic-id@icustomer": {
  "options": { "api_key": "<your key>" } } } }
```

```bash
claude -p "..." --settings /secure/agentic-id-settings.json \
  --allowedTools mcp__plugin_agentic-id_agentic-id__agentic_id_validate
```

The id is `agentic-id@icustomer` for the installed plugin and `agentic-id@inline` for one
loaded with `--plugin-dir`. `test/e2e.sh` with `E2E_MODE=plugin` writes this file from the
environment and deletes it on exit.

For headless runs you can skip the plugin's server entry and load your own, as `test/e2e.sh` does:

```json
{ "mcpServers": { "agentic-id": { "type": "http", "url": "https://<host>/mcp",
  "headers": { "x-api-key": "${AGENTIC_ID_API_KEY}" } } } }
```

This is your own MCP config, not part of the plugin, so reading the key from your environment is
your choice here.

```bash
claude -p "..." --mcp-config agentic-id.mcp.json --strict-mcp-config \
  --allowedTools mcp__agentic-id__agentic_id_validate
```

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
