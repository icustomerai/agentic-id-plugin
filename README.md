# Agentic ID

**One open ID for every person, company and agent.**

Agentic ID is an open identity protocol and a shared ledger. Resolve any person or company to one stable ID, with the evidence behind the match. Anyone can look up an ID, and anyone can add verified links back.

Live today for US work identity and companies worldwide: 75M+ people and companies resolved and verified, used by 500+ teams. More regions and consumer identity come next, consent-gated.

Open spec, open code, community ledger. Started at [iCustomer](https://icustomer.ai).

[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE) ![Claude Code plugin](https://img.shields.io/badge/Claude%20Code-plugin-orange) ![MCP](https://img.shields.io/badge/MCP-server-green)

[Quickstart](#quickstart) · [Why Agentic ID](#why-agentic-id) · [The ID](#the-id) · [Integrations](#choose-your-integration) · [The tools](#the-tools) · [Credits](#credits-and-guardrails) · [Other agents](docs/agents.md)

---

<p align="center">
  <img src="docs/assets/resolve.svg" width="820" alt="An agent asks who maya.chen@tallpinesoftware.com is. Agentic ID matches the hashed work email against the ledger and returns one stable ID, ic-7Qm2xN4vD6hWt0rK9bFc3Z, with the outcome known, confidence 0.97, no conflict, for 1 credit. The ID is recorded in the ledger.">
</p>

An agent asks who `maya.chen@tallpinesoftware.com` is. Agentic ID matches the hashed work email against the ledger and returns one stable ID (`ic-7Qm2xN4vD6hWt0rK9bFc3Z`), with what it matched on, how confident it is, and what it cost. Resolve returns the ID, not the person's details: `enrich` fills in the title and company. The example address and ID are made up.

## How this started

Agentic ID started inside iCustomer. We were building Growth Brain for growth teams, and every decision broke at the same step: one person showed up as five records across a CRM, a warehouse and three ad platforms. So we built an ID system for ourselves.

It has since resolved and verified 75M+ people and companies for 500+ teams. Identity shouldn't belong to one vendor, so we're opening the spec, the code and the ledger.

## The ledger

Agentic ID is an open ledger protocol. iCustomer runs the first node. The reference node is open source so anyone can run one.

| You can | How | Cost |
|---|---|---|
| **Look up** | Resolve any identifier against the shared ledger | 1 credit for an ID new to your workspace; free for one it already holds |
| **Contribute** | Add hashed keys and the evidence behind a link. Links enter the ledger only with evidence. Every contributor has a reputation score. | Free, and it makes resolution better for everyone |
| **Own** | Your records stay yours. The ledger stores hashed links, never raw data. | Free |

Ownership is layered. The person or company owns its ID and consent. Each brand owns its own relationship records. The ledger only connects them.

## Why Agentic ID

Most data tools look things up. An email goes in and a guess comes out. Agentic ID resolves: every person and company maps to one stable identity, and every link to that identity needs evidence.

**One ID per entity.** Start from an email, a LinkedIn URL, or a name plus company. You get the same ID whichever one you use.

**Evidence, not guesses.**
- Every match says what it matched on and how confident it is.
- Weak input comes back as `review` or `unresolvable`, with the reason and what to add.
- Identifiers that point at two records come back as a conflict. They're flagged, never merged.
- Every issued ID is recorded: which ID went to which workspace, for which request.

**A data co-operative.**
- Workspaces that contribute make resolution better for everyone in the network.
- A workspace can opt out and keep its keys private.
- A workspace's own facts and outcomes never leave it.
- Matching runs on hashed keys.

**Made for agents.** Hard credit caps on every call. Errors that tell the agent what to fix. Skills that teach the agent when to resolve, enrich, find or discover. Deliverability checks (`validate`) are one step in that flow.

<p align="center">
  <img src="docs/assets/how-it-works.svg" width="820" alt="Workspaces in the data co-operative send hashed identity keys into the shared ledger; one workspace keeps its keys private. Your agent calls resolve and gets back a stable ID with evidence, confidence and cost.">
</p>

## The ID

An Agentic ID is `ic-` followed by 22 letters and digits, for example `ic-7Qm2xN4vD6hWt0rK9bFc3Z`. It is the same ID in every workspace, and it stays the same whichever identifier you start from.

- **Entity types:** `person` and `company` today.
- **Identifiers accepted:** work email, LinkedIn URL, a name with a company, a company domain. Personal emails and phone numbers are held back before any call is made.
- **Every value has a level:** `verified` (proved by a direct check or something the person did), `corroborated` (independent sources agree), `claimed` (one source said so) or `contradicted` (newer evidence disagrees).
- **Every ID has a history:** `ledger` replays it with the hash chain re-checked; `facts` shows the evidence behind each value.

This repository holds the Claude Code plugin, its skills, evals and CLI (MIT). The written spec and the reference ledger node are not in this repository yet.

## Quickstart

In a terminal:

```bash
claude plugin marketplace add icustomerai/agentic-id-plugin
claude plugin install agentic-id@agentic-id
```

Restart Claude Code, type `/mcp`, pick `plugin:agentic-id:agentic-id` and choose **Authenticate**. The iCustomer sign-in page opens in your browser; sign in and go back to Claude Code. There is nothing to configure: the plugin connects to the hosted Agentic ID server at `https://agenticid.icustomer.ai/mcp` and runs nothing on your computer.

Then ask:

> Resolve tallpinesoftware.com with Agentic ID.

```
tallpinesoftware.com   ic-7Qm2xN4vD6hWt0rK9bFc3Z   outcome: new   1 credit charged
```

The domain, ID and numbers above are an illustration. Every real answer carries its own `cost` block.

The plugin is Markdown and a pointer to the hosted server: it needs no Node.js and installs nothing. Until this repository is public, installing needs git access to the iCustomer GitHub organisation (`gh auth login`, then `gh auth setup-git`); without it, `marketplace add` fails with a git error. The marketplace is named `agentic-id`, so it never clashes with another iCustomer marketplace such as Growth Brain's.

Using Codex, Cursor, Hermes, Pi or another agent? See [docs/agents.md](docs/agents.md).

## Choose your integration

Every surface calls the same API, with the same inputs, outputs, error codes and credits.

| Surface | Use it when | Get it |
|---|---|---|
| Claude Code plugin | You work in Claude Code | `claude plugin install agentic-id@agentic-id` |
| Hosted MCP server | Your agent speaks MCP over HTTP | `https://agenticid.icustomer.ai/mcp` |
| Agent Skills | Your agent reads SKILL.md | Link `plugins/agentic-id/skills/*` ([how](docs/agents.md)) |
| CLI | CSV files, scripts, CI, agents without MCP | `npm install -g agentic-id` |
| REST API | Any other language | `POST https://agenticid.icustomer.ai/v1/<verb>` |

## The tools

Resolve is the core. Enrich, find, discover and lookalike build on resolved identities. Validate checks a mailbox before you send.

The hosted MCP server, which the Claude Code plugin connects to:

| Tool | What it answers | Credits |
|---|---|---|
| `validate` | Is this work mailbox real? | 1 per `valid`, `invalid` or `catch-all` answer; `unknown` and refused addresses are free |
| `resolve` | Who is this? A work email, LinkedIn URL, name with a company, or a domain, resolved to one stable ID | 1 per ID; 0 for one your workspace already holds |
| `enrich` | Title, company and work email for a person; industry, size, revenue and more for a company | 2 per person, 1 per company; nothing found, nothing charged |
| `find` | Who holds a role at a known company | 2 per person |
| `discover` | Which companies and people match your ideal customer profile | 1 per company plus 2 per person; a count is free |
| `lookalike` | Which companies look like these seed companies | 1 per company |
| `facts` | How sure is Agentic ID about each value of this ID, and why | Free |
| `ledger` | What happened to this ID, with its hash chain re-checked | Free |
| `feedback` | Tell Agentic ID what happened to a value: bounced, replied, wrong person, left the company, confirmed | Free |
| `credits` | How many credits you have, what you spent and on what | Free |

The CLI adds what a remote server cannot do on your computer: whole CSV files in and out (`--file`), free worst-case estimates (`agentic-id estimate`) and many-row de-duplication.

The `cost` block in every answer is authoritative. Exact arguments for every tool: [references/tools.md](plugins/agentic-id/skills/agentic-id/references/tools.md).

## Claude Code plugin

`plugins/agentic-id/` holds the connection to the hosted MCP server, the skills, the slash commands and a subagent. It is Markdown and JSON only and runs nothing on your computer, so it can be listed in Claude's plugin directory. Its own page, [plugins/agentic-id/README.md](plugins/agentic-id/README.md), says exactly what it sends, runs and stores.

| Component | What it does |
|---|---|
| Skill `agentic-id` | Picks the right tool, gives Claude the exact arguments, and applies the credit, level and B2B-only rules |
| Skill `agentic-id-credits` | Prices, free estimates and counts, caps, and how to read what was charged |
| Skill `who-matters` | A playbook: check, resolve, enrich, find and discover inside a budget agreed with you first |
| Skill `clean-a-list` | De-duplicate a lead or CRM file and check its emails, written back as extra columns |
| Skill `lookalike-prospecting` | From your best customers to a shared profile to a list of similar companies |
| Skill `trust-check` | Whether a record is safe to act on, and why two records are the same ID |
| Agent `lead-qualification` | Works a list of leads end to end inside a credit budget and returns a list grouped by account |
| Commands | `/agentic-id:agentic-id-login`, `/agentic-id:agentic-id-status`, `/agentic-id:agentic-id-clean-list <csv>`, `/agentic-id:agentic-id-usage` |

Updates are keyed on the version in `plugin.json`; every release bumps it. Get one with `claude plugin marketplace update agentic-id`.

## Hosted MCP server

| Setting | Value |
|---|---|
| Transport | Streamable HTTP |
| URL | `https://agenticid.icustomer.ai/mcp` |
| Auth | Sign-in with your iCustomer account (OAuth 2.1 with PKCE; your agent opens a browser) |

```json
{ "mcpServers": { "agentic-id": { "type": "http", "url": "https://agenticid.icustomer.ai/mcp" } } }
```

## CLI

Install it from npm and run it in any terminal. You do not need Claude Code. It needs Node.js 18 or later and pulls in no other packages.

```bash
npm install -g agentic-id
agentic-id --version
```

Update with `npm install -g agentic-id@latest`. Remove with `npm uninstall -g agentic-id`. To run it once without installing: `npx agentic-id doctor`.

The Claude Code plugin does not bundle the command. With both installed, the plugin's skills use the CLI for CSV files, credits and estimates, and Claude Code asks you before each command it runs. From a checkout of this repository, run `cli/agentic-id`.

```bash
agentic-id login      # browser sign-in with your iCustomer account
agentic-id doctor     # checks Node, the sign-in or key, the server and what the caller can read
agentic-id workspace  # credits available, what was spent, the last charges (free)
```

Single lookups:

```bash
agentic-id resolve --domain hubspot.com
agentic-id find hubspot.com --role "VP Marketing" --limit 2 --max-credits 4
agentic-id discover --country DE --industry software --min 100 --max 2000 --count    # a count is free
agentic-id estimate find hubspot.com --role "VP Marketing" --limit 5        # the most it could cost
```

People whose employer Agentic ID cannot confirm yet come back flagged (a `!` line under the person) and are charged. Add `--confirmed-only` to `find` or `discover` to leave them out, free.

Lists (CSV in, CSV out):

```bash
agentic-id validate --file leads.csv --dry-run                  # what it would cost; sends nothing
agentic-id validate --file leads.csv --max-credits 200 --out leads.checked.csv
agentic-id resolve  --file leads.checked.csv --max-credits 500 --out leads.clean.csv
```

- **Budgets hold for the whole file.** With `--file`, `--max-credits` caps the entire run; rows not reached are marked and nothing more is charged.
- **Your file is kept.** The result is a new file with every original column and row, plus verdict, ID and duplicate columns. Repeated rows are paid once. Cells that would run as spreadsheet formulas are neutralised.
- **Personal emails never leave your machine.** They are held back and counted in the answer.
- **Machine output.** `--json` prints the full answer.
- **Exit codes.** 0 ok, 1 bad input (nothing sent), 2 key or sign-in problem, 3 credits or cap, 4 refused by the API, 5 unreachable.

`agentic-id --help` lists everything. More: [references/cli.md](plugins/agentic-id/skills/agentic-id/references/cli.md).

## REST API

```bash
curl -s https://agenticid.icustomer.ai/v1/resolve \
  -H "Authorization: Bearer $AGENTIC_ID_API_KEY" -H "content-type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"identifiers":{"company_domain":"hubspot.com"},"max_credits":1}'
```

| Verb | Route |
|---|---|
| validate | `POST /v1/validate` |
| resolve | `POST /v1/resolve` |
| enrich | `POST /v1/enrich` |
| find | `POST /v1/find` |
| discover | `POST /v1/discover` |
| lookalike | `POST /v1/lookalike` |
| report an outcome | `POST /v1/feedback` |
| facts, history | `GET /v1/facts/{id}`, `GET /v1/ledger/{id}` |
| workspace, credits | `GET /v1/workspace`, `GET /v1/credits` |

The full description is served at `https://agenticid.icustomer.ai/v1/openapi.json`. Reusing an `Idempotency-Key` with a different body is refused (`idempotency.key_reused`); reusing it with the same body returns the first answer and charges once.

## Authentication

Every surface accepts a signed-in iCustomer account or an API key. Each signed-in account has a workspace and a credit wallet of its own; an API key belongs to one workspace and draws on that workspace's wallet.

| You are | Use | How |
|---|---|---|
| A person in Claude Code | Sign-in | Ask Claude to sign you in, or type `/agentic-id:agentic-id-login` |
| A person at a terminal | Sign-in | `agentic-id login`. Kept in `~/.agentic-id/session.json`, readable by you only; renews itself for 30 days |
| A script, CI job or headless agent | API key (`ic-live-...`) | `AGENTIC_ID_API_KEY`, or the file named in `AGENTIC_ID_API_KEY_FILE`. A key, when set, is used instead of a sign-in |

Never put an API key in a URL, prompt, chat message or committed file. The skills tell agents never to ask for one in chat.

## Credits and guardrails

You pay only for results delivered. Rejected input, misses and errors on our side are free.

- `max_credits` is a hard budget a call never exceeds. A call that could cost more than 10 credits is not sent without one (`cap_required`).
- The skills set `max_credits` on every paid call, never above a number you gave, and ask for one before anything over 10 credits.
- Every answer shows `cost.quoted_credits` (the most it could cost) and `cost.charged_credits` (what it did cost). A `discover` count and `agentic-id estimate` are free.
- The skills make the agent report credits after each call, total them for multi-step work, and ask before raising a budget.

## Errors

JSON with a machine-readable code and a `fix` the agent can act on.

| Code | HTTP | Meaning |
|---|---|---|
| `request.invalid` | 400 | A missing, unknown or contradictory argument; `issues` names each one |
| `auth.missing_key`, `auth.invalid_key`, `auth.token_expired` | 401 | Not signed in, a wrong or revoked key, or a sign-in that ran out |
| `cap_required` | (not sent) | The call could cost more than 10 credits and has no `max_credits` |
| `credits.insufficient` | 402 | The wallet cannot cover the call; `available_credits` says what is left. Stop, do not retry |
| `purpose.not_allowed`, `pii.scope_required` | 403 | The data may not be used for this purpose, or the key cannot read contact values |
| `identity.merge_blocked` | 409 | Two records disagree on a strong identifier. Nothing is merged |
| `idempotency.key_reused` | 422 | The key was already used with a different request |
| `rate_limited` | 429 | Retry after `retry_after_seconds` |
| `service.unavailable` | 503 | Nothing was charged. Try once more later |

Full list: [references/errors.md](plugins/agentic-id/skills/agentic-id/references/errors.md).

## Where your data goes

- **Work identifiers only.** Work emails, LinkedIn profile URLs, names with a company, company domains. Personal email addresses, phone numbers and malformed input are held back on your machine before any call is made, and the answer says how many were held back.
- **Requests go only to the server you configured.** Results come back into your agent's conversation. Handle them under your organisation's data policy. Contact values come back masked unless your key is allowed to read them.
- **The plugin keeps nothing on your computer.** Your credit history is the server's record: `agentic-id workspace` or your iCustomer account.

## Skills and evals

The skills are plain Agent Skills and work in any agent that reads SKILL.md. Skill changes are tested with `claude plugin eval` against synthetic mocks (`plugins/agentic-id/evals/`), so evals need no API key, no credits and no real data.

```bash
./test/evals.sh                    # full suite
EVAL_QUICK=1 ./test/evals.sh       # 1 run per case, no baseline
./test/evals.sh --tag triggering   # one group
```

## Development

```bash
bash test/validate.sh                                      # everything below that needs no network
node --test test/v3-unit.test.mjs test/signin.test.mjs     # CLI unit tests, no network
node test/directory-check.mjs                              # plugin directory checks (rules for a non-Verified organization)
./test/evals.sh                                            # skill evals against mocks (model cost only)

# The plugin against the hosted server, after /mcp sign-in (one free call):
./test/e2e.sh
# A real CLI sign-in, with you at the browser:
AGENTIC_ID_URL=<url> test/real-signin.sh
```

```
plugins/agentic-id/                 the Claude Code plugin: Markdown and JSON only
  .claude-plugin/plugin.json        plugin manifest
  .mcp.json                         the hosted MCP server (https://agenticid.icustomer.ai/mcp)
  skills/                           portable Agent Skills
  agents/lead-qualification.md      subagent
  commands/                         slash commands
  evals/                            skill evals and tool mocks
cli/                                the agentic-id CLI and its API client (plain Node.js, no packages), published to npm
docs/agents.md                      setup for Codex, Hermes, Pi and other agents
docs/v3.md                          running against a local V3 stack
docs/assets/                        README graphics and their generator
test/                               unit tests, directory checks, evals, sign-in checks
```

This repository is its own marketplace, named `agentic-id` (`.claude-plugin/marketplace.json`).

The root `package.json` publishes the CLI to npm as `agentic-id`. It ships only `cli/`, and its version always matches `plugin.json` (a unit test checks both). To release:

1. Bump the version in `package.json`, `plugins/agentic-id/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` and `CLIENT` in `cli/lib/client.mjs`, and merge.
2. Check the package: `npm pack --dry-run`.
3. Publish: in GitHub, open Actions, then **Publish CLI to npm**, then **Run workflow** on `main` with **Publish to npm** ticked. Or push a tag `v<version>` on the merge commit. Either way `.github/workflows/publish-npm.yml` runs the tests, installs the packed CLI and publishes. It needs the `NPM_TOKEN` repository secret. Left unticked, a run only checks and packs.

## Editions

| Edition | What you get | Price |
|---|---|---|
| **Agentic ID** (open source) | Spec, SDK, CLI, plugin, reference node. Run it yourself. | Free |
| **Agentic ID Cloud** (hosted by iCustomer) | The shared ledger, resolution across 100+ independent sources, credits | Pay per use. Free credits to start. |
| **iCustomer Enterprise** | Agentic ID inside your own warehouse, ongoing monitoring, SLA and DPA, plus Growth Brain | Annual packs. [Talk to us](https://icustomer.ai). |

## Security, changes, license

- Security issues: please don't open a public issue; contact the iCustomer team through [icustomer.ai](https://icustomer.ai).
- Changes: [CHANGELOG.md](CHANGELOG.md).
- License: MIT, copyright iCustomer. See [LICENSE](LICENSE).
