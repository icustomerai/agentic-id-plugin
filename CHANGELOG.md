# Changelog

All notable changes to this marketplace and the `onesource` plugin. Versions follow
[Semantic Versioning](https://semver.org/).

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
