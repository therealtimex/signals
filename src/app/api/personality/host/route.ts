import { NextResponse } from "next/server";
import { probeHostCapabilities } from "@/lib/rtx/capabilities";

export async function GET() {
  return NextResponse.json(await probeHostCapabilities());
}
