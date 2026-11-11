# Changelog

All notable changes to this marketplace and the `agentic-id` plugin (named `onesource` before 0.4.0). Versions follow
[Semantic Versioning](https://semver.org/).

## 0.4.0 - 2026-11-12

OneSource is now **Agentic ID**. Breaking: every name changed at once, with no aliases.

### Changed
- Marketplace `icustomer-onesource` is now `icustomer`; plugin `onesource` is now `agentic-id`.
  Install with `claude plugin install agentic-id@icustomer`.
- MCP server entry `onesource` is now `agentic-id` (`/mcp` → `plugin:agentic-id:agentic-id`).
- Tools `onesource_<verb>` are now `agentic_id_<verb>` (validate, resolve, enrich, find, discover).
  Needs an MCP server that serves the new names.
- Skills `onesource` and `onesource-credits` are now `agentic-id` and `agentic-id-credits`; command
  `/onesource-usage` is now `/agentic-id-usage`; the CLI binary is `agentic-id`.
- Local files move from `~/.onesource/` to `~/.agentic-id/` (usage log, API key). Env vars
  `ONESOURCE_*` are now `AGENTIC_ID_*`. Client header `x-onesource-client` is now `x-agentic-id-client`.

**Migration:** uninstall `onesource@icustomer-onesource`, install `agentic-id@icustomer`, and move
`~/.onesource/api-key` to `~/.agentic-id/api-key` if you use API-key mode.

The MCP endpoint (`https://mcp-onesource-development.icustomer.ai/mcp`) and the GitHub repository
keep their names for now.

## 0.3.1 - 2026-11-11

Fixes for the Claude plugin directory's validation report.

### Changed
- The MCP server URL is fixed in `.mcp.json` (`https://mcp-onesource-development.icustomer.ai/mcp`). The
  `server_url` option is gone: the directory has to be able to read the address. **Migration:**
  nothing to do if you kept the default; a custom `server_url` is no longer read.
- `/onesource-usage` pre-approves only its own script instead of any `node` command.
- The usage hook is declared as `command` plus `args`, and reads only `ONESOURCE_CONFIG_DIR` from the
  environment instead of taking the whole environment object.

### Added
- `privacyPolicyUrl` and the listing icon (`.claude-plugin/icon.png`).

## 0.3.0 - 2026-11-11

Ready for the Claude plugin directory: no blocking findings against the
[pre-submission checklist](https://claude.com/docs/plugins/pre-submission-checklist).

### Changed
- API-key mode moved to a `userConfig` option. `api_key` is `sensitive`, so Claude Code keeps it in
  the system keychain and sends it as `x-api-key` through `${user_config.api_key}`. Left empty, the
  plugin signs in with OAuth as before.
- The server URL is the `server_url` option (default: the hosted development server) instead of the
  `ONESOURCE_MCP_URL` shell expansion, which the directory refuses.
- The client label is a fixed `x-onesource-client: claude-plugin/0.3.0` header.
- `displayName` "iCustomer OneSource" and `repository` in `plugin.json`.

### Removed
- `scripts/api-key-headers.mjs` (the `headersHelper`). It read a key from `~/.onesource/api-key` or
  the environment, which the directory holds for review. **Migration:** if you used the key file
  with the plugin, paste the key into `/plugin` → OneSource → **Configure options** → API key. The
  CLI still reads `~/.onesource/api-key`.

### Added
- `plugins/onesource/README.md` and `LICENSE`: the directory shows the plugin folder's README as the
  listing, and it now says everything the plugin sends, runs and stores.
- `test/directory-check.mjs`: the directory's automated checks (layout, manifest and name, README and
  license, file limits, MCP and hook commands, launchers, credentials, front matter), run by
  `validate.sh`.
- `test/e2e.sh` `E2E_MODE=plugin` runs the shipped `.mcp.json` with its options set through a 0600
  `--settings` file. `helper` still works as an alias.

## 0.2.0 - 2026-11-11

Tested end to end in Claude Code against the production OneSource backend.

### Changed
- Skills follow the backend's current routes (contact enrichment v3.1, company enrichment v3,
  advanced discovery v2):
  - enrich: companies (`account` / `accounts`), a `job_title` hint, and how to read the trust
    status (Enriched with email / Enriched / Not Enriched) and `outreach_ready`
  - enrich: the real `required_fields` names (`email`, not `work_email`, which the backend refuses)
  - find: roles are job titles; decision makers by default; a company domain is required
  - discover: keyword and tech-stack filters, accounts-only and persona modes, and the `dropped`
    reasons to widen a short result
- Prices measured live: find 1 per person (was "1-2, being finalised"), discover 1 per account
  plus 1 per contact, enrich 1 per contributing data source (about 2 per person).
- Version 0.2.0, so `claude plugin update` picks the changes up.

## Unreleased (before 0.2.0)

### Added
- Skill evals in `plugins/onesource/evals/`:
  - 4 triggering cases and 8 behaviour cases
  - synthetic mocks for all five tools
  - `test/evals.sh`, which always runs with `--no-publish` and a cost ceiling
  - `test/check-evals.mjs`, a static check now included in `validate.sh`
- `onesource` skill references:
  - `references/tools.md`: the exact arguments for each tool, the CLI equivalent and the fields to read back
  - `references/cli.md`: using OneSource through the CLI when the MCP tools are missing
  - `references/errors.md`: the full error catalogue
- `docs/agents.md`: per-agent setup (Claude Code API-key mode, Codex, Hermes, Pi, Muse Code).

- Animated README graphics (`docs/assets/resolve.svg`, `docs/assets/how-it-works.svg`). They use
  SMIL animation and no scripts. They are generated by `docs/assets/src/make-animations.mjs`, and
  every person and company in them is fictional, on domains checked to be unregistered.

- README sections for the CLI and for hybrid sign-in. The CLI part covers browser sign-in or an
  API key, CSV files with a whole-file budget, and `-o csv` / `jsonl`. Troubleshooting covers the
  stale "Needs authentication" state and version bumps.
- `onesource` skill: a file of more than about 100 rows goes through `onesource validate|enrich
  --file` when the CLI is available. `references/cli.md` covers `ONESOURCE_*` variables,
  `login` / `whoami` / `doctor`, `--file` budgets and the row statuses (`skipped`, `rejected`,
  `not_sent`).

### Changed
- Positioning:
  - OneSource is presented as ledger-based identity resolution (a verified ledger of 75M+ companies
    and people, grown by a data co-operative), not as email validation
  - resolve leads; validate is the pre-send check
  - covers the README, release notes, plugin and marketplace descriptions, and the `onesource`
    skill description
- README rewritten for developers:
  - quickstart with sample output
  - a "Choose your integration" table: plugin, MCP, skills, CLI (preview), SDK (preview), REST
  - examples across surfaces; auth, credits, errors and data-handling sections; how the skills are tested
- Skill `onesource` is shorter and points to its references. It now covers the CLI path and says
  what to do when results don't match the roles asked for.
- Skill `who-matters`:
  - budget example uses the higher find price (2 per person), matching `onesource-credits`
  - shrinks the plan to fit the budget
  - flags off-filter results
- Skill `onesource-credits`: explains reading the balance from `ledger.available_after` or
  `onesource credits`.

## 0.1.0 - 2026-11-04

First release as a standalone marketplace (`icustomer-onesource`), lifted from the `plugin/`
draft in the OneSource server repo and reworked.

### Added
- `onesource` MCP server (Streamable HTTP) defaulting to the development deployment,
  overridable with `ONESOURCE_MCP_URL`. Sign-in is OAuth; no static secret headers.
- Optional API-key mode through a `headersHelper` (`scripts/api-key-headers.mjs`) that sends
  `x-api-key` only when a key is configured in `~/.onesource/api-key` (or `ONESOURCE_API_KEY`
  outside plugin scope), for CI and headless use.
- Skill `onesource-credits`: development prices, how to estimate and cap spend, quoted vs charged.
- PostToolUse hook `hooks/log-usage.mjs`: one PII-free JSON line per OneSource call in
  `~/.onesource/usage.jsonl` (tool, outcome, error code, request id, credits).
- Command `/onesource-usage`: credits per tool and the last 20 calls from that log.
- `test/validate.sh` (manifest validation, JSON and frontmatter checks, unit tests) and
  `test/e2e.sh` (headless Claude Code against a live server).

### Changed
- Skill `onesource`: tool-choice table, verdict meanings, explicit credit rules (state credits,
  respect `max_credits`, always pass `limit` to find/discover), error-code table, B2B-only rule.
- Skill `who-matters`: agree scope and budget before the first paid call; credits table at the end.
- Agent `lead-qualification`: restricted tool list, default 50-credit ceiling without an explicit
  budget, stop-before-overspend loop, CSV output for long lists.
