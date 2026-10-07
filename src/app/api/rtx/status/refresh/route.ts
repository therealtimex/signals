import { NextResponse } from "next/server";
import { bootstrapRtxIfEmbedded, resetRtxBootstrapState } from "@/lib/rtx/bootstrap";
import { RTX_MANIFEST } from "@/lib/rtx/manifest";
import { resolveRequestedRtxPermissions } from "@/lib/rtx/requested-permissions";

export async function POST() {
  resetRtxBootstrapState();
  const bootstrap = await bootstrapRtxIfEmbedded();

  return NextResponse.json({
    manifest: RTX_MANIFEST,
    permissions: resolveRequestedRtxPermissions(),
    bootstrap,
  });
}
