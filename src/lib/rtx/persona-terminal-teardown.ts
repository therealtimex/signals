import {
  hasActivePersonaJobsOnRuntimeSession,
  type PersonaJobView,
} from "@/lib/db/queries/persona-jobs";
import type { EnvLike } from "@/lib/rtx/env";
import { postPersonaCompletionThreadMessage } from "@/lib/rtx/persona-completion-thread";
import {
  finalizeChatLinkedTerminalSession,
  formatDeferredTerminalTeardownNote,
  type BrowserSessionTeardownResult,
  type ScheduledTerminalSessionRelease,
} from "@/lib/rtx/resource-teardown";

export type PersonaJobTerminalTeardownResult = {
  terminalSessionTeardown: { scheduled: true; sessionId: string } | { scheduled: false };
  browserSessionTeardown: BrowserSessionTeardownResult;
  completionThreadMessage: { posted: boolean; error?: string };
  skippedSharedSession: boolean;
  message?: string;
};

export async function releasePersonaJobTerminalSession(
  job: PersonaJobView,
  input: {
    status: string;
    summary?: string;
    error?: string;
  },
  env: EnvLike = process.env,
  fetchImpl: typeof fetch = fetch
): Promise<PersonaJobTerminalTeardownResult> {
  const sessionId = job.rtxRuntimeSessionId?.trim() || null;
  const skippedSharedSession =
    !!sessionId && hasActivePersonaJobsOnRuntimeSession(sessionId, job.id);

  if (!sessionId || skippedSharedSession) {
    return {
      terminalSessionTeardown: { scheduled: false },
      browserSessionTeardown: { stopped: [], failed: [] },
      completionThreadMessage: { posted: false },
      skippedSharedSession,
    };
  }

  const [resourceTeardown, completionThreadMessage] = await Promise.all([
    finalizeChatLinkedTerminalSession(
      {
        terminalSessionId: sessionId,
      },
      env,
      fetchImpl
    ),
    postPersonaCompletionThreadMessage(job, input, env, fetchImpl),
  ]);

  const terminalSessionTeardown: ScheduledTerminalSessionRelease =
    resourceTeardown.terminalSessionTeardown;
  const message = formatDeferredTerminalTeardownNote({
    terminal: terminalSessionTeardown,
    browser: resourceTeardown.browserSessionTeardown,
  });

  return {
    terminalSessionTeardown: terminalSessionTeardown.sessionId
      ? { scheduled: true, sessionId: terminalSessionTeardown.sessionId }
      : { scheduled: false },
    browserSessionTeardown: resourceTeardown.browserSessionTeardown,
    completionThreadMessage,
    skippedSharedSession: false,
    ...(message ? { message: message.trim() } : {}),
  };
}
