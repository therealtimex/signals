/** Shared teardown copy for workflow and orchestrator agent briefs. */

export const WORKFLOW_TERMINAL_TEARDOWN_AFTER_COMPLETE =
  "Call complete_workflow_run when finished. Signals stops running browser sessions immediately and schedules release of the linked terminal session after the chat-linked turn finishes — do not continue working in this thread after completion.";

export const PUBLISH_TERMINAL_TEARDOWN_AFTER_COMPLETE =
  "When all publish targets are terminal, complete_publish stops browser sessions and schedules release of the linked terminal session after the chat-linked turn finishes — do not continue working in this thread after the job completes.";

export const PERSONA_TERMINAL_TEARDOWN_AFTER_COMPLETE =
  "After complete_persona_job reaches a terminal state, Signals schedules release of the linked terminal session when no other persona jobs are active on it — do not continue working in this thread after submission.";

export const ORCHESTRATOR_TERMINAL_TEARDOWN_AFTER_DISPATCH =
  "After a successful dispatch_follow_on_workflow call, Signals stops browser sessions, posts an orchestrator Done summary, and schedules release of this orchestrator terminal session. If you finish without dispatching, stop browser sessions and terminate this terminal session with realtimex-pp-cli.";

export const MANUAL_TERMINAL_TEARDOWN_INSTRUCTION =
  "When finished without dispatching a follow-on workflow, stop any running browser sessions (`realtimex-pp-cli stop-browser-session <name>` or list via `list-browser-sessions`), then terminate this terminal session with `realtimex-pp-cli terminate-terminal-session <sessionId>` (discover the live session id via `realtimex-pp-cli list-terminal-sessions --agent --json`). Do not use `process.exit(0)` — it does not release the RealTimeX terminal runtime.";
