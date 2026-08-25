/** Shared teardown copy for workflow and orchestrator agent briefs. */

export const WORKFLOW_TERMINAL_TEARDOWN_AFTER_COMPLETE =
  "Call complete_workflow_run when finished. Signals automatically stops all running RealTimeX Browser sessions and terminates this workflow's linked terminal session — do not continue working in this thread after completion.";

export const MANUAL_TERMINAL_TEARDOWN_INSTRUCTION =
  "When finished, stop any running browser sessions (`realtimex-pp-cli stop-browser-session <name>` or list via `list-browser-sessions`), then terminate this terminal session with `realtimex-pp-cli terminate-terminal-session <sessionId>` (discover the live session id via `realtimex-pp-cli list-terminal-sessions --agent --json`). Do not use `process.exit(0)` — it does not release the RealTimeX terminal runtime.";
