import { NextResponse } from "next/server";
import { z } from "zod";
import {
  SnowballCandidateTransitionError,
  updateSnowballCandidateReviewStatus,
} from "@/lib/workflows/snowball-candidates";

const updateSchema = z.object({
  action: z.enum(["dismiss", "reopen"]),
});

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    const { action } = updateSchema.parse(await request.json());
    const candidate = updateSnowballCandidateReviewStatus(
      id,
      action === "dismiss" ? "dismissed" : "identity_unverified",
    );
    if (!candidate) {
      return NextResponse.json({ error: "Snowball candidate not found" }, { status: 404 });
    }
    return NextResponse.json(candidate);
  } catch (error) {
    const status = error instanceof SnowballCandidateTransitionError ? 409 : 400;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not update candidate" },
      { status },
    );
  }
}
