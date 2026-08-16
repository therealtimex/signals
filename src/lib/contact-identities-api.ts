import { z } from "zod";
import { PLATFORM_ENUM } from "@/lib/db/platforms";
import { createIdentity } from "@/lib/db/queries/identities";
import { recalcEnrichment } from "@/lib/db/queries/contacts";

export const contactIdentityInputSchema = z.object({
  platform: z.enum(PLATFORM_ENUM),
  platformUserId: z.string().min(1),
  platformHandle: z.string().optional(),
  platformUrl: z.string().optional(),
  isPrimary: z.boolean().optional(),
});

export type ContactIdentityInput = z.infer<typeof contactIdentityInputSchema>;

export function createContactIdentities(
  contactId: string,
  identities: ContactIdentityInput[],
): void {
  const valid = identities.filter((item) => item.platformUserId.trim().length > 0);
  if (valid.length === 0) return;

  const explicitPrimary = valid.findIndex((item) => item.isPrimary);
  const primaryIndex = explicitPrimary >= 0 ? explicitPrimary : 0;

  for (let index = 0; index < valid.length; index++) {
    const item = valid[index]!;
    createIdentity({
      contactId,
      platform: item.platform,
      platformUserId: item.platformUserId.trim(),
      platformHandle: item.platformHandle,
      platformUrl: item.platformUrl,
      isPrimary: index === primaryIndex ? 1 : 0,
    });
  }

  recalcEnrichment(contactId);
}
