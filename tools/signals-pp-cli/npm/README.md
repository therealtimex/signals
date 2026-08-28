# @realtimex/signals-pp-cli

Signals Printing Press CLI for terminal agents. Installs the platform-native `signals-pp-cli` binary via optional npm platform packages.

## Usage

Pin the CLI version to the running Signals Local App:

```bash
export SIGNALS_BASE_URL="http://127.0.0.1:3010"
CLI_VERSION="$(curl -sf "$SIGNALS_BASE_URL/api/health" | jq -r .cliVersion)"
npx --yes @realtimex/signals-pp-cli@"$CLI_VERSION" health
npx --yes @realtimex/signals-pp-cli@"$CLI_VERSION" import contacts --file workflow-runs/<runId>/contacts.csv --dedupe --workflow-run-id <runId> --template-id <templateId>
```

Or use the workspace skill bootstrap script:

```bash
.claude/skills/realtimex-signals/scripts/run-signals-pp-cli.sh health
```

Do not rely on a stale global `signals-pp-cli` on `PATH` without checking `cliVersion` from `/api/health`.
