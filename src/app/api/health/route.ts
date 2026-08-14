import { NextResponse } from "next/server";

/** Lightweight boot probe for smoke tests and Local App health checks. */
export async function GET() {
  return NextResponse.json({
    status: "ok",
    app: "signals",
    rtxAppId: process.env.RTX_APP_ID ?? null,
  });
}
