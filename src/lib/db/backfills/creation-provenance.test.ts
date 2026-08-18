import { beforeEach, describe, expect, it } from "vitest";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import { createContact } from "@/lib/db/queries/contacts";
import { createOrg } from "@/lib/db/queries/orgs";
import { createIdentity } from "@/lib/db/queries/identities";
import { createWorkflowRun } from "@/lib/db/queries/workflows";
import { backfillCreationProvenance } from "@/lib/db/backfills/creation-provenance";
import { db } from "@/lib/db/client";
import {
  contactChannels,
  contactEmployments,
  contactIdentities,
  contacts,
  graphEdges,
  orgs,
  workflowSteps,
} from "@/lib/db/schema";
import { resetCoreTables } from "@/test/db";

describe("creation provenance backfill", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("C1 recovers agent provenance from contact_create workflow steps", () => {
    const run = createWorkflowRun({
      workflowType: "agent",
      status: "completed",
      templateId: null,
      startedAt: 1_700_000_000,
      completedAt: 1_700_000_100,
    });
    const contact = createContact({ name: "Agent Stub" });
    db.update(contacts).set({ createdSource: null, createdSourceDetail: null }).where(eq(contacts.id, contact.id)).run();

    db.insert(workflowSteps)
      .values({
        id: nanoid(),
        workflowRunId: run.id,
        stepIndex: 1,
        stepType: "contact_create",
        status: "completed",
        contactId: contact.id,
      })
      .run();

    const result = backfillCreationProvenance();
    expect(result.byRule.C1).toBe(1);

    const row = db.select().from(contacts).where(eq(contacts.id, contact.id)).get();
    expect(row?.createdSource).toBe("agent");
    expect(row?.createdSourceDetail).toBe("agent:create_contact");
    expect(row?.createdWorkflowRunId).toBe(run.id);
  });

  it("C2 tags x archive imports from identity platform_data", () => {
    const runId = nanoid();
    createWorkflowRun({
      id: runId,
      workflowType: "import",
      status: "completed",
      config: JSON.stringify({ importSubType: "x_archive_contacts" }),
      startedAt: 1_700_000_000,
      completedAt: 1_700_000_030,
    });

    const contact = createContact({ name: "Archive User" });
    db.update(contacts)
      .set({ createdAt: 1_700_000_010, createdSource: null, createdSourceDetail: null })
      .where(eq(contacts.id, contact.id))
      .run();

    createIdentity({
      contactId: contact.id,
      platform: "x",
      platformUserId: "archive-1",
      platformData: JSON.stringify({ source: "x_archive_import" }),
    });

    const result = backfillCreationProvenance();
    expect(result.byRule.C2).toBe(1);

    const row = db.select().from(contacts).where(eq(contacts.id, contact.id)).get();
    expect(row?.createdSource).toBe("import");
    expect(row?.createdSourceDetail).toBe("import:x_archive");
    expect(row?.createdWorkflowRunId).toBe(runId);
  });

  it("O2 maps orgs.source ui to manual:create_org", () => {
    const org = createOrg({ name: "UI Org", source: "ui" });
    db.update(orgs).set({ createdSource: null, createdSourceDetail: null }).where(eq(orgs.id, org.id)).run();

    const result = backfillCreationProvenance();
    expect(result.byRule.O2).toBe(1);

    const row = db.select().from(orgs).where(eq(orgs.id, org.id)).get();
    expect(row?.createdSource).toBe("manual");
    expect(row?.createdSourceDetail).toBe("manual:create_org");
  });

  it("C6 tags agent:create_contact child rows near birth without run ids", () => {
    const contact = createContact({ name: "Agent Child" });
    db.update(contacts)
      .set({ createdAt: 1_700_000_000, createdSource: null, createdSourceDetail: null })
      .where(eq(contacts.id, contact.id))
      .run();

    db.insert(contactChannels)
      .values({
        id: nanoid(),
        contactId: contact.id,
        channelType: "email",
        value: "agent@example.com",
        valueNormalized: "agent@example.com",
        source: "agent:create_contact",
        createdAt: 1_700_000_030,
        updatedAt: 1_700_000_030,
      })
      .run();

    const result = backfillCreationProvenance();
    expect(result.byRule.C6).toBe(1);

    const row = db.select().from(contacts).where(eq(contacts.id, contact.id)).get();
    expect(row?.createdSource).toBe("agent");
    expect(row?.createdWorkflowRunId).toBeNull();
  });

  it("C8 uses sync:x follows edges near birth", () => {
    const contact = createContact({ name: "X Sync" });
    db.update(contacts)
      .set({ createdAt: 1_700_000_000, createdSource: null, createdSourceDetail: null })
      .where(eq(contacts.id, contact.id))
      .run();

    db.insert(graphEdges)
      .values({
        id: nanoid(),
        srcType: "contact",
        srcId: "owner",
        dstType: "contact",
        dstId: contact.id,
        edgeType: "follows",
        source: "sync:x",
        firstSeenAt: 1_700_000_020,
        lastSeenAt: 1_700_000_020,
        createdAt: 1_700_000_020,
        updatedAt: 1_700_000_020,
      })
      .run();

    const result = backfillCreationProvenance();
    expect(result.byRule.C8).toBe(1);

    const row = db.select().from(contacts).where(eq(contacts.id, contact.id)).get();
    expect(row?.createdSource).toBe("sync");
    expect(row?.createdSourceDetail).toBe("sync:x_contacts");
  });

  it("is idempotent on a second run", () => {
    const contact = createContact({ name: "Once" });
    db.update(contacts)
      .set({ createdAt: 1_700_000_000, createdSource: null, createdSourceDetail: null })
      .where(eq(contacts.id, contact.id))
      .run();

    db.insert(contactEmployments)
      .values({
        id: nanoid(),
        contactId: contact.id,
        orgId: createOrg({ name: "Co" }).id,
        source: "import:gmail_takeout",
        createdAt: 1_700_000_010,
        updatedAt: 1_700_000_010,
      })
      .run();

    createWorkflowRun({
      workflowType: "import",
      status: "completed",
      config: JSON.stringify({ importSubType: "gmail_takeout_contacts" }),
      startedAt: 1_700_000_000,
      completedAt: 1_700_000_020,
    });

    const first = backfillCreationProvenance();
    expect(first.byRule.C5).toBe(1);

    const second = backfillCreationProvenance();
    expect(second.byRule.C5 ?? 0).toBe(0);
    expect(Object.values(second.byRule).reduce((sum, n) => sum + n, 0)).toBe(0);
  });
});
