import { NextResponse } from "next/server";
import { ensureRtxBootstrap } from "@/lib/rtx/bootstrap";
import { RTX_MANIFEST, RTX_SDK_PERMISSIONS } from "@/lib/rtx/manifest";

export async function GET() {
  const bootstrap = await ensureRtxBootstrap();

  return NextResponse.json({
    manifest: RTX_MANIFEST,
    permissions: RTX_SDK_PERMISSIONS,
    bootstrap,
  });
}
