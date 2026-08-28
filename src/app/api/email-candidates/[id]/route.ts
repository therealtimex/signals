import { NextResponse } from "next/server";
import { z } from "zod";
import { updateEmailCandidate } from "@/lib/contacts/email-verification/candidates";

const schema = z.object({
  action: z.enum(["verify", "invalidate", "mark_uncertain", "correct", "probe"]),
  address: z.string().email().optional(),
  evidenceUrl: z.string().url().optional(),
  note: z.string().max(2_000).optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const candidate = updateEmailCandidate(id, schema.parse(await req.json()));
    if (!candidate) return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
    return NextResponse.json(candidate);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not update candidate" },
      { status: 400 },
    );
  }
}
