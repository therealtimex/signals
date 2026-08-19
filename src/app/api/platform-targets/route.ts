import { NextResponse } from "next/server";
import {
  listBrowserConnections,
  listPlatformTargets,
  toPlatformTargetView,
} from "@/lib/db/queries/platform-targets";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const platform = url.searchParams.get("platform");
  const kind = url.searchParams.get("kind");
  const connectionId = url.searchParams.get("connectionId") ?? undefined;
  const validPlatform =
    platform === "x" || platform === "linkedin" || platform === "facebook"
      ? platform
      : undefined;
  const validKind =
    kind === "account" || kind === "profile" || kind === "page" || kind === "organization"
      ? kind
      : undefined;

  return NextResponse.json({
    targets: listPlatformTargets({
      platform: validPlatform,
      kind: validKind,
      connectionId,
      includeForgotten: url.searchParams.get("includeForgotten") === "true",
    }).map(toPlatformTargetView),
    connections: listBrowserConnections(),
  });
}
