"use client";

import { RtxRuntimeCard } from "@/app/dashboard/settings/rtx-runtime-card";
import { PersonaGenerationModeCard } from "@/app/dashboard/settings/persona-generation-mode-card";
import { EmailVerificationCard } from "@/app/dashboard/settings/email-verification-card";

export function AiAgentsTab() {
  return (
    <div className="space-y-6">
      <RtxRuntimeCard />
      <PersonaGenerationModeCard />
      <EmailVerificationCard />
    </div>
  );
}
