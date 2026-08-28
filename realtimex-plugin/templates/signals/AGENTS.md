# Signals workspace

This workspace is provisioned by the **Signals** RealtimeX plugin (`com.realtimex.signals`).

## Operating model

- **Signals Local App** holds CRM graph data, dashboard UI, and the stable `/api/agent-tools` API.
- **Terminal agents** in this workspace perform open-ended CRM work via workspace skills:
  - `realtimex-signals` — query and mutate contacts, goals, tasks, workflows, analytics
  - `signals-publish` — publish jobs through RealTimeX Browser + `complete_publish`
- **Agent Flows** (import from plugin `flows/`): deterministic create/enrich pipelines and CRM agent tasks.

## Session checklist

1. Confirm Signals Local App is **running** (embedded in RealTimeX or standalone dev).
2. Load the `realtimex-signals` skill, run `.claude/skills/realtimex-signals/scripts/run-signals-pp-cli.sh health`, and call CRM tools through the health-pinned CLI (`npx @realtimex/signals-pp-cli@<cliVersion>`). Use skill-bundled shell helpers only when the CLI does not cover the operation or is unavailable.
3. For enrichment or publish, use **agent-browser** / RealTimeX Browser — then write results back via agent-tools.
4. Do not use deprecated in-app chat (`/api/chat`); intelligence stays in the terminal agent.
5. **Resource Teardown Protocol:** Workflow agents — call `complete_workflow_run` when finished (Signals stops browser sessions immediately and schedules terminal session release after the chat-linked turn finishes). Publish agents — call `complete_publish` for each platform; Signals uses the same deferred terminal release when the job finishes. Orchestrator/handoff agents — after a successful `dispatch_follow_on_workflow`, Signals schedules orchestrator terminal release automatically; otherwise stop browser sessions and `realtimex-pp-cli terminate-terminal-session <sessionId>` manually. Do not use `process.exit(0)`; it does not release the RTX terminal runtime.

## Data and privacy

- User graph data lives under `SIGNALS_DATA_DIR` (default `~/.signals/`).
- Private relationship notes stay local; do not export to external simulations without explicit permission.

## References

- Signals agent-tools: `docs/agent-tools.md` (in the Signals app repo)
- Plugin packaging: `docs/realtimex-marketplace-plugin.md`
