import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { nanoid } from "nanoid";
import { db } from "@/lib/db/client";
import { contactEmailCandidates } from "@/lib/db/schema";
import { createContact } from "@/lib/db/queries/contacts";
import { createOrg } from "@/lib/db/queries/orgs";
import { resetCoreTables } from "@/test/db";
import { GET } from "./route";
import { PATCH } from "../../../email-candidates/[id]/route";
import { handleListEmailCandidates, handleUpdateEmailCandidate } from "@/lib/agent-tools/graph-handlers";

function candidate(address = "person@surface.example") {
  const org = createOrg({ name: "Surface Co", domain: "surface.example" });
  const contact = createContact({ name: "Surface Person" });
  const id = nanoid();
  db.insert(contactEmailCandidates).values({
    id, contactId: contact.id, orgId: org.id, address, addressNormalized: address,
    status: "predicted", confidence: "high", source: "test",
  }).run();
  return { id, org, contact };
}

describe("email candidate REST and agent-tool surfaces", () => {
  beforeEach(() => {
    resetCoreTables();
    vi.stubEnv("SIGNALS_ALLOW_PREDICTED_EMAIL_AUTOMATION", "1");
    vi.stubEnv("SIGNALS_EMAIL_SMTP_PROBE_ENABLED", "0");
  });

  it("returns the same per-operation eligibility decision from REST and tools", async () => {
    const { org } = candidate();
    const restDefault = await GET(new NextRequest(`http://localhost/api/orgs/${org.id}/email-candidates`), { params: Promise.resolve({ id: org.id }) });
    expect((await restDefault.json()).data[0]).toMatchObject({ sendable: false, reason: "predicted_email_not_requested" });
    const restOptIn = await GET(new NextRequest(`http://localhost/api/orgs/${org.id}/email-candidates?includePredicted=true`), { params: Promise.resolve({ id: org.id }) });
    expect((await restOptIn.json()).data[0]).toMatchObject({ sendable: true });
    expect((await handleListEmailCandidates({ orgId: org.id, includePredicted: true })).data[0]).toMatchObject({ sendable: true });
  });

  it("awaits probe orchestration in both REST and tool update paths", async () => {
    const first = candidate();
    const rest = await PATCH(new NextRequest(`http://localhost/api/email-candidates/${first.id}`, {
      method: "PATCH", body: JSON.stringify({ action: "probe" }),
    }), { params: Promise.resolve({ id: first.id }) });
    expect(await rest.json()).toMatchObject({ status: "uncertain", probeAttempts: 1 });

    const secondContact = createContact({ name: "Second Person" });
    const secondId = nanoid();
    db.insert(contactEmailCandidates).values({
      id: secondId, contactId: secondContact.id, orgId: first.org.id,
      address: "second@surface.example", addressNormalized: "second@surface.example",
      status: "predicted", confidence: "high", source: "test",
    }).run();
    expect(await handleUpdateEmailCandidate({ candidateId: secondId, action: "probe" })).toMatchObject({
      status: "uncertain", probeAttempts: 1,
    });
  });
});
