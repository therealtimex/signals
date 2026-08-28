/** RTX termination reasons understood by the desktop runtime resume flow. */
export const RESUMABLE_TERMINAL_RELEASE_REASON = "idle_timeout_resumable";

/** Non-resumable CLI/API terminate (legacy default). */
export const DEFAULT_TERMINAL_RELEASE_REASON = "cli_terminal_session_terminated";

/** Distinct reason for workflow completion (forward-compatible with RTX UI). */
export const WORKFLOW_COMPLETED_TERMINAL_RELEASE_REASON = "workflow_completed_resumable";

/** Extra idle-wait backoff after the standard ~30s sequence for workflow turns. */
export const WORKFLOW_TERMINAL_RELEASE_EXTRA_IDLE_WAIT_MS = [
  15_000,
  30_000,
  60_000,
  90_000,
] as const;

export type TerminalSessionReleaseOptions = {
  reason?: string;
  /** Skip terminal close when the chat-linked turn is still busy after waiting. */
  skipTerminateIfBusy?: boolean;
  /** Additional idle-wait delays (ms) appended after the default sequence. */
  extraIdleWaitDelaysMs?: number[];
};
