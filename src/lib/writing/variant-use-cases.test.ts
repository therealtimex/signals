import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetPersonalityStore } from "@/lib/personality/store-paths";
import { getVariantById } from "@/lib/db/queries/variants";
import { resetCoreTables } from "@/test/db";
import {
  createPersonalityWritingFixture,
  personalityVariantPayload,
} from "@/test/personality-writing-fixture";
import { upsertVariantUseCase } from "@/lib/writing/variant-use-cases";

let storageDir = "";

describe.sequential("Personality-bound variant use case", () => {
  beforeEach(() => {
    resetCoreTables();
    resetPersonalityStore();
    storageDir = mkdtempSync(join(tmpdir(), "signals-379-variant-use-case-"));
  });

  afterEach(() => {
    rmSync(storageDir, { recursive: true, force: true });
  });

  it("rejects an audited direct surface without a compatible target", async () => {
    const fixture = await createPersonalityWritingFixture(storageDir);
    await expect(upsertVariantUseCase(personalityVariantPayload({
      launchId: fixture.launchId,
      bindingId: fixture.binding.id,
      body: "A direct audit without an acting target is invalid.",
    }), fixture.dependencies)).rejects.toMatchObject({
      code: "CONFLICT",
      details: { reason: "target_identity_mismatch" },
    });
  });

  it("preserves targetless audited drafts for a non-publishable surface", async () => {
    const fixture = await createPersonalityWritingFixture(storageDir);
    const saved = await upsertVariantUseCase(personalityVariantPayload({
      launchId: fixture.launchId,
      bindingId: fixture.binding.id,
      body: "A targetless draft remains exportable.",
      surface: "threads/post",
    }), fixture.dependencies);
    const writing = JSON.parse(getVariantById(saved.id)!.metadata ?? "{}").writing;
    expect(writing).toMatchObject({
      capability: { publish: "draft_only" },
      personality: { bindingId: fixture.binding.id, target: null },
    });
  });
});
