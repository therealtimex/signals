import { NextResponse } from "next/server";
import { personalityErrorResponse } from "@/app/api/personality/http";
import { getPersonalityBindingView } from "@/lib/personality/status";

export async function GET() {
  try {
    return NextResponse.json(await getPersonalityBindingView());
  } catch (error) {
    return personalityErrorResponse(error);
  }
}
