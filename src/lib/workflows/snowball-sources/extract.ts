import * as cheerio from "cheerio";
import type {
  PublicSnowballSourceEnvelope,
  ResolvedSnowballSource,
  SnowballSourceKind,
} from "@/lib/workflows/snowball-sources/types";
import { refineSnowballSource, resolveSnowballSourceUrl } from "@/lib/workflows/snowball-sources/url";

const MAX_FACTS = 12;
const MAX_LINKS = 20;
const MAX_VALUE_LENGTH = 500;

function clean(value: string | undefined | null, max = MAX_VALUE_LENGTH): string {
  return (value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function jsonLdObjects($: cheerio.CheerioAPI): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  $('script[type="application/ld+json"]').each((_index, element) => {
    try {
      const value = JSON.parse($(element).text()) as unknown;
      const values = Array.isArray(value) ? value : [value];
      for (const item of values) {
        if (!item || typeof item !== "object" || Array.isArray(item)) continue;
        const graph = (item as Record<string, unknown>)["@graph"];
        if (Array.isArray(graph)) {
          found.push(...graph.filter((entry): entry is Record<string, unknown> => (
            Boolean(entry) && typeof entry === "object" && !Array.isArray(entry)
          )));
        } else {
          found.push(item as Record<string, unknown>);
        }
      }
    } catch {
      // Malformed metadata is not evidence.
    }
  });
  return found;
}

function schemaTypes(value: unknown): string[] {
  return (Array.isArray(value) ? value : [value])
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.toLowerCase());
}

function classifyGeneric(
  source: ResolvedSnowballSource,
  objects: Record<string, unknown>[],
  visibleText: string,
): ResolvedSnowballSource {
  const types = objects.flatMap((item) => schemaTypes(item["@type"]));
  let kind: SnowballSourceKind = "unknown";
  if (types.some((type) => type.includes("article") || type === "newsarticle")) kind = "article";
  else if (types.some((type) => type === "organization" || type.endsWith("organization"))) kind = "organization";
  else if (types.some((type) => type === "person")) kind = "profile";
  else if (types.some((type) => type === "event")) kind = "event";
  if (kind !== "unknown") return refineSnowballSource(source, kind, "metadata", "high");

  const path = new URL(source.canonicalUrl).pathname.toLowerCase();
  const organizationEvidence = /\b(?:our (?:team|mission|company)|leadership|who we are|about us|founded in|nonprofit|research organization)\b/i.test(visibleText);
  if ((path === "/about" || path.startsWith("/about/")) && organizationEvidence) {
    return refineSnowballSource(source, "organization", "visible_content", "medium");
  }
  if (/\b(?:published|written by|author|reading time)\b/i.test(visibleText)) {
    return refineSnowballSource(source, "article", "visible_content", "medium");
  }
  return refineSnowballSource(source, "page", "fallback", "low");
}

export function extractPublicSnowballSource(input: {
  source: ResolvedSnowballSource;
  finalUrl: string;
  html: string;
  observedAt?: number;
}): { resolvedSource: ResolvedSnowballSource; envelope: PublicSnowballSourceEnvelope } {
  const resolvedFinal = resolveSnowballSourceUrl(input.finalUrl);
  const finalSource = resolvedFinal?.canonicalUrl === input.source.canonicalUrl
    ? input.source
    : resolvedFinal ?? input.source;
  const $ = cheerio.load(input.html);
  $("script:not([type='application/ld+json']),style,noscript,template,svg").remove();
  const objects = jsonLdObjects($);
  $("script").remove();
  const visibleText = clean($("body").text(), 12_000);
  const source = finalSource.provider === "generic"
    ? classifyGeneric(finalSource, objects, visibleText)
    : finalSource;
  const title = clean(
    $('meta[property="og:title"]').attr("content")
      || $("title").first().text()
      || objects.find((item) => typeof item.name === "string")?.name as string
      || new URL(source.canonicalUrl).hostname,
    200,
  );
  const facts: PublicSnowballSourceEnvelope["facts"] = [];
  const addFact = (label: string, value: unknown) => {
    if (facts.length >= MAX_FACTS || typeof value !== "string") return;
    const cleaned = clean(value);
    if (cleaned && !facts.some((fact) => fact.label === label && fact.value === cleaned)) {
      facts.push({ label, value: cleaned });
    }
  };
  addFact("description", $('meta[name="description"]').attr("content") || $('meta[property="og:description"]').attr("content"));
  for (const item of objects) {
    addFact("name", item.name);
    addFact("description", item.description);
    addFact("author", typeof item.author === "string" ? item.author : (item.author as Record<string, unknown> | undefined)?.name);
    addFact("date published", item.datePublished);
  }
  $("h1,h2").slice(0, 6).each((_index, element) => addFact("section", $(element).text()));

  const links: PublicSnowballSourceEnvelope["links"] = [];
  $("a[href]").each((_index, element) => {
    if (links.length >= MAX_LINKS) return false;
    try {
      const resolved = resolveSnowballSourceUrl(new URL($(element).attr("href")!, source.canonicalUrl).toString());
      if (!resolved || links.some((link) => link.url === resolved.canonicalUrl)) return;
      links.push({ label: clean($(element).text(), 120) || resolved.provider, url: resolved.canonicalUrl });
    } catch {
      // Ignore malformed and non-HTTPS links.
    }
  });

  return {
    resolvedSource: source,
    envelope: {
      version: 1,
      canonicalUrl: source.canonicalUrl,
      title,
      provider: source.provider,
      kind: source.kind,
      observedAt: input.observedAt ?? Math.floor(Date.now() / 1000),
      extractor: "signals:snowball-source:v1",
      scope: "public",
      facts,
      links,
    },
  };
}
