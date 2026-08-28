import { NextResponse } from "next/server";
import { z } from "zod";
import {
  resolveEmailVerificationSettings,
  updateEmailVerificationSettings,
} from "@/lib/settings/email-verification-settings";

const schema = z.object({
  smtpProbeEnabled: z.boolean().optional(),
  allowPredictedInAutomation: z.boolean().optional(),
});

export async function GET() {
  return NextResponse.json(resolveEmailVerificationSettings());
}

export async function PUT(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const current = resolveEmailVerificationSettings();
  if (
    (parsed.data.smtpProbeEnabled !== undefined && current.smtpProbeEnabled.envLocked) ||
    (parsed.data.allowPredictedInAutomation !== undefined && current.allowPredictedInAutomation.envLocked)
  ) {
    return NextResponse.json(
      { error: "One or more email verification settings are locked by the environment.", code: "ENV_LOCKED" },
      { status: 409 },
    );
  }
  return NextResponse.json(updateEmailVerificationSettings(parsed.data));
}
