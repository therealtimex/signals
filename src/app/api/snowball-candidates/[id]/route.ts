import { NextResponse } from "next/server";
import { z } from "zod";
import {
  SnowballCandidateTransitionError,
  updateSnowballCandidateReviewStatus,
} from "@/lib/workflows/snowball-candidates";
import {
  promoteSnowballCandidate,
  SnowballCandidatePromoteError,
} from "@/lib/workflows/snowball-candidate-promote";

const updateSchema = z.discriminatedUnion("action", [
  z.object({ action: z.enum(["dismiss", "reopen"]) }),
  z.object({
    action: z.literal("promote"),
    confirmed: z.literal(true),
    name: z.string().optional(),
    title: z.string().nullable().optional(),
    company: z.string().nullable().optional(),
    profileUrl: z.string().optional(),
  }),
]);

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    const body = updateSchema.parse(await request.json());
    if (body.action === "promote") {
      return NextResponse.json(promoteSnowballCandidate(id, body));
    }
    const candidate = updateSnowballCandidateReviewStatus(
      id,
      body.action === "dismiss" ? "dismissed" : "identity_unverified",
    );
    if (!candidate) {
      return NextResponse.json({ error: "Snowball candidate not found" }, { status: 404 });
    }
    return NextResponse.json(candidate);
  } catch (error) {
    if (error instanceof SnowballCandidatePromoteError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const status = error instanceof SnowballCandidateTransitionError ? 409 : 400;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not update candidate" },
      { status },
    );
  }
}
