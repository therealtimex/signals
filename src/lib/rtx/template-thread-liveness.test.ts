import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { workflowRuns } from "@/lib/db/schema";
import { createContact } from "@/lib/db/queries/contacts";
import { createTemplate } from "@/lib/db/queries/workflow-templates";
import { createWorkflowRun, getWorkflowRun } from "@/lib/db/queries/workflows";
import { assessTemplateThreadLiveness } from "@/lib/rtx/template-thread-liveness";
import {
  beginWorkflowTerminalDispatch,
  settleWorkflowTerminalDispatch,
  writeWorkflowTerminalLifecycle,
} from "@/lib/rtx/workflow-terminal-lifecycle";
import { buildContactWebResearchTemplateConfig } from "@/lib/workflows/contact-web-research";
import { resetCoreTables } from "@/test/db";

/**
 * PR #574 review W1 and W9: the shared-thread check must judge the thread by its most recent
 * handoff, whatever order the runs were created in and however many runs never reached dispatch.
 */

const THREAD = "shared-thread";
const RTX_ENV = { RTX_APP_ID: "signals", RTX_API_BASE_URL: "http://127.0.0.1:3001" };

/** Every run here is settled, so RTX is never asked. */
const noRtx = vi.fn(async () => {
  throw new Error("unexpected RTX call");
}) as unknown as typeof fetch;

describe("assessTemplateThreadLiveness: which handoff is the last one", () => {
  let templateId: string;

  beforeEach(() => {
    resetCoreTables();
    templateId = createTemplate({
      name: "Contact Web Research",
      templateType: "enrichment",
      status: "active",
      config: JSON.stringify(buildContactWebResearchTemplateConfig()),
      isSystem: 1,
    }).id;
  });

  /** A run created at `createdAtSec`; with `dispatch`, handed to the thread at `dispatchedAtMs`. */
  function runOnThread(options: {
    createdAtSec: number;
    status: "completed" | "failed";
    dispatch?: { atMs: number; state: "accepted" | "uncertain" };
  }) {
    const contact = createContact({ name: `Run ${options.createdAtSec}` });
    const sessionId = `cli-agent:${contact.id}`;
    const baseConfig = {
      ...buildContactWebResearchTemplateConfig(),
      contactId: contact.id,
      rtxWorkspaceSlug: "signals",
      rtxThreadSlug: THREAD,
      ...(options.dispatch?.state === "accepted" ? { rtxRuntimeSessionId: sessionId } : {}),
    };
    let config = JSON.stringify(baseConfig);
    if (options.dispatch) {
      const begun = beginWorkflowTerminalDispatch(
        config,
        {
          runId: contact.id,
          workspaceSlug: "signals",
          threadSlug: THREAD,
          briefPath: "/tmp/brief.md",
          message: "Run",
        },
        options.dispatch.atMs,
      );
      config = writeWorkflowTerminalLifecycle(
        config,
        settleWorkflowTerminalDispatch(
          begun,
          options.dispatch.state === "accepted"
            ? { state: "accepted", descriptor: { id: sessionId } }
            : { state: "uncertain", error: "SEND_MESSAGE_OUTCOME_UNKNOWN" },
          options.dispatch.atMs,
        ),
      );
    }
    const run = createWorkflowRun({
      templateId,
      workflowType: "enrich",
      status: options.status,
      trigger: "template",
      config,
    });
    db.update(workflowRuns)
      .set({
        createdAt: options.createdAtSec,
        startedAt: options.createdAtSec,
        updatedAt: options.createdAtSec,
      })
      .where(eq(workflowRuns.id, run.id))
      .run();
    return getWorkflowRun(run.id)!;
  }

  const assess = () =>
    assessTemplateThreadLiveness({ templateId, workspaceSlug: "signals", threadSlug: THREAD }, RTX_ENV, noRtx);

  const nowSec = Math.floor(Date.now() / 1000);

  it("judges by the run handed over last, not the run created last (W1)", async () => {
    // A is created first but its preflight is slow: it is handed over after B, and never confirmed.
    const a = runOnThread({
      createdAtSec: nowSec - 120,
      status: "failed",
      dispatch: { atMs: (nowSec - 30) * 1000, state: "uncertain" },
    });
    runOnThread({
      createdAtSec: nowSec - 100,
      status: "completed",
      dispatch: { atMs: (nowSec - 60) * 1000, state: "accepted" },
    });

    await expect(assess()).resolves.toMatchObject({
      alive: false,
      reason: "previous_dispatch_unconfirmed",
      previousRunId: a.id,
    });
  });

  it("keeps the thread when the later handoff was confirmed, whatever the creation order (W1)", async () => {
    runOnThread({
      createdAtSec: nowSec - 120,
      status: "completed",
      dispatch: { atMs: (nowSec - 30) * 1000, state: "accepted" },
    });
    runOnThread({
      createdAtSec: nowSec - 100,
      status: "failed",
      dispatch: { atMs: (nowSec - 60) * 1000, state: "uncertain" },
    });

    await expect(assess()).resolves.toEqual({ alive: true, inspectedSessions: false });
  });

  it("still sees an unconfirmed handoff behind ten newer runs that never reached dispatch (W9)", async () => {
    const unconfirmed = runOnThread({
      createdAtSec: nowSec - 600,
      status: "failed",
      dispatch: { atMs: (nowSec - 600) * 1000, state: "uncertain" },
    });
    for (let index = 0; index < 10; index += 1) {
      runOnThread({ createdAtSec: nowSec - 500 + index, status: "failed" });
    }

    await expect(assess()).resolves.toMatchObject({
      alive: false,
      reason: "previous_dispatch_unconfirmed",
      previousRunId: unconfirmed.id,
    });
  });
});
