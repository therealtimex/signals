import { describe, expect, it } from "vitest";
import {
  buildContactWebResearchQuery,
  buildContactWebResearchRefinedQuery,
  buildGoogleSearchUrl,
} from "@/lib/contacts/web-research-query";

describe("contact web research queries", () => {
  it("builds a disambiguated name, company, and title query", () => {
    expect(
      buildContactWebResearchQuery({
        name: "  Ryan Carson ",
        company: "Untangle",
        title: "Founder & CEO",
      }),
    ).toBe("Ryan Carson Untangle · Founder & CEO");
  });

  it("drops a headline that repeats title and company", () => {
    expect(
      buildContactWebResearchQuery({
        name: "Sam Altman",
        company: "OpenAI",
        title: "CEO",
        headline: "CEO at OpenAI",
        location: "San Francisco",
      }),
    ).toBe("Sam Altman OpenAI · CEO San Francisco");
  });

  it("keeps a distinct headline and appends location within the hop-zero budget", () => {
    expect(
      buildContactWebResearchQuery({
        name: "Ada Lovelace",
        company: "Analytical Engines",
        headline: "Computing pioneer",
        location: "London",
      }),
    ).toBe("Ada Lovelace Analytical Engines Computing pioneer London");
  });

  it("builds a quoted refined LinkedIn query and an encoded Google URL", () => {
    const query = buildContactWebResearchRefinedQuery("Ryan Carson", "Untangle");
    expect(query).toBe('"Ryan Carson" "Untangle" linkedin');
    expect(buildGoogleSearchUrl(query)).toBe(
      "https://www.google.com/search?q=%22Ryan%20Carson%22%20%22Untangle%22%20linkedin",
    );
  });
});
