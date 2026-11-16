# Changelog

All notable changes to this marketplace and the `agentic-id` plugin (named `onesource` before 0.4.0). Versions follow
[Semantic Versioning](https://semver.org/).

## Unreleased

Fixes from the Nov 15 retest.

### Fixed
- **Command names in the docs.** Every slash command is written with the plugin prefix, for example
  `/agentic-id:agentic-id-status`, which is the name Claude Code shows. A test keeps it that way.
- **`agentic_id_estimate` checks the arguments like the call would.** Arguments the call refuses
  (enrich by an id, an empty list, a personal email, find without an account) are refused by the
  estimate too, with the same fix, instead of "nothing to enrich". Enrich by id points to
  `agentic_id_facts`. The estimate still makes no paid calls.
- **The plugin can be saved to claude.ai.** Saving it failed with "Plugin contains a top-level
  bin/ directory": plugins hosted on claude.ai may not ship one. The `agentic-id` command moved
  from `bin/agentic-id` to `scripts/agentic-id`.

### Changed
- The command is put on PATH by a session-start hook (`hooks/add-to-path.mjs`) instead of by the
  `bin/` folder, so `agentic-id ...` still works by name in Claude Code. Where a host does not
  offer that, the skills give the full path.
- From a checkout the command is now `plugins/agentic-id/scripts/agentic-id`.

## 0.5.2 - 2026-11-14

Fixes from the pre-launch test report.

### Fixed
- **Data-source names and bills never reach the user.** Every API answer and error now passes
  through `server/lib/shield.mjs`: vendor names are taken out of the text, `provider` / `plan`
  details are dropped, `total_at_provider` becomes `total_matching`, and a data source's own billing
  or quota message ("payment required", "balance $0", "4 sources failed") becomes one plain line:
  a data source was unavailable and nothing was charged for it (`source.unavailable`). The user's
  own wallet error (`credits.insufficient`) is kept as it is.
- **A wrong server URL no longer says "Not signed in".** With no credential, the client checks the
  address first and says `unreachable`, `not_agentic_id` or `bad_url`, with how to fix the URL.
  `agentic_id_status` and `agentic-id doctor` say the same.
- **Budget caps smaller than the list.** Validate and enrich send only what the cap can pay for,
  mark the rest `not_checked` / `not_run` (free), and say `partial: true`. They never report "done"
  for a run that stopped.
- **A batch failing part way** keeps what earlier batches paid for: the answer is partial with
  `stopped`, and a file run still writes every row. A partial file run exits non-zero.
- **Company lists.** `agentic_id_enrich` takes `companies`, and a contact with only a company on it
  is enriched as a company at 1 credit (it was priced and sent as a person at 2).
- **Personal data in the Company column** (an email, a phone number, Gmail) is held back on this
  machine and never sent.
- **Messy CSVs:** UTF-16 and Windows-1252 exports, Excel's `sep=` line, separators inside quotes,
  pipes, more German, French and Spanish headers, quoted names, and formulas after spaces or in
  full-width form.
- **Discover counts first** even when the user already gave a budget (skill rule, tool description
  and server instructions). The lookalike skill now triggers on "how would I find more accounts
  like ..." questions.

### Changed
- **The marketplace is named `agentic-id`** (it was `icustomer`, the same name as Growth Brain's
  marketplace, so one replaced the other). Install with
  `claude plugin marketplace add icustomerai/agentic-id-plugin` and
  `claude plugin install agentic-id@agentic-id`.
- docs/agents.md's Claude Code section described a remote MCP with `/mcp` sign-in; it now
  describes the local server, `/agentic-id:agentic-id-login` and the two plugin options.
- Eval mocks match what the plugin's server returns, and ship a `_tools.json` with the real tool
  schemas.

## 0.5.1 - 2026-11-14

### Changed
- **The default server is the hosted Agentic ID service** (`https://onesource-v3.icustomer.ai`), in the plugin
  option `api_url` and in the CLI when `AGENTIC_ID_URL` is not set. A new install now works after
  sign-in with nothing to configure. Before, the default was a local V3 stack
  (`http://127.0.0.1:3100`), so every new user had to type the address first.
- Developers on a local stack: set `api_url` in the plugin options, or `AGENTIC_ID_URL`, to
  `http://127.0.0.1:3100`. If you relied on the old default, set it now.
- **README rewritten for V3.** It described the hosted v2 endpoint: `did:agenticid:` IDs, five
  tools, `/mcp` sign-in, npm packages and an install command naming a repository that does not
  exist. It now shows `ic-` IDs, the real tools and prices, sign-in by asking Claude, the
  `icustomer` marketplace, the production address and the real error codes.
- **The README's terminal graphic** showed a `did:agenticid:` ID, a name and title coming back
  from resolve, and a cost of 0. It now shows what resolve returns: an `ic-` ID, the outcome, and
  1 credit (free when the workspace already holds the ID).

## 0.5.0 - 2026-11-13

The plugin runs on the Agentic ID V3 API. Breaking: the hosted v2 MCP endpoint is no longer used.

### Added
- **Sign in with an iCustomer account**, no API key needed: `/agentic-id:agentic-id-login` or `agentic-id login`
  (OAuth 2.1 with PKCE against the API; the session is kept in `~/.agentic-id/session.json` and
  renews itself for 30 days). `agentic-id logout` ends it. The API key option is now optional.
- `agentic_id_workspace` / `agentic-id workspace`: credits available and held, spend by tool, the
  latest grants and charges, IDs held, contributing or private.
- `agentic_id_report` / `agentic-id report`: bounced, replied, wrong person or confirmed for an ID
  the workspace holds; one, a list, or a CSV.
- Every paid call carries an idempotency key, so a dropped connection or a timeout inside the API
  is asked again without paying twice. Errors carry a `request_id`.

- `agentic_id_list`: a whole CSV in one tool call, run inside the plugin's own server (a key set in
  the plugin options never reaches shell commands). `agentic_id_login`: sign in or out from a tool
  call. `agentic_id_status` shows the credits available.
- **Approval before larger spends:** Claude Code asks the user to approve any call that could
  spend more than 10 credits (option "Ask before spending more than"). The session budget now
  prices calls that carry no cap.
- Fixes from system testing: a list resolve could exceed its cap and could crash after charging;
  the CSV writer dropped blank rows, repeated column names, extra cells, the BOM and CRLF, and
  turned phone numbers into text; the command could overwrite its input; an unrecognised email
  column was ignored silently; free-mail addresses on country domains (yahoo.de, hotmail.fr) were
  not held back; simultaneous commands could sign the user out while renewing; failed calls were
  missing from the usage log.

### Changed
- `.mcp.json` starts a bundled, dependency-free stdio MCP server (`server/mcp.mjs`) that calls the
  V3 public API (`/v1/*`) with an API key. OAuth sign-in through `/mcp` is gone until V3 offers it.
- Plugin options: `api_key` is now required; new `api_url` (default `http://127.0.0.1:3100`) and
  optional `session_budget`.
- IDs are `ic-...` and keys `ic-dev-...` / `ic-live-...`, as V3 issues them since its rename; `os_` IDs are
  refused locally. The CSV columns the CLI adds for enriched fields are `aid_<field>` and
  `aid_<field>_level`.
- Tool arguments and answers follow the V3 contract: `id` is an `ic-...` ID; resolve returns
  `outcome` (known, new, review, conflict, unresolvable); enrich returns `results[].fields[]` with a
  `level` per value; find and discover return `excluded` and `rejected`; discover takes
  `employees_min` / `employees_max` and `count_only`.
- Prices: find is 2 credits per person, an `invalid` validate answer is charged, resolve is 1 per
  ID (0 for an ID the workspace holds).
- Error codes are V3's (`auth.invalid_key`, `credits.insufficient`, `request.invalid`, ...).

### Added
- Tools: `agentic_id_resolve_many`, `agentic_id_lookalike`, `agentic_id_facts`, `agentic_id_ledger`,
  `agentic_id_estimate`, `agentic_id_status`.
- Local guards: personal emails and phone numbers never leave the machine; input is cleaned;
  repeats are paid once; calls over 10 credits need `max_credits`.
- CLI `agentic-id` in the plugin's `bin/`: every tool, CSV in and out for validate, resolve and
  enrich, `--dry-run`, `estimate`, `doctor`, exit codes.
- Skills `clean-a-list`, `lookalike-prospecting`, `trust-check`.
- Hook: optional per-session credit budget. Commands `/agentic-id:agentic-id-status`, `/agentic-id:agentic-id-clean-list`.
- Tests: unit tests for the bundled layer, a stdio protocol test, 8 new eval cases.

### Not yet updated
- The repository README and `docs/agents.md` still describe the v2 endpoint. See `docs/v3.md`.

## 0.4.0 - 2026-11-12

OneSource is now **Agentic ID**. Breaking: every name changed at once, with no aliases.

### Changed
- Marketplace `icustomer-onesource` is now `icustomer`; plugin `onesource` is now `agentic-id`.
  Install with `claude plugin install agentic-id@icustomer`.
- MCP server entry `onesource` is now `agentic-id` (`/mcp` → `plugin:agentic-id:agentic-id`).
- Tools `onesource_<verb>` are now `agentic_id_<verb>` (validate, resolve, enrich, find, discover).
  Needs an MCP server that serves the new names.
- Skills `onesource` and `onesource-credits` are now `agentic-id` and `agentic-id-credits`; command
  `/onesource-usage` is now `/agentic-id:agentic-id-usage`; the CLI binary is `agentic-id`.
- Local files move from `~/.onesource/` to `~/.agentic-id/` (usage log, API key). Env vars
  `ONESOURCE_*` are now `AGENTIC_ID_*`. Client header `x-onesource-client` is now `x-agentic-id-client`.
- API keys are now `ic-live-...` and IDs `ic-...` (iCustomer ID). Old `os_live_` keys and `os_` IDs
  are refused: ask for a new key.

**Migration:** uninstall `onesource@icustomer-onesource`, install `agentic-id@icustomer`, then sign in
again through `/mcp`. In API-key mode, get a new `ic-live-` key and set it with
`/plugin configure agentic-id@icustomer`.

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
