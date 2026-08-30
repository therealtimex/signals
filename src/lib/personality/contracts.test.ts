import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { ContactDTO } from "@/lib/db/queries/contact-dto";
import type { Org } from "@/lib/db/types";
import {
  PERSONALITY_BLOCK_MAX_BYTES,
  PERSONALITY_SECTIONS,
  PRESENCE_MANDATE_MODES,
  brandRenderedIdentityInput,
  markerEnd,
  markerStart,
  presenceMandateSchema,
  renderedIdentityInputSchema,
  renderedVoiceInputSchema,
} from "@/lib/personality/contracts";
import {
  renderBrandBlock,
  renderIdentityBlock,
  renderVoiceBlock,
} from "@/lib/personality/render";
import type { VoiceProfile } from "@/lib/writing/contracts";

const HASH = "a".repeat(64);
const rawIdentity = {
  contactId: "contact-1",
  name: "Ada Lovelace",
  preferredName: "Ada",
  headline: "Builder",
  bio: "Computing pioneer",
  currentRole: { title: "Founder", orgName: "Analytical Engines" },
  website: "https://example.com",
  profiles: [{ network: "x", url: "https://x.com/ada", displayName: "Ada" }],
  representedOrgName: null,
};

describe("personality contracts", () => {
  it("requires opaque branded renderer inputs at compile time", () => {
    const structurallyIdentical = renderedIdentityInputSchema.parse(rawIdentity);
    const richContact = null as unknown as ContactDTO;
    const richOrg = null as unknown as Org;
    const richVoice = null as unknown as VoiceProfile;
    if (false) {
      // @ts-expect-error Only the strict adapter may brand renderer input.
      renderIdentityBlock(structurallyIdentical);
      // @ts-expect-error Rich DB rows can never cross the renderer boundary.
      renderIdentityBlock(richContact);
      // @ts-expect-error Rich DB rows can never cross the renderer boundary.
      renderBrandBlock(richOrg);
      // @ts-expect-error Rich voice documents can never cross the renderer boundary.
      renderVoiceBlock(richVoice);
    }
    expect(renderIdentityBlock(brandRenderedIdentityInput(rawIdentity)).body).toContain("Ada");
  });

  it("keeps Personality modules free of write and host-runtime imports", () => {
    const root = resolve(process.cwd(), "src/lib/personality");
    const modules = readdirSync(root)
      .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"));
    for (const name of modules) {
      const source = readFileSync(join(root, name), "utf8");
      expect(source, name).not.toMatch(
        /import[\s\S]*?from ["']node:fs["'][\s\S]*?\b(?:writeFile|rename|link|unlink|rm|mkdir)Sync?\b/,
      );
      expect(source, name).not.toMatch(/from ["']@\/lib\/(?:rtx|publish)\//);
    }
  });

  it("rejects unknown keys at nested allowlist boundaries", () => {
    expect(renderedIdentityInputSchema.safeParse({
      ...rawIdentity,
      extra: "private",
    }).success).toBe(false);
    expect(renderedIdentityInputSchema.safeParse({
      ...rawIdentity,
      currentRole: { ...rawIdentity.currentRole, extra: "private" },
    }).success).toBe(false);
    expect(renderedIdentityInputSchema.safeParse({
      ...rawIdentity,
      profiles: [{ ...rawIdentity.profiles[0], extra: "private" }],
    }).success).toBe(false);
    expect(renderedVoiceInputSchema.safeParse({
      profile: { id: "vp_profile1", label: "Primary", version: 1, hash: HASH },
      platforms: ["x"],
      sentenceLength: null,
      openers: [],
      closers: [],
      punctuation: [],
      formats: [],
      emoji: [],
      hashtags: [],
      vocabulary: { keep: [], avoid: [] },
      protectedQuirks: [],
      taboo: [],
      signatureLines: [{ id: "vs_sample01", text: "line", extra: "private" }],
      exemplars: [],
    }).success).toBe(false);
  });

  it("pins section paths, markers, block size, and assist-only mandate mode", () => {
    expect(PERSONALITY_SECTIONS).toEqual({
      identity: "IDENTITY.md",
      boundaries: "SOUL.md",
      voice: "VOICE.md",
      brand: "BRAND.md",
      index: "AGENTS.md",
    });
    expect(PERSONALITY_BLOCK_MAX_BYTES).toBe(16_384);
    expect(markerStart("voice", "pb_binding1", HASH)).toBe(
      "<!-- signals:personality:voice:start v=1 binding=pb_binding1 source=aaaaaaaaaaaa -->",
    );
    expect(markerStart("index", "pb_binding1", HASH)).toBe(
      "<!-- signals:personality:index:start v=1 binding=pb_binding1 -->",
    );
    expect(markerEnd("voice")).toBe("<!-- signals:personality:voice:end -->");
    expect(PRESENCE_MANDATE_MODES).toEqual(["assist_only"]);

    const mandate = {
      schemaVersion: 1,
      id: "pm_mandate1",
      workspaceKey: "workspace",
      mode: "assist_only",
      targets: [{ targetId: "target-1", actions: ["draft"] }],
      cadence: null,
      approvalPolicy: "explicit",
      updatedAt: 1,
      hash: HASH,
    };
    expect(presenceMandateSchema.safeParse(mandate).success).toBe(true);
    expect(presenceMandateSchema.safeParse({ ...mandate, cadence: "daily" }).success).toBe(false);
    expect(presenceMandateSchema.safeParse({
      ...mandate,
      targets: [{ targetId: "target-1", actions: ["publish"] }],
    }).success).toBe(false);
  });
});
