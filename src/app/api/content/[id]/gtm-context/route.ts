import { NextRequest, NextResponse } from "next/server";
import { getContentGtmContext } from "@/lib/db/queries/content-gtm-context";
import { notFoundResponse, toErrorResponse } from "@/lib/api/errors";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: contentItemId } = await params;
    const context = getContentGtmContext(contentItemId);
    if (!context) {
      return notFoundResponse("Content item not found");
    }
    return NextResponse.json(context);
  } catch (error) {
    return toErrorResponse(error);
  }
}
