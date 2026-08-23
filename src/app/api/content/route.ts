import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { listContentItems, createContentItem } from "@/lib/db/queries/content";

const createContentSchema = z.object({
  title: z.string().optional(),
  body: z.string().optional(),
  contentType: z.enum(["post", "article", "thread", "reply", "image", "video", "email", "dm", "newsletter"]),
  platformTarget: z.string().optional(),
  status: z.enum(["draft", "review", "approved", "scheduled", "published", "imported"]).optional(),
  origin: z.enum(["authored", "received", "imported"]).optional(),
  direction: z.enum(["inbound", "outbound"]).optional(),
  platformAccountId: z.string().optional(),
  contactId: z.string().optional(),
  threadId: z.string().optional(),
  parentItemId: z.string().optional(),
  platformData: z.string().optional(),
  platformUrl: z.string().optional(),
  url: z.string().optional(),
  platformPostId: z.string().optional(),
});

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const contentType = searchParams.get("type") ?? undefined;
  const origin = searchParams.get("origin") ?? undefined;
  const platform = searchParams.get("platform") ?? undefined;
  const status = searchParams.get("status") ?? undefined;
  const platformAccountId = searchParams.get("platformAccountId") ?? undefined;
  const threadId = searchParams.get("threadId") ?? undefined;
  const page = parseInt(searchParams.get("page") ?? "1", 10) || 1;
  const pageSize = parseInt(searchParams.get("pageSize") ?? "25", 10) || 25;

  const result = listContentItems({ contentType, origin, platform, status, platformAccountId, threadId, page, pageSize });
  return NextResponse.json({ items: result.data, total: result.total });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const data = createContentSchema.parse(body);

    const postUrl = data.platformUrl || data.url;
    let mergedPlatformData = data.platformData;
    if (postUrl || data.platformPostId) {
      try {
        const parsed = data.platformData ? JSON.parse(data.platformData) : {};
        if (postUrl) parsed.platformUrl = postUrl;
        if (data.platformPostId) parsed.platformPostId = data.platformPostId;
        mergedPlatformData = JSON.stringify(parsed);
      } catch {
        mergedPlatformData = JSON.stringify({
          ...(postUrl ? { platformUrl: postUrl } : {}),
          ...(data.platformPostId ? { platformPostId: data.platformPostId } : {}),
        });
      }
    }

    const { platformUrl: _pUrl, url: _url, platformPostId: _pId, ...contentItemData } = data;
    contentItemData.platformData = mergedPlatformData;

    let postData = undefined;
    if (data.platformAccountId) {
      postData = {
        platformAccountId: data.platformAccountId,
        platformUrl: postUrl ?? null,
        platformPostId: data.platformPostId ?? null,
        publishedAt: data.status === "published" ? Math.floor(Date.now() / 1000) : null,
        status: data.status === "published" ? ("published" as const) : ("scheduled" as const),
      };
    }

    const item = createContentItem(contentItemData, postData);
    return NextResponse.json(item, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors }, { status: 400 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
