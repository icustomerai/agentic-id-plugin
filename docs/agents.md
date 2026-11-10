# Connect OneSource to your agent

OneSource has two parts that work in any agent:
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
against a OneSource server yet. If you try one, please open an issue with what happened.

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
for s in onesource who-matters onesource-credits; do
  ln -s ~/onesource-plugin/plugins/onesource/skills/$s "$SKILLS_DIR/$s"
done
```

Links rather than copies mean a `git pull` updates the skills everywhere. To load the skills for
one project only, link them into that project's `.agents/skills/` instead.

## Claude Code

```bash
claude plugin marketplace add <github-org>/onesource-plugin
claude plugin install onesource@icustomer-onesource
```

Restart Claude Code, run `/mcp`, pick `plugin:onesource:onesource` and choose **Authenticate**.
Claude Code stores the tokens, not the plugin. The hook and helper scripts need `node` 18 or later.

Try it without installing: `claude --plugin-dir /path/to/onesource-plugin/plugins/onesource`.

**Another server:** `export ONESOURCE_MCP_URL=http://localhost:3000/mcp`.

**API-key mode (CI, headless).** The plugin's `.mcp.json` sends no static headers. Its
`headersHelper` (`plugins/onesource/scripts/api-key-headers.mjs`) adds `x-api-key` only when a key
is configured; otherwise OAuth applies. Claude Code removes credential-named environment
variables (`*_API_KEY`, `*_TOKEN`, ...) from a plugin's `headersHelper`, so the key is read from a
file:

```bash
mkdir -p ~/.onesource && chmod 700 ~/.onesource
printf '%s\n' "<your key>" > ~/.onesource/api-key && chmod 600 ~/.onesource/api-key
# or keep it elsewhere: export ONESOURCE_CONFIG_DIR=/secure/dir  (reads /secure/dir/api-key)
```

Create the folder as yourself, not with `sudo`. A folder owned by root stops the usage hook from
writing its log. Remove the file to go back to OAuth.

For headless runs you can skip the plugin's server entry and load your own, as `test/e2e.sh` does:

```json
{ "mcpServers": { "onesource": { "type": "http", "url": "https://<host>/mcp",
  "headers": { "x-api-key": "${ONESOURCE_API_KEY}" } } } }
```

```bash
claude -p "..." --mcp-config onesource.mcp.json --strict-mcp-config \
  --allowedTools mcp__onesource__onesource_validate
```

## Codex

Add the server to `~/.codex/config.toml`, or to `.codex/config.toml` in a trusted project:

```toml
[mcp_servers.onesource]
url = "https://mcp-onesource-development.icustomer.ai/mcp"
```

Sign in once with `codex mcp login onesource`. For CI, use an API key instead of OAuth:

```toml
[mcp_servers.onesource]
url = "https://mcp-onesource-development.icustomer.ai/mcp"
env_http_headers = { "x-api-key" = "ONESOURCE_API_KEY" }
```

Then [install the skills](#install-the-skills) into `~/.agents/skills`.

## Hermes Agent

Add the server to `~/.hermes/config.yaml`:

```yaml
mcp_servers:
  onesource:
    url: "https://mcp-onesource-development.icustomer.ai/mcp"
    headers:
      x-api-key: "${ONESOURCE_API_KEY}"
```

Run `/reload-mcp` in an open chat to pick it up. Then [install the skills](#install-the-skills)
into `~/.hermes/skills`.

## Pi

Pi has no built-in MCP support. Add it with the `pi-mcp-adapter` extension, then add the server
to `~/.pi/agent/mcp.json`, or to `.pi/mcp.json` for one project:

```json
{ "mcpServers": { "onesource": {
  "url": "https://mcp-onesource-development.icustomer.ai/mcp",
  "auth": "oauth" } } }
```

Sign in with `/mcp auth onesource`. Then [install the skills](#install-the-skills) into
`~/.pi/agent/skills`. The adapter's config keys vary between its forks, so check the README of the
version you install.

## Muse Code

The Muse Code beta does not support MCP servers. It does read skills from `~/.agents/skills`, and
the `onesource` skill tells the agent to use the `onesource` CLI when the MCP tools are missing.
So install the skills and the [CLI](../README.md#cli-preview), run `onesource login` once in your
terminal, and Muse Code can call OneSource through the shell.

## Any other agent

Point any MCP client at the [connection details](#connection-details). If the agent reads
`SKILL.md` skills, link the skill folders as shown in [Install the skills](#install-the-skills).
If it reads neither, the `onesource` skill file is plain Markdown and works as a system prompt or
project instructions file.
