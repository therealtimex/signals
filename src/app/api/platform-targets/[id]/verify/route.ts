import { NextResponse } from "next/server";
import {
  preparePlatformTarget,
  releasePreparedPlatformTarget,
} from "@/lib/platforms/platform-target-service";
import { platformTargetErrorResult } from "@/lib/platforms/target-errors";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const prepared = await preparePlatformTarget({
      targetId: id,
      intent: "browse",
      holder: `settings:verify:${id}`,
    });
    releasePreparedPlatformTarget(prepared.lease.leaseId);
    return NextResponse.json(prepared);
  } catch (error) {
    const result = platformTargetErrorResult(error);
    return NextResponse.json(result ?? { error: "Failed to verify target" }, { status: 409 });
  }
}
