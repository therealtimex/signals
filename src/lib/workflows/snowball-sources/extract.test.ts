import { describe, expect, it } from "vitest";
import { extractPublicSnowballSource } from "@/lib/workflows/snowball-sources/extract";
import { resolveSnowballSourceUrl } from "@/lib/workflows/snowball-sources/url";

describe("extractPublicSnowballSource", () => {
  it("classifies an evidenced generic /about page as an organization", () => {
    const source = resolveSnowballSourceUrl("https://metr.org/about?private=secret")!;
    const result = extractPublicSnowballSource({
      source,
      finalUrl: source.canonicalUrl,
      observedAt: 1_789_200_000,
      html: `<!doctype html><html><head>
        <title>About METR</title><meta name="description" content="A research nonprofit">
        <script>window.secret = "do-not-store"</script>
      </head><body><h1>About METR</h1><h2>Our team</h2>
        <p>We are a research organization.</p><a href="/team?token=hidden">Team</a>
      </body></html>`,
    });
    expect(result.resolvedSource).toMatchObject({
      provider: "generic",
      kind: "organization",
      classification: { basis: "visible_content", confidence: "medium" },
    });
    expect(result.envelope).toMatchObject({
      title: "About METR",
      canonicalUrl: "https://metr.org/about",
      scope: "public",
      observedAt: 1_789_200_000,
    });
    expect(result.envelope.links).toContainEqual({ label: "Team", url: "https://metr.org/team" });
    expect(JSON.stringify(result.envelope)).not.toContain("do-not-store");
    expect(JSON.stringify(result.envelope)).not.toContain("hidden");
  });

  it("prefers article metadata and extracts only bounded facts", () => {
    const source = resolveSnowballSourceUrl("https://example.com/news/launch")!;
    const result = extractPublicSnowballSource({
      source,
      finalUrl: source.canonicalUrl,
      html: `<html><head><script type="application/ld+json">{
        "@type":"NewsArticle","headline":"Launch","name":"Launch",
        "author":{"@type":"Person","name":"Ada Lovelace"},
        "datePublished":"2026-09-12"
      }</script></head><body><h1>Launch</h1></body></html>`,
    });
    expect(result.resolvedSource.kind).toBe("article");
    expect(result.envelope.facts).toContainEqual({ label: "author", value: "Ada Lovelace" });
    expect(result.envelope.facts.length).toBeLessThanOrEqual(12);
  });
});
