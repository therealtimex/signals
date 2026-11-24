/**
 * What the workflow watchdogs write onto a run they fail, and how a late completion takes it back.
 *
 * Kept free of DB and RTX imports so the `complete_workflow_run` handler can use it without pulling
 * in the dispatch path.
 */

export const DISPATCH_LOST_ERROR_CODE = "dispatch_lost";

export const DISPATCH_LOST_SUMMARY =
  "dispatch_lost: the research agent never reported back and its terminal is not working on this run. Signals failed the run so the contact can be researched again.";

export const TERMINAL_RUN_TIMEOUT_SUMMARY =
  "Workflow timed out waiting for complete_workflow_run. Signals released the linked terminal session.";

/**
 * Audit record of a watchdog release that a later `complete_workflow_run` overruled. Nothing reads
 * this key as a failure: not the research state, not the shared-thread liveness check.
 */
export const WATCHDOG_RELEASE_OVERRULED_RESULT_KEY = "watchdogReleaseOverruled";

const WATCHDOG_SUMMARIES = new Set([DISPATCH_LOST_SUMMARY, TERMINAL_RUN_TIMEOUT_SUMMARY]);

function isWatchdogReleased(result: Record<string, unknown>): boolean {
  return (
    result.errorCode === DISPATCH_LOST_ERROR_CODE ||
    result.dispatchLost === true ||
    result.timedOut === true
  );
}

/**
 * Drop the failure markers a watchdog wrote, when the run's agent reports back after all (#572).
 *
 * The agent's completion proves the dispatch was not lost, so `errorCode: "dispatch_lost"`,
 * `dispatchLost`, `timedOut`, the heartbeat fields and the watchdog's own summary/message must not
 * survive it: the shared-thread liveness check would replace a healthy thread, and the research
 * state would show the lost-dispatch text on a completed run. What happened is kept for audit
 * under {@link WATCHDOG_RELEASE_OVERRULED_RESULT_KEY}.
 */
export function clearWatchdogFailureMarkers(
  result: Record<string, unknown>,
  overruledAt: number,
): Record<string, unknown> {
  if (!isWatchdogReleased(result)) return result;
  const {
    errorCode,
    dispatchLost: _dispatchLost,
    timedOut: _timedOut,
    lastHeartbeatAt,
    livenessTimeoutMs,
    summary,
    message,
    ...rest
  } = result;
  return {
    ...rest,
    ...(typeof summary === "string" && !WATCHDOG_SUMMARIES.has(summary) ? { summary } : {}),
    ...(typeof message === "string" && !WATCHDOG_SUMMARIES.has(message) ? { message } : {}),
    ...(errorCode !== undefined && errorCode !== DISPATCH_LOST_ERROR_CODE ? { errorCode } : {}),
    [WATCHDOG_RELEASE_OVERRULED_RESULT_KEY]: {
      code:
        errorCode === DISPATCH_LOST_ERROR_CODE || result.dispatchLost === true
          ? DISPATCH_LOST_ERROR_CODE
          : "terminal_run_timeout",
      ...(typeof lastHeartbeatAt === "number" ? { lastHeartbeatAt } : {}),
      ...(typeof livenessTimeoutMs === "number" ? { livenessTimeoutMs } : {}),
      overruledAt,
    },
  };
}

/** Drop the watchdog's own entries from a run's error list once its agent has reported back. */
export function withoutWatchdogErrors(errors: string[]): string[] {
  return errors.filter((error) => !WATCHDOG_SUMMARIES.has(error));
}
