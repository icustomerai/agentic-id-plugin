# OneSource for Claude Code

A Claude Code plugin marketplace (`icustomer-onesource`) with one plugin, `onesource`: iCustomer's
B2B identity and enrichment service inside Claude Code. Validate work emails, resolve people to
OneSource identities, enrich missing fields, find the buying group inside a company, and discover
net-new accounts and contacts from ICP filters, with every credit accounted for.

## What you get

| Component | What it does |
| --- | --- |
| MCP server `onesource` | The five OneSource tools over Streamable HTTP, signed in with your iCustomer account (OAuth). |
| Skill `onesource` | Which tool to use when, verdict meanings, credit rules, B2B-only rule, error codes. |
| Skill `who-matters` | Playbook: validate, resolve, enrich, find the buying group, discover; budget agreed up front. |
| Skill `onesource-credits` | Development prices, how to estimate and cap spend, quoted vs charged credits. |
| Agent `lead-qualification` | Works a lead list end to end inside a credit budget; returns a clean list by account. |
| Hook (PostToolUse) | Appends one PII-free line per OneSource call to `~/.onesource/usage.jsonl`. |
| Command `/onesource-usage` | Credits per tool and the last 20 calls, from that log. |

## Install

```bash
# from a local checkout
claude plugin marketplace add /path/to/onesource-plugin
# or, once it is published to GitHub
claude plugin marketplace add <github-org>/onesource-plugin

claude plugin install onesource@icustomer-onesource
```

Restart Claude Code after installing. To try it without installing:
`claude --plugin-dir /path/to/onesource-plugin/plugins/onesource`.

The plugin's hook and helper scripts run with `node` (18 or later) from your `PATH`.

## Sign in

The server uses OAuth. The first time, run `/mcp`, pick `plugin:onesource:onesource` and choose
**Authenticate**; a browser window opens for your iCustomer sign-in. Tokens are stored by Claude
Code, not by this plugin.

By default the plugin talks to the development deployment,
`https://mcp-onesource-development.icustomer.ai/mcp`. Point it elsewhere (for example a local
server) with:

```bash
export ONESOURCE_MCP_URL=http://localhost:3000/mcp
```

## API-key mode (CI and headless use)

People should sign in with OAuth. For scripts and CI the server also accepts an API key in the
`x-api-key` header. The plugin's `.mcp.json` ships **no static headers**; instead it declares a
`headersHelper` (`plugins/onesource/scripts/api-key-headers.mjs`) that adds `x-api-key` only when a
key is configured, and otherwise sends nothing so OAuth applies.

Claude Code removes credential-named environment variables (`*_API_KEY`, `*_TOKEN`, ...) from a
plugin's `headersHelper` environment, so in plugin mode the key is read from a file:

```bash
mkdir -p ~/.onesource && chmod 700 ~/.onesource
printf '%s\n' "<your key>" > ~/.onesource/api-key && chmod 600 ~/.onesource/api-key
# or keep it elsewhere: export ONESOURCE_CONFIG_DIR=/secure/dir  (reads /secure/dir/api-key)
```

Remove the file to go back to OAuth. Outside plugin scope (running the helper by hand, or from a
user-scoped MCP config) the helper also honours `ONESOURCE_API_KEY`.

Alternative without the helper: give Claude Code its own server entry and load only that, as
`test/e2e.sh` does:

```json
{ "mcpServers": { "onesource": { "type": "http", "url": "https://<host>/mcp",
  "headers": { "x-api-key": "${ONESOURCE_API_KEY}" } } } }
```

```bash
claude -p "..." --mcp-config onesource.mcp.json --strict-mcp-config \
  --allowedTools mcp__onesource__onesource_validate
```

Never commit a key. `.gitignore` excludes `api-key`, `.env*` and `mcp.local.json`.

## The five tools

Tool names in Claude Code are `mcp__plugin_onesource_onesource__onesource_<verb>`.

| Tool | Use it to | Credits (development prices) |
| --- | --- | --- |
| `onesource_validate` | Check whether a work email is deliverable (one, or up to 1000 per call); or verify a company domain alone. Verdicts: valid, invalid, catch-all, risky, unknown. | 1 per address with a valid / catch-all / risky verdict; invalid, unknown, rejected and domain-only are free |
| `onesource_resolve` | Turn a work email or LinkedIn URL into a OneSource identity (universal DID, golden-record DID, whether an enriched record exists). | Free on the live backend |
| `onesource_enrich` | Fill missing fields (title, company, work email, ...) on an identity or on up to 100 contacts, with per-field sources. | Per lookup that filled a field (person 1, company 1, work email 2) |
| `onesource_find` | List decision-makers inside a known company by role and seniority. | Per person returned |
| `onesource_discover` | Find net-new accounts and contacts from ICP filters (industry, country, size, revenue; job function, level, title). | 1 per contact returned |

Every answer carries `cost.quoted_credits` (the most it could cost, never above your
`max_credits`) and `cost.charged_credits` (what was actually taken). The skills make Claude state
the charge after every call, respect `max_credits`, and never call find or discover without a
`limit`. Prices are development defaults, not production pricing.

## Examples

> Check these three emails and tell me which are safe to send to.

> Who runs marketing at these four accounts? Up to 3 people each, 30 credits max.

> Use the lead-qualification agent on leads.csv with a 100-credit budget.

> /onesource-usage

## Privacy

- **B2B only.** The tools take work emails, LinkedIn profile URLs, names with a company, and
  company domains. Personal emails, phone numbers and device IDs are refused by the server, and
  the skills tell Claude never to ask for them.
- **The usage log holds no PII.** `~/.onesource/usage.jsonl` records only timestamp, session id,
  tool, outcome, error code, request id and credits. It never records tool inputs, names, emails,
  domains or result summaries. The log file is created with mode 0600. Delete it any time.
- The plugin sends data only to the OneSource server you configured. Results come back into your
  Claude Code conversation; handle them under your organisation's data policy.

## Development

```bash
./test/validate.sh   # manifests (claude plugin validate), JSON, frontmatter, secrets scan, unit tests
ONESOURCE_MCP_URL=http://localhost:3000/mcp ONESOURCE_API_KEY=... ./test/e2e.sh
```

`e2e.sh` runs a headless `claude -p` session with this plugin, validates one email through the
live server (about 1 credit), and checks that the answer names a validation status and the
credits, and that the usage hook logged the call. `E2E_MODE=helper` exercises the plugin's own
server entry and `headersHelper` instead of a separate `--mcp-config`.

## Layout

```
.claude-plugin/marketplace.json      marketplace "icustomer-onesource"
plugins/onesource/
  .claude-plugin/plugin.json
  .mcp.json                          http server, OAuth, optional headersHelper
  skills/{onesource,who-matters,onesource-credits}/SKILL.md
  agents/lead-qualification.md
  commands/onesource-usage.md
  hooks/hooks.json, hooks/log-usage.mjs
  scripts/api-key-headers.mjs, scripts/usage-summary.mjs
test/validate.sh, test/e2e.sh, test/log-usage.test.mjs, test/fixtures/
```

## License

MIT, copyright iCustomer. See [LICENSE](LICENSE).
