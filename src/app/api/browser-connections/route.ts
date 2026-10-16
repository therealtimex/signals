import { NextResponse } from "next/server";
import { listBrowserConnections } from "@/lib/db/queries/platform-targets";

/** GET /api/browser-connections — active browser connections, for the allowed-websites selector. */
export async function GET() {
  return NextResponse.json({ connections: listBrowserConnections() });
}
