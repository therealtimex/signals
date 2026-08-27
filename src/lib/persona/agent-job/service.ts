import { nanoid } from "nanoid";
import {
  createPersonaJob,
  getActivePersonaJobForContact,
  getPersonaJobById,
  isPersonaJobTerminal,
  markPersonaJobFailed,
  markPersonaJobRunning,
  markPersonaJobSuperseded,
  markPersonaJobTimedOut,
  type PersonaJobView,
} from "@/lib/db/queries/persona-jobs";
import {
  PersonaGenerationUnavailableError,
  PersonaScopeError,
  PersonaSynthesisError,
  type PersonaBackendErrorCode,
} from "@/lib/db/queries/persona-errors";
import { getActivePersona } from "@/lib/db/queries/personas";
import { createWorkflowRun, getWorkflowRun, updateWorkflowRun } from "@/lib/db/queries/workflows";
import type { PreparedPersonaGeneration } from "@/lib/persona/generation/prepare";
import { PERSONA_PROMPT_VERSION } from "@/lib/persona/synthesis";
import {
  PERSONA_AGENT_PROMPT_VERSION,
  buildPersonaAgentJobBrief,
} from "@/lib/persona/agent-job/prompt";
import {
  buildPersonaThreadName,
  createRtxPersonaThread,
  ensureRtxWorkspace,
  getSignalsRtxWorkspaceSlug,
} from "@/lib/rtx/cli-provisioning";
import { isRtxEmbedded, type EnvLike } from "@/lib/rtx/env";
import { resolveSignalsBaseUrlFromEnv } from "@/lib/rtx/resolve-signals-base-url";
import { scheduleTerminalSessionRelease } from "@/lib/rtx/resource-teardown";
import {
  dispatchTerminalAgentViaSendMessage,
  type RuntimeSessionDescriptor,
} from "@/lib/rtx/runtime-sessions";
import {
  buildPersonaJobBriefRoutingMessage,
  personaJobBriefRelativePath,
  writeRtxWorkspaceBriefFile,
} from "@/lib/rtx/workspace-brief-files";
import type {
  GeneratePersonaOptions,
  GeneratePersonaResult,
} from "@/lib/workflows/generate-persona";

export const PERSONA_AGENT_JOB_MAX_ATTEMPTS = 2;
export const DEFAULT_PERSONA_AGENT_JOB_TIMEOUT_MS = 300_000;
export const PERSONA_AGENT_JOB_TIMEOUT_ENV = "PERSONA_AGENT_JOB_TIMEOUT_MS";

type ReadyPersonaGeneration = Extract<PreparedPersonaGeneration, { kind: "ready" }>;

export type StartPersonaAgentJobOptions = GeneratePersonaOptions & {
  signalsBaseUrl?: string;
};

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

export function resolvePersonaAgentJobTimeoutMs(env: EnvLike = process.env): number {
  const parsed = Number.parseInt(env[PERSONA_AGENT_JOB_TIMEOUT_ENV] ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0
    ? parsed
    : DEFAULT_PERSONA_AGENT_JOB_TIMEOUT_MS;
}

function actionableLaunchFailure(errorCode: string, fallback: string): string {
  switch (errorCode) {
    case "terminal_dispatch_required":
      return "No default terminal agent for the Signals workspace. Set one in RealTimeX → workspace settings, or switch persona generation to Structured workflow.";
    case "permission_required":
      return "Grant 'Desktop Runtime Sessions' to Signals in RealTimeX → Settings → Local Apps.";
    case "rtx_unavailable":
      return "RealTimeX desktop isn't running.";
    case "standalone":
      return "Persona generation with a terminal agent requires Signals running as a RealTimeX Local App.";
    default:
      return fallback || "Failed to launch the persona agent.";
  }
}

function backendCodeForLaunch(errorCode: string): PersonaBackendErrorCode {
  switch (errorCode) {
    case "standalone":
      return "RTX_NOT_CONFIGURED";
    case "permission_required":
      return "PERMISSION_REQUIRED";
    case "terminal_dispatch_required":
      return "TERMINAL_DISPATCH_REQUIRED";
    default:
      return "LAUNCH_FAILED";
  }
}

function agentModelFromDescriptor(descriptor: RuntimeSessionDescriptor): string | null {
  const agent = descriptor.metadata?.canonicalAgent?.trim();
  const model = descriptor.resumeContract?.modelSelection?.modelId?.trim();
  if (agent && model) return `${agent}:${model}`;
  return model || agent || null;
}

function completeRunAsFailed(job: PersonaJobView, error: string): void {
  updateWorkflowRun(job.workflowRunId, {
    status: "failed",
    errors: JSON.stringify([error]),
    completedAt: nowSec(),
  });
}

function failLaunchAndThrow(job: PersonaJobView, error: string, errorCode: string): never {
  const actionable = actionableLaunchFailure(errorCode, error);
  const failed = markPersonaJobFailed(job.id, { error: actionable, errorCode }) ?? job;
  completeRunAsFailed(failed, actionable);
  throw new PersonaGenerationUnavailableError(backendCodeForLaunch(errorCode), actionable);
}

export async function startPersonaAgentJob(
  contactId: string,
  prepared: ReadyPersonaGeneration,
  opts: StartPersonaAgentJobOptions = {},
): Promise<PersonaJobView> {
  const existing = getActivePersonaJobForContact(contactId);
  if (existing && !existing.stale) {
    return existing;
  }
  if (existing) {
    const superseded = markPersonaJobSuperseded(existing.id);
    if (superseded?.status === "superseded") {
      completeRunAsFailed(superseded, superseded.error ?? "Superseded by a newer persona job");
      scheduleTerminalSessionRelease(superseded.rtxRuntimeSessionId, opts.env, opts.fetchImpl);
    }
  }

  const jobId = `pa_${nanoid()}`;
  const workflowRun = createWorkflowRun({
    workflowType: "persona",
    status: "running",
    trigger: opts.trigger ?? "user",
    config: JSON.stringify({
      contactId,
      force: opts.force ?? false,
      promptVersion: PERSONA_PROMPT_VERSION,
      backend: "terminal_agent",
      personaJobId: jobId,
    }),
    startedAt: nowSec(),
    parentWorkflowId: opts.parentWorkflowId ?? null,
  });
  const job = createPersonaJob({
    id: jobId,
    contactId,
    trigger: opts.trigger ?? "user",
    force: opts.force ?? false,
    promptVersion: PERSONA_PROMPT_VERSION,
    agentPromptVersion: PERSONA_AGENT_PROMPT_VERSION,
    evidenceHash: prepared.bundle.provenance.evidenceHash,
    provenance: prepared.bundle.provenance,
    supersededPersonaId: prepared.activePersona?.id ?? null,
    workflowRunId: workflowRun.id,
  });

  if (!isRtxEmbedded(opts.env ?? process.env)) {
    failLaunchAndThrow(job, "RealTimeX Local App runtime is unavailable", "standalone");
  }

  const fetchImpl = opts.fetchImpl ?? fetch;
  const env = opts.env ?? process.env;

  try {
    const workspaceSlug = await ensureRtxWorkspace(
      getSignalsRtxWorkspaceSlug(env),
      "Signals",
      env,
      fetchImpl,
    );
    const contactName = prepared.bundle.evidence.contact.name;
    const threadSlug = await createRtxPersonaThread(
      workspaceSlug,
      buildPersonaThreadName(contactName),
      env,
      fetchImpl,
    );
    const brief = buildPersonaAgentJobBrief({
      jobId: job.id,
      contactId,
      baseUrl: opts.signalsBaseUrl ?? resolveSignalsBaseUrlFromEnv(env),
      promptVersion: job.promptVersion,
      agentPromptVersion: job.agentPromptVersion,
      evidence: prepared.bundle.evidence,
    });
    const briefWrite = await writeRtxWorkspaceBriefFile(
      workspaceSlug,
      personaJobBriefRelativePath(job.id),
      brief,
      env,
    );
    if (!briefWrite.success) {
      failLaunchAndThrow(job, briefWrite.error, "launch_failed");
    }

    const launch = await dispatchTerminalAgentViaSendMessage(
      {
        workspaceSlug,
        threadSlug,
        message: buildPersonaJobBriefRoutingMessage({
          jobId: job.id,
          contactId,
          contactName,
          absolutePath: briefWrite.absolutePath,
        }),
        reason: `Generate a persona for contact ${contactId}`,
      },
      env,
      fetchImpl,
    );
    if (!launch.success) {
      failLaunchAndThrow(job, launch.error, launch.errorCode);
    }

    const running = markPersonaJobRunning(job.id, {
      rtxWorkspaceSlug: launch.descriptor.linkage?.workspaceSlug ?? workspaceSlug,
      rtxThreadSlug: launch.descriptor.linkage?.threadSlug ?? threadSlug,
      rtxRuntimeSessionId: launch.descriptor.id,
      agentModel: agentModelFromDescriptor(launch.descriptor),
    });
    if (!running || running.status !== "running") {
      failLaunchAndThrow(job, "Persona job could not enter the running state", "launch_failed");
    }
    return running;
  } catch (error) {
    if (error instanceof PersonaGenerationUnavailableError) throw error;
    failLaunchAndThrow(
      getPersonaJobById(job.id) ?? job,
      error instanceof Error ? error.message : "Failed to launch the persona agent",
      "launch_failed",
    );
  }
}

export async function awaitPersonaJob(
  jobId: string,
  options: { timeoutMs?: number; pollMs?: number } = {},
): Promise<PersonaJobView> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_PERSONA_AGENT_JOB_TIMEOUT_MS;
  const pollMs = Math.max(0, options.pollMs ?? 1_000);
  const deadline = Date.now() + Math.max(0, timeoutMs);

  for (;;) {
    const job = getPersonaJobById(jobId);
    if (!job) {
      throw new Error(`Persona job not found: ${jobId}`);
    }
    if (isPersonaJobTerminal(job.status)) {
      return job;
    }

    if (Date.now() >= deadline) {
      const message = "The agent did not return a persona within 5 minutes. Open the thread to check on it, or retry.";
      const timedOut = markPersonaJobTimedOut(job.id, message) ?? job;
      if (timedOut.status === "timeout") {
        completeRunAsFailed(timedOut, message);
        scheduleTerminalSessionRelease(timedOut.rtxRuntimeSessionId);
      }
      return timedOut;
    }

    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

function mapJobFailure(job: PersonaJobView): Error {
  const message = job.error ?? "Persona agent job failed";
  switch (job.errorCode) {
    case "agent_timeout":
      return new PersonaGenerationUnavailableError("AGENT_TIMEOUT", message);
    case "agent_failed":
      return new PersonaGenerationUnavailableError("AGENT_FAILED", message);
    case "synthesis_invalid":
      return new PersonaSynthesisError(message);
    case "scope_conflict":
      return new PersonaScopeError(message);
    case "standalone":
    case "permission_required":
    case "terminal_dispatch_required":
    case "rtx_unavailable":
    case "launch_failed":
      return new PersonaGenerationUnavailableError(
        backendCodeForLaunch(job.errorCode),
        message,
      );
    default:
      return new PersonaGenerationUnavailableError("AGENT_FAILED", message);
  }
}

export async function runPersonaAgentJobBlocking(
  contactId: string,
  prepared: ReadyPersonaGeneration,
  opts: GeneratePersonaOptions = {},
): Promise<GeneratePersonaResult> {
  const job = await startPersonaAgentJob(contactId, prepared, opts);
  const done = await awaitPersonaJob(job.id, {
    timeoutMs: resolvePersonaAgentJobTimeoutMs(opts.env ?? process.env),
  });

  if (done.status !== "completed") {
    throw mapJobFailure(done);
  }

  const persona = getActivePersona(contactId, { includeLocalOnly: true });
  if (!persona || persona.id !== done.resultPersonaId) {
    throw new Error(`Persona job completed without an active result: ${done.id}`);
  }

  const run = getWorkflowRun(done.workflowRunId);
  let result: Record<string, unknown> = {};
  try {
    result = JSON.parse(run?.result ?? "{}") as Record<string, unknown>;
  } catch {
    result = {};
  }

  return {
    generated: true,
    persona,
    workflowRunId: done.workflowRunId,
    supersededPersonaId: done.supersededPersonaId,
    nicheEdgesUpserted:
      typeof result.nicheEdgesUpserted === "number" ? result.nicheEdgesUpserted : 0,
    embedded: result.embedded === true,
  };
}
