import { eq } from "drizzle-orm";
import { projectContactToArpp } from "@/lib/arpp/project-contact";
import { projectOrgToAroo } from "@/lib/arpp/project-org";
import type {
  ArooOrganizationDocument,
  ArooProjectionOptions,
  ArppPersonDocument,
  ArppProjectionOptions,
} from "@/lib/arpp/types";
import { db } from "@/lib/db/client";
import { getContactById } from "@/lib/db/queries/contacts";
import { listOrgIdentitiesByOrg } from "@/lib/db/queries/org-identities";
import { getOrgById } from "@/lib/db/queries/orgs";
import { orgDomains } from "@/lib/db/schema";

export function loadAndProjectContactToArpp(
  contactId: string,
  opts?: ArppProjectionOptions,
): ArppPersonDocument | undefined {
  const contact = getContactById(contactId);
  if (!contact) return undefined;

  const orgsById = new Map(
    contact.employments.flatMap((employment) => {
      const org = getOrgById(employment.orgId);
      return org ? [[org.id, org] as const] : [];
    }),
  );

  return projectContactToArpp({ contact, orgsById }, opts);
}

export function loadAndProjectOrgToAroo(
  orgId: string,
  opts?: ArooProjectionOptions,
): ArooOrganizationDocument | undefined {
  const org = getOrgById(orgId);
  if (!org) return undefined;

  const domains = db
    .select()
    .from(orgDomains)
    .where(eq(orgDomains.orgId, orgId))
    .all()
    .map((domain) => ({
      domain: domain.domain,
      kind: domain.kind,
      verified: domain.mxStatus === "ok",
    }));

  return projectOrgToAroo(
    {
      org,
      domains: domains.length > 0 ? domains : undefined,
      identities: listOrgIdentitiesByOrg(orgId),
    },
    opts,
  );
}
