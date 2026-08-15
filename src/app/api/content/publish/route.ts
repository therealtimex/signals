import { NextResponse } from "next/server";
import { z } from "zod";
import { getContentItem, updateContentItem, createContentPost } from "@/lib/db/queries/content";
import { publishVariantForContentItem } from "@/lib/db/queries/variants";
import { getPlatformAccountByPlatform } from "@/lib/db/queries/platform-accounts";
import { publishToX } from "@/lib/browser/publishers/x-publisher";
import { publishToLinkedIn } from "@/lib/browser/publishers/linkedin-publisher";
import type { PublishRequest } from "@/lib/browser/publishers/types";

const publishSchema = z.object({
  contentItemId: z.string(),
  platform: z.enum(["x", "linkedin"]),
  mode: z.enum(["auto", "review"]).default("auto"),
  text: z.string().min(1),
  mediaAssetIds: z.array(z.string()).optional(),
  threadTexts: z.array(z.string()).optional(),
  threadMediaIds: z.array(z.array(z.string())).optional(),
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = publishSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { contentItemId, platform, mode, text, mediaAssetIds, threadTexts, threadMediaIds } =
      parsed.data;

    // Verify content item exists and is in a publishable state
    const contentItem = getContentItem(contentItemId);
    if (!contentItem) {
      return NextResponse.json({ error: "Content item not found" }, { status: 404 });
    }

    if (contentItem.status !== "draft" && contentItem.status !== "approved") {
      return NextResponse.json(
        { error: `Cannot publish content in "${contentItem.status}" status. Must be "draft" or "approved".` },
        { status: 400 }
      );
    }

    // Get platform account
    const account = getPlatformAccountByPlatform(platform);
    if (!account) {
      return NextResponse.json(
        { error: `No ${platform} account connected. Connect one in Settings.` },
        { status: 400 }
      );
    }

    // Set intermediate "review" status while publishing
    updateContentItem(contentItemId, { status: "review" });

    // Build publish request
    const publishRequest: PublishRequest = {
      platform,
      mode,
      text,
      mediaAssetIds,
      threadTexts,
      threadMediaIds,
      contentItemId,
    };

    // Route to the correct publisher
    const result =
      platform === "x"
        ? await publishToX(publishRequest)
        : await publishToLinkedIn(publishRequest);

    if (result.success) {
      // Update content item to published
      updateContentItem(contentItemId, { status: "published" });

      // Create the content post record
      createContentPost({
        contentItemId,
        platformAccountId: account.id,
        platformPostId: result.platformPostId ?? null,
        platformUrl: result.platformUrl ?? null,
        publishedAt: Math.floor(Date.now() / 1000),
        status: "published",
      });

      publishVariantForContentItem(contentItemId, {
        platform,
        publishedAt: Math.floor(Date.now() / 1000),
      });

      return NextResponse.json({
        success: true,
        platformUrl: result.platformUrl,
        platformPostId: result.platformPostId,
      });
    } else {
      // Revert content item to draft
      updateContentItem(contentItemId, { status: "draft" });

      return NextResponse.json(
        {
          success: false,
          error: result.error ?? "Publish failed",
          errorCode: result.errorCode,
        },
        { status: 500 }
      );
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
