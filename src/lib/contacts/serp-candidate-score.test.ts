import { describe, expect, it } from "vitest";
import { scoreSerpCandidates } from "@/lib/contacts/serp-candidate-score";

const contact = {
  name: "Ryan Carson",
  company: "Untangle",
  title: "Founder & CEO",
  website: "https://untangle.ai",
};

describe("scoreSerpCandidates", () => {
  it("ranks a matching LinkedIn profile above a news result", () => {
    const result = scoreSerpCandidates(contact, [
      {
        url: "https://www.forbes.com/news/ryan-carson-interview/",
        title: "Interview with Ryan Carson",
        snippet: "Untangle founder discusses the market",
      },
      {
        url: "https://www.linkedin.com/in/ryancarson/",
        title: "Ryan Carson - Founder & CEO",
        snippet: "Founder & CEO at Untangle",
      },
    ]);

    expect(result.candidates[0]).toMatchObject({
      url: "https://www.linkedin.com/in/ryancarson/",
      urlScore: 100,
      textScore: 70,
      totalScore: 170,
    });
    expect(result.candidates[1].totalScore).toBeLessThan(result.candidates[0].totalScore);
    expect(result.ambiguous).toBe(false);
  });

  it("penalizes a profile result that names a different person", () => {
    const result = scoreSerpCandidates(contact, [
      {
        url: "https://www.linkedin.com/in/alex-chen/",
        title: "Alex Chen - Founder & CEO",
        snippet: "Founder & CEO at Untangle",
      },
    ]);

    expect(result.candidates[0].textScore).toBe(-40);
    expect(result.candidates[0].reason).toContain("different-person penalty");
    expect(result.ambiguous).toBe(false);
  });

  it("marks close profile candidates as ambiguous for refined triage", () => {
    const result = scoreSerpCandidates(contact, [
      {
        url: "https://www.linkedin.com/in/ryan-carson-a/",
        title: "Ryan Carson - Founder",
        snippet: "Founder at Untangle",
      },
      {
        url: "https://www.linkedin.com/in/ryan-carson-b/",
        title: "Ryan Carson - CEO",
        snippet: "CEO at Untangle",
      },
    ]);

    expect(result.candidates[0].totalScore - result.candidates[1].totalScore).toBeLessThanOrEqual(15);
    expect(result.ambiguous).toBe(true);
  });

  it("requires a refined search when nothing clears the visit threshold", () => {
    const result = scoreSerpCandidates(contact, [
      {
        url: "https://example.net/people",
        title: "People directory",
        snippet: "Unrelated listing",
      },
    ]);

    expect(result.candidates[0].totalScore).toBeLessThan(60);
    expect(result.ambiguous).toBe(true);
  });
});
