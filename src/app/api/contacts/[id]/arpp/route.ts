import { NextRequest, NextResponse } from "next/server";
import { loadAndProjectContactToArpp } from "@/lib/arpp/load";
import { linkedDataResponse, readArppVisibility } from "@/lib/arpp/response";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const parsed = readArppVisibility(request);
  if ("response" in parsed) return parsed.response;

  const { id } = await params;
  const document = loadAndProjectContactToArpp(id, { visibility: parsed.visibility });
  if (!document) {
    return NextResponse.json({ error: "Contact not found" }, { status: 404 });
  }

  return linkedDataResponse(request, document);
}
