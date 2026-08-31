import { NextResponse } from "next/server";
import { personalityErrorResponse } from "@/app/api/personality/http";
import { retryPersonalityProjection } from "@/lib/personality/use-cases";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    return NextResponse.json(await retryPersonalityProjection((await params).id));
  } catch (error) {
    return personalityErrorResponse(error);
  }
}
