import { getContentItem } from "@/lib/db/queries/content";
import type { PublishJobView } from "@/lib/db/queries/publish-jobs";
import type { PublishJobTarget } from "@/lib/publish/types";
import { appendRtxThreadMessage } from "@/lib/rtx/runtime-sessions";
import type { EnvLike } from "@/lib/rtx/env";

function formatTargetLine(target: PublishJobTarget): string {
  if (target.status === "published") {
    const handle = target.handle?.trim();
    const url = target.platformUrl?.trim();
    const details = [handle, url].filter(Boolean).join(" · ");
    return `- **${target.platform}**: published${details ? ` — ${details}` : ""}`;
  }
  if (target.status === "failed") {
    return `- **${target.platform}**: failed — ${target.error?.trim() || "unknown"}`;
  }
  if (target.status === "skipped") {
    return `- **${target.platform}**: skipped`;
  }
  return `- **${target.platform}**: ${target.status}`;
}

export function formatPublishCompletionThreadMessage(
  job: PublishJobView,
  title?: string | null
): string {
  const lines = [
    "**Publish — Done**",
    "",
    `Job \`${job.id}\`${title?.trim() ? ` · "${title.trim()}"` : ""}`,
    `Status: **${job.status}**`,
    "",
    ...job.targetsParsed.map(formatTargetLine),
  ];
  return lines.join("\n");
}

export async function postPublishCompletionThreadMessage(
  job: PublishJobView,
  env: EnvLike = process.env,
  fetchImpl: typeof fetch = fetch
): Promise<{ posted: boolean; error?: string }> {
  const workspaceSlug = job.rtxWorkspaceSlug?.trim();
  const threadSlug = job.rtxThreadSlug?.trim();
  if (!workspaceSlug || !threadSlug) {
    return { posted: false };
  }

  const item = getContentItem(job.contentItemId);
  const message = formatPublishCompletionThreadMessage(job, item?.title);

  const result = await appendRtxThreadMessage(
    {
      workspaceSlug,
      threadSlug,
      message,
      reason: `Publish job ${job.id} completed`,
    },
    env,
    fetchImpl
  );

  if (!result.success) {
    return { posted: false, error: result.error };
  }

  return { posted: true };
}
