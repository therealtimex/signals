import {
  createContentItem,
  getContentItem,
  updateContentItem,
} from "@/lib/db/queries/content";
import { linkMediaToContent } from "@/lib/db/queries/media";
import type { PublishPlatformTarget } from "@/lib/publish/types";

export const EDITABLE_STATUSES = new Set(["draft", "failed"]);

export type SaveComposeDraftInput = {
  body: string;
  platforms: PublishPlatformTarget[];
  draftId?: string;
  mediaAssetIds?: string[];
  title?: string;
};

export type SaveComposeDraftResult =
  | { success: true; contentItemId: string }
  | { success: false; error: string; httpStatus: number };

function platformTargetFromPlatforms(platforms: PublishPlatformTarget[]): string {
  return platforms.join(",");
}

export function saveComposeDraft(input: SaveComposeDraftInput): SaveComposeDraftResult {
  const body = input.body.trim();
  if (!body) {
    return { success: false, error: "Body is required", httpStatus: 400 };
  }
  if (input.platforms.length === 0) {
    return { success: false, error: "At least one platform is required", httpStatus: 400 };
  }

  const platformTarget = platformTargetFromPlatforms(input.platforms);
  const title = input.title?.trim() || body.slice(0, 80) || "Draft";

  let contentItemId: string;

  if (input.draftId) {
    const existing = getContentItem(input.draftId);
    if (!existing) {
      return { success: false, error: "Draft not found", httpStatus: 404 };
    }
    if (!EDITABLE_STATUSES.has(existing.status)) {
      return {
        success: false,
        error: `Cannot edit content in "${existing.status}" status`,
        httpStatus: 400,
      };
    }

    const updated = updateContentItem(input.draftId, {
      body,
      title,
      platformTarget,
      status: "draft",
      platformAccountId: null,
    });
    if (!updated) {
      return { success: false, error: "Failed to update draft", httpStatus: 500 };
    }
    contentItemId = updated.id;
  } else {
    const created = createContentItem({
      body,
      title,
      contentType: "post",
      platformTarget,
      status: "draft",
      origin: "authored",
      direction: "outbound",
      platformAccountId: null,
    });
    contentItemId = created.id;
  }

  for (const assetId of input.mediaAssetIds ?? []) {
    linkMediaToContent(assetId, contentItemId, "api:compose_draft");
  }

  return { success: true, contentItemId };
}
