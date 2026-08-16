import { describe, expect, it } from "vitest";
import {
  isPersonaAgeStale,
  isPersonaEvidenceStale,
  isPersonaStale,
  PERSONA_STALE_AFTER_SECONDS,
  parseStoredEvidenceHash,
} from "@/lib/persona/staleness";

describe("persona staleness", () => {
  it("exports a 30-day default threshold", () => {
    expect(PERSONA_STALE_AFTER_SECONDS).toBe(30 * 24 * 60 * 60);
  });

  it("detects age and evidence drift independently", () => {
    const now = 2_000_000_000;
    const generatedAt = now - PERSONA_STALE_AFTER_SECONDS - 1;

    expect(isPersonaAgeStale(generatedAt, now)).toBe(true);
    expect(isPersonaEvidenceStale("old", "new")).toBe(true);
    expect(parseStoredEvidenceHash(JSON.stringify({ evidenceHash: "abc" }))).toBe("abc");

    const fresh = isPersonaStale({
      generatedAt: now - 100,
      sourceWindow: JSON.stringify({ evidenceHash: "same" }),
      evidenceHash: "same",
      now,
    });
    expect(fresh).toEqual({ stale: false, ageStale: false, evidenceStale: false });

    const ageOnly = isPersonaStale({
      generatedAt,
      sourceWindow: JSON.stringify({ evidenceHash: "same" }),
      evidenceHash: "same",
      now,
    });
    expect(ageOnly.stale).toBe(true);
    expect(ageOnly.ageStale).toBe(true);
    expect(ageOnly.evidenceStale).toBe(false);
  });
});
