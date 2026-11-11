<!--
REVIEW BEFORE THIS REPO GOES PUBLIC (founder sign-off on external claims):
  [ ] "75M+ verified companies and people": confirm the current count and the wording "verified".
  [ ] Data co-operative: contribution is modelled in the service, but on today's live path the
      opt-out does not change resolve. Confirm we can describe it publicly as it stands.
  [ ] Ledger: today every issued ID is recorded. Signed, append-only, independently checkable
      copies come with the next service version, so this README does not claim them yet.
  [ ] Evidence fields: the hero animation and quickstart show "matched on work_email · confidence
      0.97". Today's live resolve (proxied to the Go backend) returns neither; v3 does. Either
      ship matched_on + confidence in the live path before launch, or trim them from the visuals.
  [ ] Example people and companies (Maya Chen, Tallpine Software, ...) are fictional; their
      domains were checked to be unregistered on 2026-11-10.
-->

<h1 align="center">OneSource</h1>

<p align="center">
  <b>Identity resolution for coding agents, built on a verified identity ledger.</b><br/>
  Resolve any B2B person or company to one stable ID, backed by evidence, from a ledger of
  <b>75M+ verified companies and people</b> that a data co-operative keeps growing.
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
  <img alt="Claude Code plugin" src="https://img.shields.io/badge/claude%20code%20plugin-0.1.0-6b4fbb">
  <img alt="MCP" src="https://img.shields.io/badge/MCP-streamable%20http-2b7489">
</p>

<p align="center">
  <img src="docs/assets/resolve.svg" width="820" alt="An agent asks who maya.chen@tallpinesoftware.com is. OneSource matches the hashed work email against its verified ledger of 75M+ companies and people and returns Maya Chen, VP Marketing at Tallpine Software, with a stable ID, confidence 0.97, no conflict, 0 credits, and the issued ID recorded in the ledger.">
</p>

<p align="center">
  <a href="#quickstart">Quickstart</a> ·
  <a href="#why-onesource">Why OneSource</a> ·
  <a href="#choose-your-integration">Choose your integration</a> ·
  <a href="#the-five-tools">The five tools</a> ·
  <a href="#credits-and-guardrails">Credits</a> ·
  <a href="#skills-and-evals">Skills and evals</a> ·
  <a href="docs/agents.md">Other agents</a>
</p>

---

## Why OneSource

Most B2B data tools look things up: an email in, a guess out. OneSource **resolves**: every person
and company maps to one stable identity in a ledger, and every link to that identity needs
evidence.

- **One ID per entity, from a verified ledger.** 75M+ companies and people. Resolve an email, a
  LinkedIn URL, or a name with a company, and you get the same stable ID whichever one you start
  from.
- **Evidence, not guesses.**
  - Every match says what it matched on and how confident it is.
  - Weak input comes back as `needs_evidence`, with what to add.
  - Identifiers that point at two records come back as a `conflict`, flagged and never merged.
- **Every ID issued is recorded.** The ledger keeps a trail of which ID was handed to which
  workspace, for which request.
- **A data co-operative.**
  - Workspaces that contribute make resolution better for everyone in the network.
  - A workspace that opts out keeps its keys private.
  - A workspace's own facts and outcomes never leave it.
  - Matching runs on hashed keys.
- **Made for agents.**
  - Hard credit caps on every call.
  - Errors that tell the agent what to fix.
  - Skills that teach the agent when to resolve, enrich, find or discover.
  - Deliverability checks (validate) are one step in that flow, not the product.

<p align="center">
  <img src="docs/assets/how-it-works.svg" width="820" alt="Workspaces in the data co-operative send hashed identity keys into the verified identity ledger of 75M+ companies and people; one workspace keeps its keys private. Your agent calls resolve and gets back a stable ID with evidence, confidence and cost.">
</p>

## Quickstart

In Claude Code:

```bash
claude plugin marketplace add icustomerai/onesource-plugin
claude plugin install onesource@icustomer-onesource
```

Restart Claude Code, run `/mcp`, choose `plugin:onesource:onesource` → **Authenticate**, and sign
in with your iCustomer account. Then ask:

```text
Who is maya.chen@tallpinesoftware.com? Then find two more marketing leaders at her company. 6 credits max.
```

```text
✓ Maya Chen · VP Marketing · Tallpine Software
  id did:icustomer:global:person:7a1e0c9f3b · matched on work_email · confidence 0.97 · free

Marketing leaders at tallpinesoftware.com (2 of 7 found):
  Daniel Okoro   Head of Demand Generation     email unverified
  Sofia Marin    Director, Product Marketing   email unverified

Charged 4 credits (cap 6). 46 credits left.
```

Using Codex, Cursor, Hermes, Pi or another agent? See [docs/agents.md](docs/agents.md).

## Choose your integration

All surfaces call the same API with the same inputs, outputs, error codes and credits.

| Surface | Use it when | Get it | Status |
| --- | --- | --- | --- |
| [Claude Code plugin](#claude-code-plugin) | You work in Claude Code | `claude plugin install onesource@icustomer-onesource` | ✅ Stable, tested end to end |
| [MCP server](#mcp-server) | Your agent speaks MCP (Codex, Cursor, Hermes, Pi, ...) | `https://mcp-onesource-development.icustomer.ai/mcp` | ✅ Live (development) |
| [Agent Skills](#skills-and-evals) | Your agent reads `SKILL.md` | Link `plugins/onesource/skills/*` ([how](docs/agents.md#install-the-skills)) | ✅ Stable |
| [CLI](#cli-preview) | CSV files, scripts, CI, or an agent without MCP | Build from source | 🧪 Preview, tested end to end |
| [TypeScript SDK](#typescript-sdk-preview) | You are building an app or service | Build from source | 🧪 Preview |
| [REST API](#rest-api) | Any other language | `POST /v1/entities/<verb>` | ✅ Live (development) |

Coding agents should use the **MCP server** where they can (it handles sign-in) and the **CLI**
where they can't. The skills cover both, so the same skill works either way.

## The five tools

Resolve is the core. Enrich, find and discover build on resolved identities, and validate checks
deliverability before you send.

| Verb | Ask it | MCP tool | CLI | Credits\* |
| --- | --- | --- | --- | --- |
| **resolve** | Who is this? Resolves an email, LinkedIn URL, or name and company to one stable ID from the ledger, with what it matched on and how confident it is. | `onesource_resolve` | `onesource resolve` | Free |
| **enrich** | What's their title, work email, LinkedIn? Or a company's industry, size and HQ. Up to 100 per call. Every person comes back with a trust status: *Enriched with email* (safe to send), *Enriched*, or *Not Enriched*. | `onesource_enrich` | `onesource enrich` | 1 per data source that contributed: about 2 per person, 1–3 per company |
| **find** | Who holds role X at company Y? Decision makers by default. | `onesource_find` | `onesource find` | 1 per person returned |
| **discover** | Which companies and people match my ICP? Industry, country, size, revenue, keywords and tech stack are hard filters. | `onesource_discover` | `onesource discover` | 1 per account plus 1 per contact |
| **validate** | Is this mailbox deliverable before you send? Up to 1,000 per call. | `onesource_validate` | `onesource validate` | 1 per `valid` / `catch-all` / `risky`. `invalid`, `unknown` and domain-only checks are free |

\* Prices measured on the production backend on 11 Nov 2026. The `cost` block in every answer is authoritative.

<details>
<summary><b>Example: find the buying group</b> (MCP arguments, CLI, SDK, output)</summary>

MCP tool arguments:

```json
{ "account": { "domain": "tallpinesoftware.com" }, "roles": ["Marketing"],
  "seniority": ["VP", "Director"], "limit": 2, "max_credits": 4 }
```

CLI:

```bash
onesource find --domain tallpinesoftware.com --roles Marketing --seniority VP,Director \
  --limit 2 --max-credits 4 --json
```

SDK:

```ts
const found = await os.find({ account: { domain: 'tallpinesoftware.com' },
  roles: ['Marketing'], seniority: ['VP', 'Director'], limit: 2, max_credits: 4 });
```

Output (trimmed):

```json
{
  "account": { "domain": "tallpinesoftware.com", "name": "Tallpine Software" },
  "people": [
    { "name": "Daniel Okoro", "title": "Head of Demand Generation", "seniority": "VP",
      "work_email": "daniel.okoro@tallpinesoftware.com", "match_confidence": 0.91 }
  ],
  "total_found": 7,
  "cost": { "quoted_credits": 4, "charged_credits": 2 },
  "ledger": { "held": 4, "charged": 2, "available_after": 46 },
  "request_id": "6f1c0e2a-...",
  "summary": "1 person at Tallpine Software (7 match in total). Charged 2 credits."
}
```

Emails returned by find are unverified until you validate them.
</details>

Exact arguments for every tool: [skills/onesource/references/tools.md](plugins/onesource/skills/onesource/references/tools.md).

## Claude Code plugin

`plugins/onesource` bundles the MCP server entry, the skills and a few Claude Code extras:

| Component | What it does |
| --- | --- |
| Skill `onesource` | Picks the right verb, shows the exact arguments, applies the credit and B2B-only rules. Falls back to the CLI when the MCP tools are missing. |
| Skill `who-matters` | A playbook: validate, resolve, enrich, find and discover inside a budget agreed up front. |
| Skill `onesource-credits` | Prices, estimating and capping spend, and quoted vs charged credits. |
| Agent `lead-qualification` | Works a list of leads end to end inside a credit budget and returns a clean list grouped by account. |
| Hook (PostToolUse) | Writes one line per OneSource call to `~/.onesource/usage.jsonl`: tool, outcome, request id and credits. Never inputs or results. |
| Command `/onesource-usage` | Shows credits per tool and the last 20 calls from that log. |

For CI and headless runs, the plugin can send an API key instead of using OAuth. See
[API-key mode](docs/agents.md#claude-code). `onesource login --with-api-key` (CLI) writes the same
key file, so one step sets up both.

**Troubleshooting**

- **`onesource` shows "Needs authentication" after you added an API key.** Claude Code remembers
  that a server needed sign-in and skips it for a while. Run `/mcp`, pick `onesource` and choose
  **Reconnect** (or Authenticate). Headless runs (`claude -p`) cannot do this. Start the first run
  in a folder you have trusted, with the key already in `~/.onesource/api-key`.
- **Skill changes don't show up after `claude plugin update`.** Updates are keyed on the version
  in `plugin.json`, so every release must bump it.

## MCP server

| Setting | Value |
| --- | --- |
| Transport | Streamable HTTP |
| URL | `https://mcp-onesource-development.icustomer.ai/mcp` (development) |
| Auth | OAuth 2.1 with PKCE (discovered from the server; your agent opens a browser), or `x-api-key` |
| Tools | `onesource_validate`, `onesource_resolve`, `onesource_enrich`, `onesource_find`, `onesource_discover` |

Generic MCP client config:

```json
{ "mcpServers": { "onesource": { "type": "http", "url": "https://mcp-onesource-development.icustomer.ai/mcp" } } }
```

Per-agent setup for Codex, Hermes, Pi and others: [docs/agents.md](docs/agents.md).

## CLI (preview)

> 🧪 **Preview.** The CLI is not on npm yet. It builds from the OneSource server repo today and
> moves to its own repo before the npm release.

```bash
git clone https://github.com/<github-org>/onesource-mcp-cli && cd onesource-mcp-cli
pnpm install && pnpm build && pnpm link --global      # puts `onesource` on your PATH

onesource login                    # browser sign-in with your iCustomer account
onesource doctor                   # checks server, sign-in, credits and file permissions
```

Built for growth and data engineers. Point it at a CSV, give it a budget, and get rows back:

```bash
onesource resolve  --email maya.chen@tallpinesoftware.com --max-credits 1
onesource validate --file leads.csv --max-credits 500 -o csv > verdicts.csv
onesource enrich   --file leads.csv --required-fields email,job_title --max-credits 300 -o csv > enriched.csv
onesource find     --domain tallpinesoftware.com --roles "VP Marketing" --limit 5 --max-credits 10 -o jsonl
onesource credits                  # balance, holds, recent movements (free)
```

- **Budgets hold for the whole file.** With `--file`, `--max-credits` caps the entire run. Rows go
  in chunks that never exceed what is left; rows not sent come back as `skipped`.
- **Dirty rows don't stop a run.** A row OneSource refuses (personal email, placeholder name) comes
  back as `rejected` at no cost, and the rest still go through. If the service fails part-way,
  everything already paid for is still printed, the rest is marked `not_sent`, and the exit code
  is 1.
- **Machine output everywhere.** `-o csv`, `-o jsonl` or `--json`. CSV cells that would run as
  spreadsheet formulas are neutralised.
- **Safe retries.** `--idempotency-key` makes a re-run return the first answer instead of
  charging again, chunk by chunk.
- **Predictable exits.** `0` ok, `1` API error, `2` bad input (nothing sent), `3` configuration,
  sign-in or connection problem.

## TypeScript SDK (preview)

> 🧪 **Preview.** `@icustomer/onesource` is not on npm yet, so you build it from source.
> Repo: [`<github-org>/onesource-sdk-js`](https://github.com/<github-org>/onesource-sdk-js).

It has no dependencies and uses the global `fetch`, so it runs on Node 18+, Deno, Bun and in
browsers.

```ts
import { OneSource, OneSourceError } from '@icustomer/onesource';

const os = new OneSource({
  apiKey: process.env.ONESOURCE_API_KEY!,
  baseUrl: 'https://mcp-onesource-development.icustomer.ai',
});

const check = await os.validate({ identifiers: { email: 'maya.chen@tallpinesoftware.com' }, max_credits: 1 });
console.log(check.email_validation?.status, check.cost);   // "valid" { quoted_credits: 1, charged_credits: 1 }

try {
  await os.enrich({ contact: { email: 'maya.chen@tallpinesoftware.com' }, required_fields: ['job_title'], max_credits: 2 });
} catch (e) {
  if (e instanceof OneSourceError) console.error(e.code, e.fix);   // e.g. insufficient_credits
}
```

Methods: `validate`, `resolve`, `enrich`, `find`, `discover`, `credits`.

## REST API

```bash
curl -s https://mcp-onesource-development.icustomer.ai/v1/entities/validate \
  -H "x-api-key: $ONESOURCE_API_KEY" -H "content-type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"identifiers":{"email":"maya.chen@tallpinesoftware.com"},"max_credits":1}'
```

| Verb | Route |
| --- | --- |
| validate | `POST /v1/entities/validate` |
| resolve | `POST /v1/entities/resolve` |
| enrich | `POST /v1/entities/enrich` |
| find | `POST /v1/entities/find` |
| discover | `POST /v1/entities/discover` |
| credit balance | `GET /v1/credits` |

`Idempotency-Key` makes a retried request return the first answer instead of charging again.
Reusing a key with a different body returns `409 idempotency_key_reused`.

## Authentication

Every surface accepts both a signed-in iCustomer account and an API key, and both act as the same
OneSource workspace.

| You are | Use | How |
| --- | --- | --- |
| A person in Claude Code or another agent | Browser sign-in (OAuth) | `/mcp` → `onesource` → **Authenticate**. The agent keeps and renews the tokens. |
| A person at a terminal | Browser sign-in (OAuth) | `onesource login`. The session renews itself for 30 days of use. |
| A script, CI job or headless agent | API key | `ONESOURCE_API_KEY`, or `onesource login --with-api-key < key.txt`, which saves it to `~/.onesource/api-key` (0600). |

`~/.onesource/api-key` is shared: the plugin's API-key mode and the CLI both read it, so one
`onesource login --with-api-key` sets up both. `onesource whoami` shows which credential is in use
and never prints it.

Never put an API key in a URL, a prompt, a chat message or a committed file. The skills tell
agents never to ask you for one in chat.

## Credits and guardrails

You pay only for results delivered. Rejected input, misses and errors on our side are free.

- **`max_credits` is a hard budget.** It is required on validate, resolve, enrich and find, and
  also caps the row count on discover. A call that can't fit returns `credit_cap_reached` and
  spends nothing.
- **`limit` caps rows** on find (default 20, max 100) and discover (default 100). The skills always
  set it.
- **Every answer shows both numbers.** `cost.quoted_credits` is the most the call could cost;
  `cost.charged_credits` is what it did cost. `ledger.available_after` is your balance after the
  call.
- **Agents report spend.** The skills make the agent state credits after each call, total them for
  multi-step work, and ask before raising any budget. In Claude Code, `/onesource-usage` shows
  what the session spent.

## Errors

Errors are JSON with a machine-readable code and a fix an agent can act on:

```json
{ "error": "credit_cap_reached", "message": "max_credits 1 cannot pay for any contact...", "fix": "Raise max_credits or request fewer rows or fields." }
```

| Code | HTTP | Meaning |
| --- | --- | --- |
| `invalid_input` | 400 | A field is missing or malformed, or is test data such as `test@` or `example.com` |
| `consumer_data_v2` | 422 | Personal data (free-mail address, phone, device ID). OneSource is B2B only. |
| `credit_cap_reached` | 402 | `max_credits` can't cover the cheapest paid step |
| `insufficient_credits` | 402 | The workspace balance can't cover the call |
| `no_match` / `not_found` | 404 | Nothing found; nothing charged |
| `rate_limited` | 429 | Retry after `Retry-After` |
| `provider_unavailable` | 503 | An upstream source failed; nothing charged |

Full list with what to do: [references/errors.md](plugins/onesource/skills/onesource/references/errors.md).

## Where your data goes

- **B2B only.** OneSource accepts work emails, LinkedIn profile URLs, names with a company, and
  company domains. It refuses personal emails, phone numbers and device IDs.
- **Bad input stops before it costs anything.** Test addresses, placeholder names and disposable
  domains are refused before any lookup runs.
- **Requests go only to the OneSource server you configured.** Results come back into your agent's
  conversation. Handle them under your organisation's data policy.
- **The local usage log holds no personal data:** timestamp, session, tool, outcome, error code,
  request id and credits only. The file is mode `0600`; delete it any time.

## Skills and evals

The skills are plain [Agent Skills](https://code.claude.com/docs/en/skills) and work in any agent
that reads `SKILL.md`:

```
plugins/onesource/skills/
  onesource/            SKILL.md + references/{tools,cli,errors}.md
  who-matters/          SKILL.md
  onesource-credits/    SKILL.md
```

Every skill change is tested with
[`claude plugin eval`](https://code.claude.com/docs/en/plugin-evals). The five tools answer from
synthetic mocks (`plugins/onesource/evals/mocks/`), so evals need no API key, no credits and no
real data.

| Group | Checks |
| --- | --- |
| `triggering/` | The right skill loads for natural requests (email check, buying group, cost question), and no OneSource skill loads for unrelated work |
| `behaviour/` | Batches emails into one validate call; always passes `limit` and `max_credits`; reports cost and unverified emails; says so when results don't match the roles asked for; never sends personal data; stops on `insufficient_credits` without retrying; validates before enriching; shrinks a plan to fit the budget; hands lead lists to the `lead-qualification` agent |

```bash
./test/evals.sh                     # full suite: 3 runs per case, with and without the plugin
EVAL_QUICK=1 ./test/evals.sh        # 1 run per case, no baseline: a quick check
./test/evals.sh --tag triggering    # one group
```

`test/evals.sh` always passes `--no-publish` (reports stay local) and a cost ceiling
(`EVAL_MAX_COST_USD`, default $10).

## Development

```bash
./test/validate.sh   # manifests, JSON, frontmatter, eval-suite structure, secrets scan, unit tests (no network)
./test/evals.sh      # skill evals against mocks (model cost only)

# Against a live server (spends about 1 to 3 credits):
ONESOURCE_MCP_URL=https://<host>/mcp ONESOURCE_API_KEY=... node test/protocol.test.mjs   # MCP + hook, no model
ONESOURCE_MCP_URL=https://<host>/mcp ONESOURCE_API_KEY=... E2E_MODE=helper ./test/e2e.sh # headless Claude Code
```

```
.claude-plugin/marketplace.json          Claude Code marketplace "icustomer-onesource"
plugins/onesource/
  .claude-plugin/plugin.json             plugin manifest
  .mcp.json                              MCP server entry: OAuth, optional API-key headersHelper
  skills/                                portable Agent Skills
  agents/lead-qualification.md           subagent
  commands/onesource-usage.md            slash command
  hooks/                                 PII-free usage log
  scripts/                               headersHelper, usage summary
  evals/                                 skill evals and tool mocks
docs/agents.md                           setup for Codex, Hermes, Pi and other agents
docs/release-notes/                      release notes
test/                                    validate.sh, evals.sh, e2e.sh, protocol test, fixtures
```

## Support and license

Issues and questions: open an issue in this repo, or contact your iCustomer team.
Changes: [CHANGELOG.md](CHANGELOG.md). MIT, copyright iCustomer: [LICENSE](LICENSE).
