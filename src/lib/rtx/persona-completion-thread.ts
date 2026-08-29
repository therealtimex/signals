import { getContactById } from "@/lib/db/queries/contacts";
import type { PersonaJobView } from "@/lib/db/queries/persona-jobs";
import { appendRtxThreadMessage } from "@/lib/rtx/runtime-sessions";
import type { EnvLike } from "@/lib/rtx/env";

export function formatPersonaCompletionThreadMessage(
  job: PersonaJobView,
  input: {
    status: string;
    summary?: string;
    error?: string;
  }
): string {
  const contact = getContactById(job.contactId);
  const contactLabel = contact?.name?.trim() || job.contactId;

  const lines = [
    "**Persona synthesis — Done**",
    "",
    `Job \`${job.id}\` · ${contactLabel}`,
    `Status: **${input.status}**`,
  ];

  if (input.summary?.trim()) {
    lines.push("", input.summary.trim());
  } else if (input.error?.trim()) {
    lines.push("", input.error.trim());
  }

  return lines.join("\n");
}

export async function postPersonaCompletionThreadMessage(
  job: PersonaJobView,
  input: {
    status: string;
    summary?: string;
    error?: string;
  },
  env: EnvLike = process.env,
  fetchImpl: typeof fetch = fetch
): Promise<{ posted: boolean; error?: string }> {
  const workspaceSlug = job.rtxWorkspaceSlug?.trim();
  const threadSlug = job.rtxThreadSlug?.trim();
  if (!workspaceSlug || !threadSlug) {
    return { posted: false };
  }

  const message = formatPersonaCompletionThreadMessage(job, input);
  const result = await appendRtxThreadMessage(
    {
      workspaceSlug,
      threadSlug,
      message,
      reason: `Persona job ${job.id} completed`,
    },
    env,
    fetchImpl
  );

  if (!result.success) {
    return { posted: false, error: result.error };
  }

  return { posted: true };
}
