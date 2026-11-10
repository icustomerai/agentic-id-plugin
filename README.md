# OneSource for coding agents

iCustomer's B2B identity and enrichment service, packaged for the coding agent you already use.
Validate work emails, resolve people to OneSource identities, enrich missing fields, find the
buying group inside a company, and discover net-new accounts and contacts from ICP filters, with
every credit accounted for.

The package has two portable parts, and both are open standards:

- **One MCP server** (Streamable HTTP) with five tools. Any agent that can talk to a remote MCP
  server can use it.
- **Three Agent Skills** in the open `SKILL.md` format. They teach the agent which tool to use
  when, what the verdicts mean, and the credit rules. Any agent that reads skills can load them.

Claude Code also gets a ready-made plugin that bundles both, plus a subagent, a usage-log hook
and a slash command.

## Supported agents

| Agent | Tools (MCP) | Skills | Extras | Status |
| --- | --- | --- | --- | --- |
| [Claude Code](#claude-code) | Plugin, OAuth sign-in | Plugin | Subagent, usage hook, `/onesource-usage` | Tested end to end |
| [Codex](#codex) | `config.toml`, OAuth sign-in | `~/.agents/skills` | none | Documented, not yet tested |
| [Hermes Agent](#hermes-agent) | `config.yaml`, API key | `~/.hermes/skills` | none | Documented, not yet tested |
| [Pi](#pi) | Through the `pi-mcp-adapter` extension | `~/.pi/agent/skills` | none | Documented, not yet tested |
| [Muse Code](#muse-code) | Not possible yet (no MCP in the beta) | `~/.agents/skills` | none | Skills only, tools unavailable |
| [Any other MCP client](#any-other-agent) | Connection details below | If it reads `SKILL.md` | none | Should work |

"Documented, not yet tested" means the setup follows that agent's own docs but nobody has run it
against a OneSource server yet. If you try one, please report what happened.

## What's in the package

| Component | Where | Works in |
| --- | --- | --- |
| MCP server `onesource`: the five tools | `https://mcp-onesource-development.icustomer.ai/mcp` | Any MCP client |
| Skill `onesource`: tool choice, verdicts, credit rules, B2B-only rule, error codes | `plugins/onesource/skills/onesource/` | Any agent that reads skills |
| Skill `who-matters`: validate, resolve, enrich, find, discover, budget agreed up front | `plugins/onesource/skills/who-matters/` | Any agent that reads skills |
| Skill `onesource-credits`: prices, estimating and capping spend, quoted vs charged | `plugins/onesource/skills/onesource-credits/` | Any agent that reads skills |
| Subagent `lead-qualification`: works a lead list inside a credit budget | `plugins/onesource/agents/` | Claude Code |
| PostToolUse hook: one PII-free line per call in `~/.onesource/usage.jsonl` | `plugins/onesource/hooks/` | Claude Code |
| Command `/onesource-usage`: credits per tool and the last 20 calls | `plugins/onesource/commands/` | Claude Code |

Every agent still sees what each call cost: credits come back in every tool result, and the skills
tell the agent to report them. Only the local usage log and its summary command need Claude Code.

## Connection details

These are all an agent needs to reach the tools.

| Setting | Value |
| --- | --- |
| Transport | Streamable HTTP |
| URL | `https://mcp-onesource-development.icustomer.ai/mcp` (development deployment) |
| Sign-in for people | OAuth with your iCustomer account. The agent opens a browser the first time. |
| Sign-in for scripts and CI | An API key in the `x-api-key` header |

Never commit an API key. Keep it in an environment variable or a file only you can read.

## Install the skills

Every agent except Claude Code loads the skills from a folder. Clone this repo once and link the
three skill folders into the folder your agent reads:

```bash
git clone <github-org>/onesource-plugin ~/onesource-plugin

SKILLS_DIR=~/.agents/skills   # Codex and Muse Code. Hermes: ~/.hermes/skills. Pi: ~/.pi/agent/skills
mkdir -p "$SKILLS_DIR"
for s in onesource who-matters onesource-credits; do
  ln -s ~/onesource-plugin/plugins/onesource/skills/$s "$SKILLS_DIR/$s"
done
```

Links rather than copies mean a `git pull` updates the skills everywhere. To load the skills for
one project only, link them into that project's `.agents/skills/` instead.

## Claude Code

```bash
claude plugin marketplace add <github-org>/onesource-plugin   # or a local checkout path
claude plugin install onesource@icustomer-onesource
```

Restart Claude Code. Then run `/mcp`, pick `plugin:onesource:onesource` and choose
**Authenticate**. A browser window opens for your iCustomer sign-in. Claude Code stores the
tokens, not this plugin.

To try it without installing: `claude --plugin-dir /path/to/onesource-plugin/plugins/onesource`.
The hook and helper scripts need `node` 18 or later on your `PATH`.

**Another server.** Set `ONESOURCE_MCP_URL`, for example
`export ONESOURCE_MCP_URL=http://localhost:3000/mcp`.

**API-key mode.** The plugin's `.mcp.json` sends no static headers. A `headersHelper`
(`plugins/onesource/scripts/api-key-headers.mjs`) adds `x-api-key` only when a key is configured,
and otherwise sends nothing so OAuth applies. Claude Code removes credential-named environment
variables (`*_API_KEY`, `*_TOKEN`, ...) from a plugin's `headersHelper` environment, so the key is
read from a file:

```bash
mkdir -p ~/.onesource && chmod 700 ~/.onesource
printf '%s\n' "<your key>" > ~/.onesource/api-key && chmod 600 ~/.onesource/api-key
# or keep it elsewhere: export ONESOURCE_CONFIG_DIR=/secure/dir  (reads /secure/dir/api-key)
```

Remove the file to go back to OAuth. Outside plugin scope (running the helper by hand, or from a
user-scoped MCP config) the helper also reads `ONESOURCE_API_KEY`.

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

The Muse Code beta does not support MCP servers, so it cannot call the OneSource tools yet. It does
read skills from `~/.agents/skills`, but the skills only describe the tools, so on their own they
cannot validate, enrich or discover anything. We will add Muse Code once it can connect to MCP
servers.

## Any other agent

Point any MCP client at the [connection details](#connection-details). If the agent reads
`SKILL.md` skills, link the three skill folders into its skills folder as shown under
[Install the skills](#install-the-skills). If it reads neither, the `onesource` skill file is plain
Markdown and works as a system prompt or project instructions file.

## The five tools

Each agent shows these tools with its own prefix. Claude Code, for example, names them
`mcp__plugin_onesource_onesource__onesource_<verb>`. The skills refer to them by their short names.

| Tool | Use it to | Credits (development prices) |
| --- | --- | --- |
| `onesource_validate` | Check whether a work email is deliverable (one, or up to 1000 per call); or verify a company domain alone. Verdicts: valid, invalid, catch-all, risky, unknown. | 1 per address with a valid / catch-all / risky verdict; invalid, unknown, rejected and domain-only are free |
| `onesource_resolve` | Turn a work email or LinkedIn URL into a OneSource identity (universal DID, golden-record DID, whether an enriched record exists). | Free on the live backend |
| `onesource_enrich` | Fill missing fields (title, company, work email, ...) on an identity or on up to 100 contacts, with per-field sources. | Per lookup that filled a field (person 1, company 1, work email 2) |
| `onesource_find` | List decision-makers inside a known company by role and seniority. | Per person returned |
| `onesource_discover` | Find net-new accounts and contacts from ICP filters (industry, country, size, revenue; job function, level, title). | 1 per contact returned |

Every answer carries `cost.quoted_credits` (the most it could cost, never above your
`max_credits`) and `cost.charged_credits` (what was actually taken). The skills make the agent
state the charge after every call, respect `max_credits`, and never call find or discover without
a `limit`. Prices are development defaults, not production pricing.

## Examples

> Check these three emails and tell me which are safe to send to.

> Who runs marketing at these four accounts? Up to 3 people each, 30 credits max.

> Work through leads.csv with a 100-credit budget and give me a clean list by account.

In Claude Code, the last one runs in the `lead-qualification` subagent, and `/onesource-usage`
shows what the session spent.

## Privacy

- **B2B only.** The tools take work emails, LinkedIn profile URLs, names with a company, and
  company domains. The server refuses personal emails, phone numbers and device IDs, and the
  skills tell the agent never to ask for them.
- **The usage log holds no PII.** In Claude Code, `~/.onesource/usage.jsonl` records only
  timestamp, session id, tool, outcome, error code, request id and credits. It never records tool
  inputs, names, emails, domains or result summaries. The file is created with mode 0600. Delete
  it any time.
- The package sends data only to the OneSource server you configured. Results come back into your
  agent's conversation; handle them under your organisation's data policy.

## Development

```bash
./test/validate.sh   # manifests (claude plugin validate), JSON, frontmatter, secrets scan, unit tests
ONESOURCE_MCP_URL=http://localhost:3000/mcp ONESOURCE_API_KEY=... ./test/e2e.sh
```

`e2e.sh` runs a headless `claude -p` session with this plugin, validates one email through the
live server (about 1 credit), and checks that the answer names a validation status and the
credits, and that the usage hook logged the call. `E2E_MODE=helper` exercises the plugin's own
server entry and `headersHelper` instead of a separate `--mcp-config`. The end-to-end test covers
Claude Code only.

## Layout

```
.claude-plugin/marketplace.json      Claude Code marketplace "icustomer-onesource"
plugins/onesource/
  skills/{onesource,who-matters,onesource-credits}/SKILL.md   portable Agent Skills
  .claude-plugin/plugin.json         Claude Code plugin manifest
  .mcp.json                          Claude Code server entry: OAuth, optional headersHelper
  agents/lead-qualification.md       Claude Code subagent
  commands/onesource-usage.md        Claude Code slash command
  hooks/hooks.json, hooks/log-usage.mjs
  scripts/api-key-headers.mjs, scripts/usage-summary.mjs
test/validate.sh, test/e2e.sh, test/log-usage.test.mjs, test/protocol.test.mjs, test/fixtures/
```

## License

MIT, copyright iCustomer. See [LICENSE](LICENSE).
