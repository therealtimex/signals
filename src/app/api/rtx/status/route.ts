import { NextResponse } from "next/server";
import { ensureRtxBootstrap } from "@/lib/rtx/bootstrap";
import { RTX_MANIFEST } from "@/lib/rtx/manifest";
import { resolveRequestedRtxPermissions } from "@/lib/rtx/requested-permissions";

export async function GET() {
  const bootstrap = await ensureRtxBootstrap();

  return NextResponse.json({
    manifest: RTX_MANIFEST,
    permissions: resolveRequestedRtxPermissions(),
    bootstrap,
  });
}
