import { NextResponse } from "next/server";
import { externalEffectsDenied, getInstanceKind } from "@/lib/instance/instance";
import { resolveInstanceDataDir } from "@/lib/instance/data-dir";
import { ensureRtxBootstrap } from "@/lib/rtx/bootstrap";
import { isRtxEmbedded } from "@/lib/rtx/env";
import { RTX_MANIFEST } from "@/lib/rtx/manifest";
import { isSchedulerEnabled } from "@/lib/scheduler/enabled";
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
    // ADR-541-5: the Dev-app launcher verifies this block before handing the app to an agent.
    instance: {
      kind: getInstanceKind(),
      externalEffects: externalEffectsDenied() ? "denied" : "allowed",
      scheduler: isSchedulerEnabled() ? "enabled" : "disabled",
      dataDir: resolveInstanceDataDir(),
    },
  });
}
