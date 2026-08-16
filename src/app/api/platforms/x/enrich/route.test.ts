import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { nanoid } from "nanoid";
import { GET, POST } from "@/app/api/platforms/x/enrich/route";
import { db } from "@/lib/db/client";
import { platformAccounts } from "@/lib/db/schema";
import {
  BROWSER_ENRICHMENT_MESSAGE,
  BROWSER_ENRICHMENT_UNAVAILABLE_CODE,
} from "@/lib/platforms/sync-x-profiles";
import { resetCoreTables } from "@/test/db";

describe("/api/platforms/x/enrich", () => {
  beforeEach(() => {
    resetCoreTables();
    db.delete(platformAccounts).run();
  });

  it("GET returns migration guidance when X is not connected", async () => {
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.configured).toBe(false);
    expect(body.delegatedToRtx).toBe(true);
    expect(body.message).toBe(BROWSER_ENRICHMENT_MESSAGE);
  });

  it("POST returns migration guidance when X is not connected", async () => {
    const res = await POST(
      new NextRequest("http://localhost/api/platforms/x/enrich", {
        method: "POST",
        body: JSON.stringify({}),
      })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.delegated).toBe(true);
    expect(body.message).toBe(BROWSER_ENRICHMENT_MESSAGE);
    expect(body.workflowRunId).toBeUndefined();
  });

  it("POST records a failed enrich workflow when X is connected", async () => {
    db.insert(platformAccounts)
      .values({
        id: nanoid(),
        platform: "x",
        displayName: "Test X",
        authType: "oauth",
        status: "active",
      })
      .run();

    const res = await POST(
      new NextRequest("http://localhost/api/platforms/x/enrich", {
        method: "POST",
        body: JSON.stringify({}),
      })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.delegated).toBe(true);
    expect(body.message).toBe(BROWSER_ENRICHMENT_MESSAGE);
    expect(body.workflowRunId).toBeTruthy();
    expect(body.result.errors[0]).toContain(BROWSER_ENRICHMENT_UNAVAILABLE_CODE);
  });
});
