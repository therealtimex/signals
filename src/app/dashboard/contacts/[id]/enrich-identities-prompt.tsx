"use client";

import { corporateEmailDomain } from "@/lib/contacts/corporate-domain";
import { EnrichContactButton } from "./enrich-contact-button";

interface EnrichIdentitiesPromptProps {
  contactId: string;
  contactName: string;
  /** The contact's primary email; its employer domain sharpens the copy. */
  email: string | null;
  needsWebResearch: boolean;
  profilePipelineTemplateId: string | null;
}

/**
 * Empty Platform identities state for an enrichable contact (#534, AC3). Same
 * button and state machine as the header's Enrich profile, placed where the
 * missing identities are.
 */
export function EnrichIdentitiesPrompt({
  contactId,
  contactName,
  email,
  needsWebResearch,
  profilePipelineTemplateId,
}: EnrichIdentitiesPromptProps) {
  const domain = corporateEmailDomain(email);
  return (
    <div className="flex flex-col items-center gap-2 text-center" data-enrich-identities-prompt>
      <p className="text-sm font-medium">
        {domain
          ? `Enrich public social profiles for ${contactName} at ${domain}?`
          : `Enrich public social profiles for ${contactName}?`}
      </p>
      <p className="text-xs text-muted-foreground">
        Runs Contact Enrich Profile in RealTimeX and links what it finds here.
      </p>
      <EnrichContactButton
        contactId={contactId}
        needsWebResearch={needsWebResearch}
        profilePipelineTemplateId={profilePipelineTemplateId}
        variant="outline"
      />
    </div>
  );
}
