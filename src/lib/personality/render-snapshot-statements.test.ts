import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  brandRenderedBrandInput,
  brandRenderedIdentityInput,
  brandRenderedVoiceInput,
  type PersonalitySources,
} from "@/lib/personality/contracts";
import {
  renderBoundariesBlock,
  renderPersonalityBlocks,
  renderVoiceBlock,
} from "@/lib/personality/render";
import {
  buildSourceSnapshot,
  computeSourceHash,
  sourceRevisions,
} from "@/lib/personality/snapshot";
import {
  readPersonalityStatements,
  upsertPersonalityStatements,
} from "@/lib/personality/statements";
import { resetCoreTables } from "@/test/db";
import { sha256Canonical } from "@/lib/writing/hash";

const HASH = "b".repeat(64);

function sourceFixture(): PersonalitySources {
  return {
    identity: brandRenderedIdentityInput({
      contactId: "contact-1",
      name: "Ada Lovelace",
      preferredName: "Ada",
      headline: "Builder",
      bio: null,
      currentRole: { title: "Founder", orgName: "Analytical Engines" },
      website: "https://ada.example",
      profiles: [
        { network: "linkedin", url: "https://linkedin.example/ada", displayName: null },
        { network: "x", url: "https://x.example/ada", displayName: "Ada" },
      ],
      representedOrgName: "Analytical Engines",
    }),
    brand: brandRenderedBrandInput({
      orgId: "org-1",
      name: "Analytical Engines",
      description: "Computing",
      website: "https://engines.example",
      industry: "Software",
      companySize: "1-10",
      primaryDomain: { domain: "engines.example", verified: true },
      profiles: [],
      selfRelationshipTitle: "Founder",
    }),
    voice: brandRenderedVoiceInput({
      profile: { id: "vp_profile1", label: "Primary", version: 2, hash: HASH },
      platforms: ["linkedin", "x"],
      sentenceLength: { median: 8, range: [3, 14] },
      openers: ["Start plainly"],
      closers: [],
      punctuation: ["em dash"],
      formats: ["short post"],
      emoji: ["rare"],
      hashtags: [],
      vocabulary: { keep: ["ship"], avoid: ["leverage"] },
      protectedQuirks: ["fragments"],
      taboo: ["hype"],
      signatureLines: [
        { id: "vs_sample02", text: "Second line" },
        { id: "vs_sample01", text: "First line" },
      ],
      exemplars: [
        { id: "vs_sample06", text: "Sixth" },
        { id: "vs_sample03", text: "Third" },
        { id: "vs_sample01", text: "First" },
        { id: "vs_sample05", text: "Fifth" },
        { id: "vs_sample02", text: "Second" },
        { id: "vs_sample04", text: "Fourth" },
      ],
    }),
    statements: {
      schemaVersion: 1,
      values: ["Build useful things"],
      boundaries: ["No invented claims"],
      updatedAt: 50,
      hash: sha256Canonical({
        values: ["Build useful things"],
        boundaries: ["No invented claims"],
      }),
    },
  };
}

describe("personality statements, rendering, and snapshots", () => {
  beforeEach(() => {
    resetCoreTables();
    vi.restoreAllMocks();
  });

  it("stores bounded statements verbatim without Unicode normalization", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const decomposed = "  Cafe\u0301  ";
    const stored = await upsertPersonalityStatements({
      values: [decomposed],
      boundaries: ["Keep  inner   spaces"],
    });
    expect(stored).toMatchObject({
      updatedAt: 1_700_000_000,
      values: [decomposed],
      boundaries: ["Keep  inner   spaces"],
    });
    expect(stored.values[0]).not.toBe(stored.values[0].normalize("NFC"));
    expect(readPersonalityStatements()).toEqual(stored);
    expect(renderBoundariesBlock(stored).body).toContain(decomposed);

    await expect(upsertPersonalityStatements({
      values: Array.from({ length: 13 }, (_, index) => String(index)),
      boundaries: [],
    })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(upsertPersonalityStatements({
      values: ["x".repeat(281)],
      boundaries: [],
    })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("renders deterministic ordered LF blocks without run metadata", () => {
    const sources = sourceFixture();
    const blocks = renderPersonalityBlocks(sources);
    expect(blocks).toEqual(renderPersonalityBlocks(sources));
    expect(blocks.identity.body).not.toContain("\r");
    expect(blocks.brand?.body).not.toContain("\r");
    expect(blocks.voice?.body).not.toContain("\r");
    expect(blocks.boundaries.body).not.toContain("\r");
    expect(JSON.stringify(blocks)).not.toMatch(/(?:workflow|run)[-_]?[A-Za-z0-9]+/i);
    expect(blocks.identity.body).not.toMatch(/[ \t]+$/m);
    expect(blocks.voice?.body.indexOf("vs_sample01")).toBeLessThan(
      blocks.voice?.body.indexOf("vs_sample02") ?? 0,
    );
    expect(blocks.voice?.body).not.toContain("vs_sample06");
    expect(blocks.identity.bytes).toBe(Buffer.byteLength(blocks.identity.body));
  });

  it("enforces the per-block byte cap", () => {
    const sources = sourceFixture();
    const oversized = brandRenderedVoiceInput({
      ...sources.voice,
      protectedQuirks: Array.from({ length: 10 }, () => "x".repeat(2_000)),
    });
    expect(() => renderVoiceBlock(oversized)).toThrow(
      expect.objectContaining({
        code: "VALIDATION_ERROR",
        details: expect.objectContaining({ reason: "block_too_large" }),
      }),
    );
  });

  it("keeps sourceHash content-based while revisions remain auditable", () => {
    const sources = sourceFixture();
    const first = buildSourceSnapshot(sources, { self: 10, org: 20 });
    const touched = buildSourceSnapshot(sources, { self: 11, org: 21 });
    expect(computeSourceHash(first)).toBe(computeSourceHash(touched));
    expect(sourceRevisions(first)).toMatchObject({ self: 10, org: 20 });
    expect(sourceRevisions(touched)).toMatchObject({ self: 11, org: 21 });
  });

  it("produces identical hashes in a separate process", () => {
    const sources = sourceFixture();
    const snapshot = buildSourceSnapshot(sources, { self: 10, org: 20 });
    const expected = {
      sourceHash: computeSourceHash(snapshot),
      blocks: renderPersonalityBlocks(sources),
    };
    const runner = resolve(process.cwd(), "node_modules/vite-node/vite-node.mjs");
    const config = resolve(process.cwd(), "vitest.config.ts");
    const script = resolve(process.cwd(), "src/test/personality-render-child.ts");
    const actual = JSON.parse(execFileSync(process.execPath, [
      runner,
      "--config",
      config,
      script,
      JSON.stringify({ sources, revisions: { self: 10, org: 20 } }),
    ], { encoding: "utf8" }));
    expect(actual).toEqual(expected);
  });
});
