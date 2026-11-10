# Using OneSource through the CLI

Use the CLI when the OneSource MCP tools are not in your tool list but you can run shell
commands. That covers agents without MCP support, CI jobs and scripts. The CLI calls the same API
as the MCP tools, so inputs, outputs, error codes and credits are identical.

## Check it is there

```bash
onesource --help
```

If the command is missing, tell the user: the CLI is in preview and installs from source (see the
README, "CLI"). Do not install software without the user's yes.

## Authentication

The CLI uses an API key from the environment. It never prompts for one.

- `ICUSTOMER_API_KEY`: the key, sent as `x-api-key`. Required.
- `ICUSTOMER_API_URL`: the server base URL.

In the preview these variables use the `ICUSTOMER_` prefix. They will be renamed to `ONESOURCE_`
before the npm release.

Never ask the user to paste a key into the chat, never put a key on the command line where it is
logged, and never write one into a file in the repository. If the key is missing (exit code 3),
ask the user to set it in their shell.

## Always use `--json`

`--json` prints the raw API answer, with the same fields as the MCP tool result described in
[tools.md](tools.md). Parse that rather than the readable view.

## Command map

| MCP tool | CLI |
| --- | --- |
| `onesource_validate` | `onesource validate --email <e> --max-credits <n> --json` (or `--domain`, `--id`) |
| `onesource_resolve` | `onesource resolve --email <e> \| --linkedin-url <u> \| --name <n> --company-domain <d> --max-credits <n> --json` |
| `onesource_enrich` | `onesource enrich --id <did> --fields title,company --max-credits <n> --json` |
| `onesource_find` | `onesource find --domain <d> --roles "<r>" --seniority <s> --limit <n> --max-credits <n> --json` |
| `onesource_discover` | `onesource discover --industry "<i>" --job-level "<l>" --limit <n> --max-credits <n> --json` |
| (no MCP tool) | `onesource credits --json`: wallet balance, holds and recent movements. Free. |

Shapes without flags go in as a JSON body on stdin with `--input -`:
- validate batches (`emails`)
- enrich by `contact` or `contacts`

Flags override fields in that body.

```bash
echo '{"emails":["jane@acme.com","raj@globex.com"],"max_credits":2}' | onesource validate --input - --json
```

## Retries

Pass `--idempotency-key <unique-key>` on paid calls you might retry. A retried call with the same
key returns the first answer instead of charging again. Use a fresh key for each distinct request.

## Exit codes

| Code | Meaning | What to do |
| --- | --- | --- |
| 0 | OK | Read the JSON |
| 1 | API error | Read `error` and `fix` in the JSON (see [errors.md](errors.md)) |
| 2 | Bad input, refused before sending | Fix the flag the message names |
| 3 | Configuration or connection problem | Usually a missing key or URL; ask the user to set them |
