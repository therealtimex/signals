/**
 * Synthetic seller context for #549 tests. No real names, handles or message bodies: the offering
 * is the spec §11 "engineering-workflow" case.
 */
export const PRODUCTS_FIXTURE = [
  "# PRODUCTS.md - Catalog",
  "",
  "Intro that is not an entry.",
  "",
  "---",
  "",
  "## 1. Engineering Workflow (Agent Runtime)",
  "",
  "- **Slug:** `engineering-workflow`",
  "- **Category:** Developer tooling",
  "- **One-Liner:** Agents that ship reviewable code in your own workspace.",
  "",
  "### Target ICP",
  "- **Primary Roles:** Technical founders",
  "",
  "### Value Propositions & Proof Points",
  "- **Local control:** Runs on the developer's machine.",
  "- **Real tools:** Terminals and browsers.",
  "  - a nested detail that is not a proof point",
  "",
  "### Commercials & Call to Action",
  "- **Primary CTA:** Download",
  "",
  "---",
  "",
  "## 2. Bare Offering",
  "",
  "- **Slug:** `bare-offering`",
  "",
  "## 3. Heading Without A Slug",
  "",
  "- **Category:** none",
  "",
].join("\n");

export const COMMERCIAL_BRIEF = [
  "## Outcome",
  "Agree to a 20-minute evaluation of @PRODUCTS.md#engineering-workflow.",
  "",
  "## Fit",
  "Technical founder hiring engineers.",
  "",
  "## Unknowns",
  "- Whether they use a coding agent today",
  "",
  "## Next step",
  "Ask which workflow they use for new hires.",
  "",
  "## Success",
  "A reply naming their current workflow.",
  "",
  "Tone follows @BRAND.md.",
].join("\n");

/**
 * A PRODUCTS.md whose `big-offering` entry runs past the 8 KiB excerpt cutoff, with its proof
 * points after the cutoff (Review #549 F1). `proofLines` replaces the proof bullets.
 */
export function bigProductsFixture(proofLines: string[] = ["- **Proven:** One proof point."]): string {
  const filler = Array.from({ length: 120 }, (_, index) =>
    `- **Detail ${index + 1}:** ${"Background on the offering that the excerpt still shows. ".repeat(1)}`);
  return [
    PRODUCTS_FIXTURE.trimEnd(),
    "",
    "## 4. Big Offering",
    "",
    "- **Slug:** `big-offering`",
    "- **One-Liner:** An entry long enough to be cut for display.",
    "",
    "### Background",
    ...filler,
    "",
    "### Value Propositions & Proof Points",
    ...proofLines,
    "",
  ].join("\n");
}
