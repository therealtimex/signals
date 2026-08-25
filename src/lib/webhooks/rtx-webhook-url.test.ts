import { describe, expect, it } from "vitest";
import {
  buildSignalsOrchestratorWebhookIngressUrl,
  resolveOutboundWorkflowWebhookUrl,
  resolveRtxServerOrigin,
} from "@/lib/webhooks/rtx-webhook-url";

describe("rtx webhook url resolution", () => {
  it("strips /cli from REALTIMEX_BASE_URL to reach the server origin", () => {
    expect(
      resolveRtxServerOrigin({
        RTX_APP_ID: "app-1",
        REALTIMEX_BASE_URL: "http://127.0.0.1:3101/cli",
      })
    ).toBe("http://127.0.0.1:3101");
  });

  it("builds the orchestrator ingress URL from the active RTX server origin", () => {
    expect(
      buildSignalsOrchestratorWebhookIngressUrl({
        RTX_APP_ID: "app-1",
        REALTIMEX_BASE_URL: "http://127.0.0.1:3101/cli",
      })
    ).toBe(
      "http://127.0.0.1:3101/api/v1/webhook-ingress/inbound/signals-orchestrator"
    );
  });

  it("prefers explicit REALTIMEX_WEBHOOK_URL overrides", () => {
    expect(
      resolveOutboundWorkflowWebhookUrl(
        {
          RTX_APP_ID: "app-1",
          REALTIMEX_BASE_URL: "http://127.0.0.1:3101/cli",
          REALTIMEX_WEBHOOK_URL: "https://hooks.example.com/signals",
        },
        { agenticRouter: true }
      )
    ).toBe("https://hooks.example.com/signals");
  });

  it("returns undefined for non-agentic runs without explicit webhook URL", () => {
    expect(
      resolveOutboundWorkflowWebhookUrl(
        {
          RTX_APP_ID: "app-1",
          REALTIMEX_BASE_URL: "http://127.0.0.1:3101/cli",
        },
        { agenticRouter: false }
      )
    ).toBeUndefined();
  });

  it("falls back to embedded server port when no explicit RTX base is set", () => {
    expect(
      buildSignalsOrchestratorWebhookIngressUrl({
        RTX_APP_ID: "app-1",
        SERVER_PORT: "4242",
      })
    ).toBe("http://127.0.0.1:4242/api/v1/webhook-ingress/inbound/signals-orchestrator");
  });
});
