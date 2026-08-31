import { NextResponse } from "next/server";
import { personalityErrorResponse } from "@/app/api/personality/http";
import { proposePersonalityUnbind } from "@/lib/personality/proposal";

export async function POST() {
  try {
    return NextResponse.json(await proposePersonalityUnbind({ kind: "ui" }), { status: 201 });
  } catch (error) {
    return personalityErrorResponse(error);
  }
}
