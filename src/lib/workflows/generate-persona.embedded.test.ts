import { beforeEach, describe, expect, it } from "vitest";
import { nanoid } from "nanoid";
import { createContact } from "@/lib/db/queries/contacts";
import { createIdentity } from "@/lib/db/queries/identities";
import { logInteraction } from "@/lib/db/queries/interactions";
import { getActivePersona } from "@/lib/db/queries/personas";
import { generatePersona } from "@/lib/workflows/generate-persona";
import { db } from "@/lib/db/client";
import { contentItems, contentPosts, platformAccounts } from "@/lib/db/schema";
import { getRtxAppId, resolveRtxApiBase } from "@/lib/rtx/env";
import { resetCoreTables } from "@/test/db";

const embeddedQa = process.env.SIGNALS_EMBEDDED_QA === "1";

function requireEmbeddedEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required env for embedded QA: ${name}`);
  }
  return value;
}

function seedEvidenceContact() {
  const contact = createContact({
    name: "Embedded QA Persona Subject",
    platform: "x",
    platformUserId: nanoid(),
  });
  createIdentity({
    contactId: contact.id,
    platform: "x",
    platformUserId: nanoid(),
    platformHandle: "embedded-qa-founder",
    isActive: 1,
  });

  const platformAccountId = nanoid();
  db.insert(platformAccounts)
    .values({ id: platformAccountId, platform: "x", displayName: "@brand", authType: "oauth" })
    .run();

  const now = Math.floor(Date.now() / 1000);
  for (let i = 0; i < 2; i += 1) {
    const itemId = nanoid();
    db.insert(contentItems)
      .values({
        id: itemId,
        contactId: contact.id,
        contentType: "post",
        title: `Post ${i}`,
        body: `Public launch content ${i}`,
        status: "published",
      })
      .run();
    db.insert(contentPosts)
      .values({
        id: nanoid(),
        contentItemId: itemId,
        platformAccountId,
        publishedAt: now - i * 100,
        status: "published",
      })
      .run();
  }

  for (let i = 0; i < 3; i += 1) {
    logInteraction({
      contactId: contact.id,
      interactionType: "like",
      scope: "shared",
      occurredAt: now - 500 + i,
    });
  }

  return contact;
}

describe.runIf(embeddedQa)("generatePersona embedded host QA", () => {
  function rtxEnv() {
    return {
      RTX_APP_ID: requireEmbeddedEnv("RTX_APP_ID"),
      SERVER_URL: requireEmbeddedEnv("SERVER_URL"),
    };
  }

  beforeEach(() => {
    resetCoreTables();
  });

  it("probes RTX llm.chat provenance contract", async () => {
    const env = rtxEnv();
    const appId = getRtxAppId(env);
    const apiBase = resolveRtxApiBase(env);
    expect(appId).toBeTruthy();
    expect(apiBase).toBeTruthy();

    const response = await fetch(`${apiBase}/sdk/llm/chat`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-app-id": appId!,
      },
      body: JSON.stringify({
        messages: [{ role: "user", content: "Reply with exactly: OK" }],
      }),
    });

    const body = (await response.json()) as {
      success?: boolean;
      response?: { content?: string; provider?: string; model?: string };
      error?: string;
      code?: string;
    };

    expect(
      response.ok && body.success !== false,
      `RTX chat probe failed (${body.code ?? response.status}): ${body.error ?? "unknown error"} — configure a working LLM provider on the owned RTX worktree dev host before running embedded QA`,
    ).toBe(true);

    expect(body.response?.provider?.trim()).toBeTruthy();
    expect(body.response?.model?.trim()).toBeTruthy();
  });

  it("persists qualified provider:model on generate_persona", async () => {
    const contact = seedEvidenceContact();
    const env = rtxEnv();

    const result = await generatePersona(contact.id, { env });
    expect(result.generated).toBe(true);
    if (!result.generated) return;

    expect(result.persona.model).toMatch(/^.+:.+$/);

    const active = getActivePersona(contact.id);
    expect(active?.model).toBe(result.persona.model);
    expect(active?.workflowRunId).toBeTruthy();
  });
});
