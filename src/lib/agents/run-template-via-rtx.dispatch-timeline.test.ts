/**
 * #572 end to end: the issue's Contact Web Research timeline, replayed through the real
 * runTemplateViaRtx and the real /api/contacts/[id]/web-research route against a stateful RTX mock.
 * No run fixtures are seeded; every run is created by an actual dispatch. Written by the verifier as
 * an independent check (it fails on 3102789, before the fix) and kept as a regression test.
 *
 * Timeline:
 *   r1 accepted on the shared thread and completed
 *   r2 send → 409 SEND_MESSAGE_OUTCOME_UNKNOWN          (23:57)
 *   r3 send → 502 DESKTOP_RUNTIME_SESSION_RELAY_ERROR   (23:58, RTX otherwise up)
 *   r4 send → accepted, then nothing for 20 min and no listed session (23:59+)
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const researchTargetMocks = vi.hoisted(() => ({
  prepareContactWebResearchTarget: vi.fn(),
  releaseContactWebResearchTarget: vi.fn(),
}));
vi.mock("@/lib/workflows/contact-web-research-target", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/lib/workflows/contact-web-research-target")
  >();
  return { ...actual, ...researchTargetMocks };
});

import { GET, POST } from "@/app/api/contacts/[id]/web-research/route";
import { runTemplateViaRtx } from "@/lib/agents/run-template-via-rtx";
import { createContact } from "@/lib/db/queries/contacts";
import {
  claimTemplateThreadSlug,
  getSystemTemplateByName,
  getTemplate,
} from "@/lib/db/queries/workflow-templates";
import { getWorkflowRun, updateWorkflowRun } from "@/lib/db/queries/workflows";
import { db } from "@/lib/db/client";
import { workflowRuns, workflowSteps } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { CONTACT_WEB_RESEARCH_TEMPLATE_NAME, seedTemplates } from "@/lib/db/seed-templates";
import { readWorkflowTerminalLifecycle } from "@/lib/rtx/workflow-terminal-lifecycle";
import { resetCoreTables } from "@/test/db";

const SHARED = "shared-enrich-thread";

type Mode = "accept" | "unknown409" | "relay502";

function statefulRtx() {
  const state = { mode: "accept" as Mode, created: 0, sends: [] as string[] };
  const threads = new Set([SHARED]);
  const impl = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/api/health")) {
      return new Response(JSON.stringify({ app: "signals", status: "ok" }), { status: 200 });
    }
    if (url.endsWith("/cli/get-workspace/signals")) {
      return new Response(JSON.stringify({ workspace: { slug: "signals" } }), { status: 200 });
    }
    const get = url.match(/\/cli\/get-thread\/signals\/([^/?]+)$/);
    if (get) {
      const slug = decodeURIComponent(get[1]);
      return threads.has(slug)
        ? new Response(JSON.stringify({ thread: { slug, name: "Contact Enrich Profile" } }), { status: 200 })
        : new Response(JSON.stringify({ error: "not found" }), { status: 404 });
    }
    if (url.endsWith("/cli/create-thread/signals")) {
      const slug = `new-thread-${++state.created}`;
      threads.add(slug);
      return new Response(JSON.stringify({ thread: { slug } }), { status: 200 });
    }
    const send = url.match(/\/cli\/send-message\/signals\/([^/?]+)$/);
    if (send) {
      const slug = decodeURIComponent(send[1]);
      state.sends.push(slug);
      if (state.mode === "unknown409") {
        return new Response(
          JSON.stringify({
            success: false,
            status: "delivery_unknown",
            code: "SEND_MESSAGE_OUTCOME_UNKNOWN",
            error:
              "The receiving terminal did not confirm the message in time. It may still have received it: do not send it again; check the receiving thread first.",
            dispatchTimedOut: true,
            terminalDispatchAccepted: false,
          }),
          { status: 409 },
        );
      }
      if (state.mode === "relay502") {
        return new Response(
          JSON.stringify({ success: false, code: "DESKTOP_RUNTIME_SESSION_RELAY_ERROR", error: "relay error" }),
          { status: 502 },
        );
      }
      return new Response(
        JSON.stringify({
          success: true,
          terminalDispatchAccepted: true,
          threadSlug: slug,
          descriptor: { id: `cli-agent:${slug}-session` },
        }),
        { status: 200 },
      );
    }
    if (url.includes("/cli/list-terminal-sessions")) {
      // The issue: thread idle, activeSessionCount 0.
      return new Response(JSON.stringify({ success: true, sessions: [] }), { status: 200 });
    }
    if (url.endsWith("/sdk/desktop/runtime-sessions/open-launcher")) {
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }
    if (url.includes("/cli/list-browser-sessions")) {
      return new Response(JSON.stringify({ success: true, sessions: [] }), { status: 200 });
    }
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  }) as unknown as typeof fetch;
  return { state, impl };
}

function backdate(runId: string, minutes: number) {
  const shiftSec = minutes * 60;
  const run = getWorkflowRun(runId)!;
  const config = JSON.parse(run.config ?? "{}") as Record<string, unknown>;
  for (const value of Object.values(config)) {
    if (value && typeof value === "object" && "dispatch" in (value as object)) {
      const dispatch = (value as { dispatch: Record<string, unknown> }).dispatch;
      for (const key of ["startedAt", "settledAt"]) {
        if (typeof dispatch[key] === "number") dispatch[key] = (dispatch[key] as number) - shiftSec * 1000;
      }
    }
  }
  db.update(workflowRuns)
    .set({
      config: JSON.stringify(config),
      createdAt: run.createdAt - shiftSec,
      startedAt: (run.startedAt ?? run.createdAt) - shiftSec,
      updatedAt: run.updatedAt - shiftSec,
    })
    .where(eq(workflowRuns.id, runId))
    .run();
  const steps = db.select().from(workflowSteps).where(eq(workflowSteps.workflowRunId, runId)).all();
  for (const step of steps) {
    db.update(workflowSteps)
      .set({ createdAt: step.createdAt - shiftSec })
      .where(eq(workflowSteps.id, step.id))
      .run();
  }
}

describe("Contact Web Research dispatch timeline (#572)", () => {
  let storageDir = "";
  let env: NodeJS.ProcessEnv;

  beforeEach(() => {
    resetCoreTables();
    storageDir = mkdtempSync(join(tmpdir(), "signals-dispatch-timeline-"));
    env = { ...process.env, RTX_APP_ID: "timeline-app", RTX_API_BASE_URL: "http://127.0.0.1:3999", STORAGE_DIR: storageDir };
    researchTargetMocks.prepareContactWebResearchTarget.mockReset().mockResolvedValue({
      ok: true,
      target: {
        targetId: "t", platform: "linkedin", source: "default", sessionName: "signals-publish",
        startUrl: "https://www.linkedin.com/in/x", expectedHandle: "/in/x", verifiedHandle: "/in/x",
        leaseId: "lease", leaseExpiresAt: 1_800_000_000, preparedAt: 1_799_999_400,
      },
    });
    researchTargetMocks.releaseContactWebResearchTarget.mockReset().mockReturnValue({
      leaseId: "lease", released: true, alreadyGone: false,
    });
  });
  afterEach(() => rmSync(storageDir, { recursive: true, force: true }));

  it("survives an unconfirmed 409, a relay 502 and an accepted-then-silent run", async () => {
    seedTemplates();
    const template = getSystemTemplateByName(CONTACT_WEB_RESEARCH_TEMPLATE_NAME)!;
    claimTemplateThreadSlug(template.id, null, SHARED);
    const rtx = statefulRtx();
    const dispatch = async () => {
      const contact = createContact({ name: `Tier A ${Math.random()}` });
      const result = await runTemplateViaRtx(
        { templateId: template.id, config: { contactId: contact.id }, signalsBaseUrl: "http://127.0.0.1:3099" },
        env,
        rtx.impl,
      );
      return { contact, result };
    };

    // r1: healthy run, completed.
    const r1 = await dispatch();
    expect.soft(r1.result.success).toBe(true);
    updateWorkflowRun(r1.result.workflowRunId!, { status: "completed", completedAt: Math.floor(Date.now() / 1000) });

    // r2: 23:57 — 409 SEND_MESSAGE_OUTCOME_UNKNOWN.
    rtx.state.mode = "unknown409";
    const r2 = await dispatch();
    const r2Run = getWorkflowRun(r2.result.workflowRunId!)!;
    const r2Lifecycle = readWorkflowTerminalLifecycle(r2Run.config);
    expect.soft(r2.result.success).toBe(false);
    if (!r2.result.success) expect.soft(r2.result.errorCode).toBe("launch_failed");
    expect.soft(r2Lifecycle?.dispatch.state).toBe("uncertain");
    expect.soft(r2Lifecycle?.cleanup.requested).toBe(true);

    // r3: 23:58 — next send hits a relay 5xx while RTX answers workspace/thread calls.
    rtx.state.mode = "relay502";
    const r3 = await dispatch();
    const sendsAfterR3 = [...rtx.state.sends];
    expect.soft(r3.result.success).toBe(false);
    if (!r3.result.success) {
      expect.soft(r3.result.errorCode).not.toBe("rtx_unavailable");
      expect.soft(r3.result.details?.previousDispatch).toMatchObject({
        workflowRunId: r2.result.workflowRunId,
      });
    }
    // r3 must not be sent into the thread whose last handoff was never confirmed.
    expect.soft(sendsAfterR3.at(-1)).not.toBe(SHARED);

    // r4: 23:59 — accepted, then silent for 20 minutes; RTX lists no session.
    rtx.state.mode = "accept";
    const r4 = await dispatch();
    expect.soft(r4.result.success).toBe(true);
    if (r4.result.success) expect.soft(r4.result.threadResolution).toBe("replaced");
    expect.soft(getTemplate(template.id)?.rtxThreadSlug).not.toBe(SHARED);
    const r4RunId = r4.result.workflowRunId!;
    updateWorkflowRun(r4RunId, { status: "running" });
    backdate(r4RunId, 20);

    const ctx = { params: Promise.resolve({ id: r4.contact.id }) };
    const url = `http://127.0.0.1:3000/api/contacts/${r4.contact.id}/web-research`;
    const getBody = await (await GET(new NextRequest(url), ctx)).json();
    const postRes = await POST(new NextRequest(url, { method: "POST" }), { params: Promise.resolve({ id: r4.contact.id }) });
    const postBody = await postRes.json();
    expect.soft(getBody.status).toBe("failed");
    expect.soft(getBody.errorCode).toBe("dispatch_lost");
    expect.soft(postRes.status).not.toBe(409);
    expect.soft(getWorkflowRun(r4RunId)?.status).toBe("failed");
  });
});
