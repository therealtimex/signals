import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { toErrorResponse } from "@/lib/api/errors";
import {
  EXPLORE_MAP_MAX_LIMIT,
  getExploreMap,
} from "@/lib/db/queries/explore-map";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(EXPLORE_MAP_MAX_LIMIT).optional(),
});

export async function GET(req: NextRequest) {
  try {
    const params = Object.fromEntries(req.nextUrl.searchParams.entries());
    const { limit } = querySchema.parse(params);
    return NextResponse.json(getExploreMap({ limit }));
  } catch (error) {
    return toErrorResponse(error);
  }
}
