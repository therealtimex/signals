import { NextResponse } from "next/server";
import { bootstrapRtxIfEmbedded, resetRtxBootstrapState } from "@/lib/rtx/bootstrap";
import { RTX_MANIFEST, RTX_SDK_PERMISSIONS } from "@/lib/rtx/manifest";

export async function POST() {
  resetRtxBootstrapState();
  const bootstrap = await bootstrapRtxIfEmbedded();

  return NextResponse.json({
    manifest: RTX_MANIFEST,
    permissions: RTX_SDK_PERMISSIONS,
    bootstrap,
  });
}
