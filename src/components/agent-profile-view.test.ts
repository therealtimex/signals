import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentProfileView } from "@/components/agent-profile-view";
import { agentProfileMissingFields } from "@/lib/arpp/missing-fields";
import type { ArppPersonDocument } from "@/lib/arpp/types";

const profile: ArppPersonDocument = {
  $schema: "https://arpp.dev/schema/1.1/person.json",
  "@context": ["https://schema.org"],
  "@type": "Person",
  "@id": "signals:contact/c1#person",
  id: "urn:signals:contact:c1",
  spec: "arpp/1.1",
  meta: {
    version: "1.1.0",
    revision: 1,
    generatedAt: "2026-08-28T00:00:00.000Z",
    lastUpdated: "2026-08-28T00:00:00.000Z",
    visibility: "internal",
  },
  identity: { fullName: "Jordan Lee" },
  identifiers: [{ scheme: "signals", value: "c1", iri: "signals:contact/c1" }],
  sameAs: ["https://x.com/jordan"],
  profiles: [],
  competencies: [],
  experience: [],
  education: [],
  credentials: [],
  works: [],
  knowsAbout: [],
  signals: { contactId: "c1", enrichmentScore: 20, conformance: "L0" },
};

describe("AgentProfileView", () => {
  it("shows conformance, missing fields, copy control, and pretty JSON", () => {
    const html = renderToStaticMarkup(createElement(AgentProfileView, { profile }));
    expect(html).toContain("Agent view");
    expect(html).toContain("L0");
    expect(html).toContain("Missing for higher conformance");
    expect(html).toContain("At least one competency");
    expect(html).toContain("Copy JSON");
    expect(html).toContain("&quot;@type&quot;: &quot;Person&quot;");
  });

  it("derives an actionable checklist", () => {
    expect(agentProfileMissingFields(profile)).toEqual(
      expect.arrayContaining([
        "Experience or authored work",
        "At least one competency",
        "Grounded identifier (ORCID, Wikidata, or DID)",
      ]),
    );
  });
});
