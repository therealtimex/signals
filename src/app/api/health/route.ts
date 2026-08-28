import { NextResponse } from "next/server";
import { ensureRtxBootstrap } from "@/lib/rtx/bootstrap";
import { isRtxEmbedded } from "@/lib/rtx/env";
import { RTX_MANIFEST } from "@/lib/rtx/manifest";
import { signalsPpCliHealthFields } from "@/lib/signals-pp-cli/metadata";

/** Lightweight boot probe for smoke tests and Local App health checks. */
export async function GET() {
  const rtx = await ensureRtxBootstrap();

  return NextResponse.json({
    status: "ok",
    app: "signals",
    ...signalsPpCliHealthFields(),
    rtx: {
      mode: isRtxEmbedded() ? "embedded" : "standalone",
      appId: process.env.RTX_APP_ID ?? null,
      registered: rtx.registered,
      pingOk: rtx.pingOk,
      manifest: RTX_MANIFEST.id,
    },
  });
}
