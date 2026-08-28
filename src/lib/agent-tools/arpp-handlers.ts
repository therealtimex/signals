import type { z } from "zod";
import { getOrgArooSchema } from "@/lib/agent-tools/graph-schemas";
import { getContactArppSchema } from "@/lib/agent-tools/schemas";
import { AgentToolError } from "@/lib/agent-tools/types";
import {
  loadAndProjectContactToArpp,
  loadAndProjectOrgToAroo,
} from "@/lib/arpp/load";

export async function handleGetContactArpp(
  input: z.infer<typeof getContactArppSchema>,
) {
  const document = loadAndProjectContactToArpp(input.contactId, {
    visibility: input.visibility ?? "internal",
  });
  if (!document) throw new AgentToolError("NOT_FOUND", "Contact not found");
  return document;
}

export async function handleGetOrgAroo(input: z.infer<typeof getOrgArooSchema>) {
  const document = loadAndProjectOrgToAroo(input.orgId, {
    visibility: input.visibility ?? "internal",
  });
  if (!document) throw new AgentToolError("NOT_FOUND", "Company not found");
  return document;
}
