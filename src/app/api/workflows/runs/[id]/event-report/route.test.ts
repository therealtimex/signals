import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { ensureBrowserConnection } from "@/lib/db/queries/platform-targets";
import { createWorkflowRun } from "@/lib/db/queries/workflows";
import { resetCoreTables } from "@/test/db";
import {
  mintEventAccessMaterial,
  persistAuthorizedEventObservations,
} from "@/lib/workflows/event-sources/access";
import { DELETE, GET } from "@/app/api/workflows/runs/[id]/event-report/route";

describe("GET protected Snowball event report", () => {
  beforeEach(() => {
    resetCoreTables();
    process.env.SIGNALS_RTX_WORKSPACE_SLUG = "signals";
  });

  it("requires the owner-bound capability and disables caching", async () => {
    const run = createWorkflowRun({
      workflowType: "search",
      status: "running",
      trigger: "template",
      config: JSON.stringify({ rtxWorkspaceSlug: "signals-resolved" }),
    });
    const connection = ensureBrowserConnection({ sessionName: "registered-luma" });
    const material = mintEventAccessMaterial();
    const observedAt = Math.floor(Date.now() / 1000);
    persistAuthorizedEventObservations({
      material,
      runId: run.id,
      ownerWorkspace: "signals-resolved",
      connectionId: connection.id,
      sessionName: connection.sessionName,
      viewerIdentity: "operator@example.com",
      eventKey: "demo",
      participants: [{
        subjectKey: "alice",
        displayName: "Alice Builder",
        profileUrl: null,
        rsvp: "registered",
        attendance: "unknown",
        evidence: {
          eventKey: "https://luma.com/demo",
          sourceUrl: "https://luma.com/demo",
          observedAt,
          observedRole: "participant",
          confidence: "high",
          scope: { kind: "authorized", ownerWorkspace: "signals-resolved", runId: run.id, grantId: material.grantId },
          provider: "luma",
          extractorVersion: 1,
          observationId: "obs-alice",
        },
      }],
    });

    const missing = await GET(new NextRequest("http://signals.local"), { params: Promise.resolve({ id: run.id }) });
    expect(missing.status).toBe(401);

    const response = await GET(new NextRequest("http://signals.local", {
      headers: { "x-signals-event-report-capability": material.capability },
    }), { params: Promise.resolve({ id: run.id }) });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store, private");
    expect(await response.json()).toMatchObject({
      grantId: material.grantId,
      session: { name: "registered-luma", authorizedAt: observedAt },
      participants: [{
        displayName: "Alice Builder",
        rsvp: "registered",
        attendance: "unknown",
      }],
    });

    const revoked = await DELETE(new NextRequest("http://signals.local", {
      method: "DELETE",
      headers: { "x-signals-event-report-capability": material.capability },
    }), { params: Promise.resolve({ id: run.id }) });
    expect(revoked.status).toBe(204);

    const afterRevoke = await GET(new NextRequest("http://signals.local", {
      headers: { "x-signals-event-report-capability": material.capability },
    }), { params: Promise.resolve({ id: run.id }) });
    expect(afterRevoke.status).toBe(403);
  });
});
