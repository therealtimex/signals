import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const browserConnectionMocks = vi.hoisted(() => ({
  withPlatformBrowserPage: vi.fn(),
  probeAuthenticatedPlatformIdentity: vi.fn(),
}));

vi.mock("@/lib/platforms/browser-connection", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/platforms/browser-connection")>();
  return { ...actual, ...browserConnectionMocks };
});

import { runTemplateViaRtx } from "@/lib/agents/run-template-via-rtx";
import { createTemplate } from "@/lib/db/queries/workflow-templates";
import { getBrowserConnectionBySessionName } from "@/lib/db/queries/platform-targets";
import { getWorkflowRun, listWorkflowSteps } from "@/lib/db/queries/workflows";
import { getSessionLease } from "@/lib/leases/session-lease";
import { resetCoreTables } from "@/test/db";
import { buildNetworkSnowballTemplateConfig } from "@/lib/workflows/network-snowball";
import {
  getNetworkSnowballTargetFromRunConfig,
  releaseNetworkSnowballTargetForRun,
} from "@/lib/workflows/network-snowball-target";
import { attestSnowballLinkedInIdentity } from "@/lib/workflows/snowball-identity-evidence";
import type { PublicSourceTransport } from "@/lib/workflows/snowball-sources/public-fetch";

const allowPublicSourceDestination = async () => undefined;
const observeJaneDoe = async () => ({
  finalUrl: "https://www.linkedin.com/in/jane-doe/",
  authenticated: true,
  visibleName: "Jane Doe",
  headline: "Founder at Acme",
  topCardText: "Jane Doe Founder at Acme",
  unavailable: false,
  avatarUrl: null,
  sessionViewerAvatarUrl: null,
});

describe("Network Snowball dispatch-to-attest lease contract", () => {
  let storageDir = "";

  beforeEach(() => {
    resetCoreTables();
    storageDir = mkdtempSync(join(tmpdir(), "signals-snowball-dispatch-attest-"));
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-18T08:00:00.000Z"));
    browserConnectionMocks.withPlatformBrowserPage.mockReset().mockImplementation(
      async (...args: unknown[]) => {
        const callback = args[2] as (page: { goto: ReturnType<typeof vi.fn> }) => Promise<unknown>;
        return callback({ goto: vi.fn().mockResolvedValue(null) });
      },
    );
    browserConnectionMocks.probeAuthenticatedPlatformIdentity.mockReset().mockResolvedValue({
      loggedIn: true,
      detectedHandle: "/in/Session-Owner",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(storageDir, { recursive: true, force: true });
  });

  it("attests after public-source dispatch and recovers an expired prepared lease", async () => {
    const template = createTemplate({
      name: "Network Snowball",
      templateType: "prospecting",
      status: "active",
      config: JSON.stringify({
        ...buildNetworkSnowballTemplateConfig(),
        seedType: "source_url",
        seedValue: "https://x.com/acme_ai/status/123456789",
      }),
      isSystem: 1,
    });
    const sourceTransport: PublicSourceTransport = async (url) => ({
      url,
      status: 200,
      contentType: "text/html",
      body: "<html><head><title>Acme launch</title></head><body><h1>Acme launch</h1></body></html>",
    });
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith("/api/health")) {
        return new Response(JSON.stringify({ app: "signals", status: "ok" }), { status: 200 });
      }
      if (url.endsWith("/cli/get-workspace/signals")) {
        return new Response(JSON.stringify({ workspace: { slug: "signals" } }), { status: 200 });
      }
      if (url.endsWith("/cli/create-thread/signals")) {
        return new Response(JSON.stringify({ thread: { slug: "network-snowball" } }), {
          status: 200,
        });
      }
      if (url.endsWith("/cli/send-message/signals/network-snowball")) {
        return new Response(JSON.stringify({
          success: true,
          terminalDispatchAccepted: true,
          descriptor: { id: "runtime-snowball-integration" },
        }), { status: 200 });
      }
      if (url.endsWith("/sdk/desktop/runtime-sessions/open-launcher")) {
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: `Unexpected request: ${url}` }), { status: 500 });
    }) as unknown as typeof fetch;

    const result = await runTemplateViaRtx(
      { templateId: template.id, signalsBaseUrl: "http://127.0.0.1:3099" },
      {
        ...process.env,
        RTX_APP_ID: "test-app-id",
        RTX_API_BASE_URL: "http://127.0.0.1:3001",
        STORAGE_DIR: storageDir,
      },
      fetchImpl,
      sourceTransport,
      allowPublicSourceDestination,
    );

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    const brief = readFileSync(join(
      storageDir,
      "working-data/signals/workflow-runs",
      result.workflowRunId,
      "brief.md",
    ), "utf8");
    const scopeToken = /snowballScopeToken: "([^"]+)"/.exec(brief)?.[1];
    expect(scopeToken).toBeTruthy();

    const initialTarget = getNetworkSnowballTargetFromRunConfig(
      getWorkflowRun(result.workflowRunId)?.config,
    );
    expect(initialTarget).toMatchObject({
      sessionName: "signals-publish",
      verifiedHandle: "/in/Session-Owner",
    });
    expect(listWorkflowSteps(result.workflowRunId)).toContainEqual(
      expect.objectContaining({
        tool: "snowball_source_ingest",
        status: "completed",
        output: expect.stringContaining('"provider":"x"'),
      }),
    );

    const firstEvidence = await attestSnowballLinkedInIdentity(
      {
        snowballScopeToken: scopeToken!,
        candidateName: "Jane Doe",
        candidateCompany: "Acme",
        candidateTitle: "Founder",
        profileUrl: "https://www.linkedin.com/in/jane-doe/",
      },
      { observe: observeJaneDoe },
    );
    expect(firstEvidence.identityEvidenceToken).toBeTruthy();

    vi.setSystemTime(new Date("2026-09-18T08:30:01.000Z"));
    const secondEvidence = await attestSnowballLinkedInIdentity(
      {
        snowballScopeToken: scopeToken!,
        candidateName: "Jane Doe",
        candidateCompany: "Acme",
        candidateTitle: "Founder",
        profileUrl: "https://www.linkedin.com/in/jane-doe/",
      },
      { observe: observeJaneDoe },
    );
    expect(secondEvidence.identityEvidenceToken).toBeTruthy();

    const recoveredTarget = getNetworkSnowballTargetFromRunConfig(
      getWorkflowRun(result.workflowRunId)?.config,
    );
    expect(recoveredTarget?.leaseId).not.toBe(initialTarget?.leaseId);
    expect(recoveredTarget?.leaseExpiresAt).toBeGreaterThan(initialTarget?.leaseExpiresAt ?? 0);
    const connection = getBrowserConnectionBySessionName("signals-publish");
    expect(connection).toBeTruthy();
    expect(getSessionLease(connection!.id)).toMatchObject({
      leaseId: recoveredTarget?.leaseId,
      holder: `network-snowball:${result.workflowRunId}`,
      targetId: recoveredTarget?.targetId,
    });
    expect(releaseNetworkSnowballTargetForRun(result.workflowRunId)).toMatchObject({
      released: true,
      leaseId: recoveredTarget?.leaseId,
    });
  });
});
