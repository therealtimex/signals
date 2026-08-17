import { NextResponse } from "next/server";

/** Legacy inline publish path — retired in favor of send-to-agent (issue #118). */
export async function POST() {
  return NextResponse.json(
    {
      success: false,
      error: "Replaced by /api/content/send-to-agent",
      errorCode: "gone",
    },
    { status: 410 }
  );
}
