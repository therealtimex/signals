import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db/client";
import {
  contacts,
  contentItems,
  graphEdges,
  snowballEventAccessGrants,
  snowballEventObservations,
} from "@/lib/db/schema";
import { ensureBrowserConnection } from "@/lib/db/queries/platform-targets";
import { createWorkflowRun } from "@/lib/db/queries/workflows";
import { resetCoreTables } from "@/test/db";
import {
  mintEventAccessMaterial,
  persistAuthorizedEventObservations,
  readAuthorizedEventReport,
  revokeEventAccessGrant,
} from "@/lib/workflows/event-sources/access";

describe("owner-bound event reports", () => {
  beforeEach(() => resetCoreTables());
  afterEach(() => vi.restoreAllMocks());

  it("keeps participant observations behind the run, owner, and capability", () => {
    const observedAt = Math.floor(Date.now() / 1000);
    const run = createWorkflowRun({ workflowType: "search", status: "running", trigger: "template" });
    const connection = ensureBrowserConnection({ sessionName: "registered-luma" });
    const material = mintEventAccessMaterial();
    persistAuthorizedEventObservations({
      material,
      runId: run.id,
      ownerWorkspace: "signals",
      connectionId: connection.id,
      sessionName: connection.sessionName,
      viewerIdentity: "operator@example.com",
      eventKey: "demo",
      now: observedAt,
      participants: [{
        subjectKey: "alice",
        displayName: "Alice Builder",
        profileUrl: "https://luma.com/user/alice",
        rsvp: "registered",
        attendance: "unknown",
        evidence: {
          eventKey: "https://luma.com/demo",
          sourceUrl: "https://luma.com/demo",
          observedAt,
          observedRole: "participant",
          confidence: "high",
          scope: { kind: "authorized", ownerWorkspace: "signals", runId: run.id, grantId: material.grantId },
          provider: "luma",
          extractorVersion: 1,
          observationId: "obs-alice",
        },
      }],
    });

    const grants = db.select().from(snowballEventAccessGrants).all();
    expect(grants).toHaveLength(1);
    expect(JSON.stringify(grants)).not.toContain(material.capability);
    expect(db.select().from(snowballEventObservations).all()).toHaveLength(1);
    expect(JSON.stringify({
      contacts: db.select().from(contacts).all(),
      content: db.select().from(contentItems).all(),
      graph: db.select().from(graphEdges).all(),
    })).not.toContain("Alice Builder");
    expect(readAuthorizedEventReport({ runId: run.id, ownerWorkspace: "other", capability: material.capability })).toBeNull();
    expect(readAuthorizedEventReport({ runId: run.id, ownerWorkspace: "signals", capability: "wrong" })).toBeNull();
    expect(readAuthorizedEventReport({ runId: run.id, ownerWorkspace: "signals", capability: material.capability })?.participants)
      .toEqual([expect.objectContaining({
        displayName: "Alice Builder",
        rsvp: "registered",
        attendance: "unknown",
      })]);

    revokeEventAccessGrant(material.grantId);
    expect(readAuthorizedEventReport({ runId: run.id, ownerWorkspace: "signals", capability: material.capability })).toBeNull();
  });

  it("expires a capability at its exact deadline", () => {
    const issuedAt = 1_789_171_200;
    const run = createWorkflowRun({ workflowType: "search", status: "running", trigger: "template" });
    const connection = ensureBrowserConnection({ sessionName: "registered-luma" });
    const material = mintEventAccessMaterial();
    persistAuthorizedEventObservations({
      material,
      runId: run.id,
      ownerWorkspace: "signals",
      connectionId: connection.id,
      sessionName: connection.sessionName,
      viewerIdentity: "operator@example.com",
      eventKey: "https://luma.com/demo",
      now: issuedAt,
      participants: [],
    });
    vi.spyOn(Date, "now").mockReturnValue((issuedAt + 60 * 60) * 1_000);

    expect(readAuthorizedEventReport({
      runId: run.id,
      ownerWorkspace: "signals",
      capability: material.capability,
    })).toBeNull();
    expect(db.select().from(snowballEventAccessGrants).all()[0]?.status).toBe("expired");
  });
});
