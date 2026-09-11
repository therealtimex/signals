import { reconcileWorkflowTerminalCleanups } from "@/lib/rtx/workflow-terminal-reconciler";

export const WORKFLOW_TERMINAL_CLEANUP_INTERVAL_MS = 60_000;

type CleanupReconcilePass = () => Promise<unknown>;

let initialized = false;
let intervalId: ReturnType<typeof setInterval> | null = null;
let activePass: Promise<void> | null = null;
let startupPass: Promise<void> | null = null;

function runCleanupPass(reconcile: CleanupReconcilePass): Promise<void> {
  if (activePass) return activePass;

  const pass = Promise.resolve()
    .then(reconcile)
    .then(() => undefined)
    .catch((error) => {
      console.warn(
        "[workflow-terminal-cleanup] Reconciliation failed:",
        error,
      );
    })
    .finally(() => {
      if (activePass === pass) activePass = null;
    });
  activePass = pass;
  return pass;
}

/**
 * Start terminal cleanup recovery independently of optional workflow scheduling.
 *
 * The standalone Local App intentionally disables scheduled workflow execution,
 * but durable terminal cleanup must still replay on boot and after backoff.
 */
export function initWorkflowTerminalCleanupReconciler(
  options: { reconcile?: CleanupReconcilePass } = {},
): Promise<void> {
  if (initialized) return startupPass ?? activePass ?? Promise.resolve();
  initialized = true;

  const reconcile =
    options.reconcile ?? (() => reconcileWorkflowTerminalCleanups());
  intervalId = setInterval(() => {
    void runCleanupPass(reconcile);
  }, WORKFLOW_TERMINAL_CLEANUP_INTERVAL_MS);
  if (intervalId && typeof intervalId === "object" && "unref" in intervalId) {
    intervalId.unref();
  }

  startupPass = runCleanupPass(reconcile);
  return startupPass;
}

/** Stop the always-on cleanup driver for tests and process cleanup. */
export function stopWorkflowTerminalCleanupReconciler(): void {
  if (intervalId) clearInterval(intervalId);
  intervalId = null;
  initialized = false;
  startupPass = null;
  activePass = null;
}
