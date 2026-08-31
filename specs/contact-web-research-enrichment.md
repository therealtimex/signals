# Contact Web Research Enrichment (ARPP-targeted)

**Status:** draft (spec for implementation)
**Date:** 2026-08-29
**Base:** `main` @ `a3f3371` (ARPP/AROO #358)
**Parents:** [`arpp-signals-projection.md`](./arpp-signals-projection.md), [`agent-readable-person-profile.md`](./agent-readable-person-profile.md), [`docs/rtx-agent-browser-enrichment.md`](../docs/rtx-agent-browser-enrichment.md)
**Mirror:** Company Profile Enrichment (`COMPANY_PROFILE_ENRICHMENT_TEMPLATE_NAME`, `POST /api/orgs/:id/enrich`)
**Authenticated target follow-up:** [`contact-enrich-profile-authenticated-target.md`](./contact-enrich-profile-authenticated-target.md) (#384)

---

## 1. Problem

**Enrich profile** on contact detail runs **Contact Profile Pipeline** (hydrate X → avatars → persona). That path needs platform identities and cannot fill sparse contacts (name + company, **0 identities**).

**Company Profile Enrichment** already dispatches an RTX terminal agent with a cited browser-research contract. People need the same lane, with **ARPP** as the read target and `get_contact_arpp` as the gap checklist.

**Out of scope:** in-process Serper/Tavily (`search-web.ts`), ARPP `mergeArppIntoContact` import, competency/education tables.

---

## 2. Product behavior — smart router

Replace the single **Enrich profile** action with a router (one primary button; optional secondary in v2).

| Condition | Action | Backend |
|-----------|--------|---------|
| `identities.length === 0` **OR** `enrichmentScore < 40` **OR** ARPP `sameAs.length === 0` | **Research on web** (primary) | `Contact Web Research` template via `runTemplateViaRtx` |
| Has primary platform identity **AND** `enrichmentScore >= 40` **AND** (missing avatar **OR** missing persona) | **Hydrate & persona** (secondary or auto-chain) | Existing Contact Profile Pipeline |
| `contact.isSelf` or archived | Disabled | — |

**Auto-chain (recommended):** After web research `complete_workflow_run` with `result.identityLinked === true`, Signals dispatches Profile Pipeline for the same `contactId` (same pattern as workflow cascade).

**Ryan Carson example:** 0 identities, score 20 → web research only until LinkedIn/X is linked.

---

## 3. Seeded template

```ts
export const CONTACT_WEB_RESEARCH_TEMPLATE_NAME = "Contact Web Research";
```

The technical template name remains **Contact Web Research**. Its persistent RealTimeX thread is
displayed as **Contact Enrich Profile** and is converged in place on every run; see ADR-384-9.

| Field | Value |
|-------|--------|
| `templateType` | `enrichment` |
| `estimatedCost` | `0.2` |
| `config` | `{ contactWebResearch: { version: 2 }, acceptsContactId: true }` |
| `systemPrompt` | See §6 (full agent contract) |

Seed via `seed-templates.ts` with `SEED_VERSION` bump. Do **not** remove Contact Profile Pipeline.

---

## 4. Query builder

Deterministic disambiguation string for RTX Browser Google search (hop 0).

```ts
// src/lib/contacts/web-research-query.ts

export type ContactWebResearchQueryInput = {
  name: string;
  company?: string | null;
  title?: string | null;
  headline?: string | null;
  location?: string | null;
};

export function buildContactWebResearchQuery(input: ContactWebResearchQueryInput): string {
  const parts: string[] = [];
  const name = input.name.trim();
  if (name) parts.push(name);

  const company = input.company?.trim();
  const title = input.title?.trim();
  const headline = input.headline?.trim();

  if (company && title) {
    parts.push(`${company} · ${title}`);
  } else if (company) {
    parts.push(company);
  } else if (title) {
    parts.push(title);
  }

  // Headline only when not redundant with title+company (reuse isRedundantHeadline)
  if (headline && !isRedundantHeadline(headline, title, company)) {
    parts.push(headline);
  }

  const location = input.location?.trim();
  if (location && parts.length < 4) parts.push(location);

  return parts.join(" ").replace(/\s+/g, " ").trim();
}

export function buildGoogleSearchUrl(query: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}
```

**Brief injection:** `buildContactWebResearchBriefSection` adds:

```markdown
## Pre-filled search
Query: `Ryan Carson Untangle · Founder & CEO`
URL: https://www.google.com/search?q=...
Open this in RealTimeX Browser (hop 0). Do not use in-app Serper/Tavily APIs.
```

---

## 5. Multihop policy — scored triage, not mechanical SERP rank

Signals does **not** crawl profile pages in-process. It **does** own query building, candidate scoring, ambiguity detection, and brief injection so the terminal agent visits **high-confidence URLs**, not “positions 1–2.”

### 5.1 Identity-first shortcut (before Google)

If the contact already has `profileUrl`, a primary identity `platformUrl`, or a high-confidence channel URL:

1. Skip Google.
2. Navigate directly to that profile URL (hop 1).
3. Only fall back to search when the direct fetch fails or identity remains unlinked.

### 5.2 Hop 0a — search

- `buildContactWebResearchQuery()` → `buildGoogleSearchUrl()`
- Agent opens URL in RealTimeX Browser (not Serper/Tavily).

### 5.3 Hop 0b — SERP triage (required before any profile navigation)

Agent snapshots the SERP and builds a **structured candidate list** (write to `workflow-runs/{runId}/serp-candidates.json`):

```json
{
  "query": "Ryan Carson Untangle · Founder & CEO",
  "candidates": [
    {
      "url": "https://www.linkedin.com/in/...",
      "title": "Ryan Carson - Dad, Dev, CEO ...",
      "snippet": "Greater Hartford · Founder & CEO · Untangle",
      "source": "organic",
      "urlScore": 100,
      "textScore": 55,
      "totalScore": 155,
      "reason": "linkedin /in/; name+company+role in snippet"
    }
  ],
  "aiOverviewUrls": ["https://..."],
  "ambiguous": false
}
```

**Signals-owned scorer** (`src/lib/contacts/serp-candidate-score.ts`) — same rules in code and brief:

| Signal | Score |
|--------|-------|
| `linkedin.com/in/` | +100 |
| `x.com/` / `twitter.com/` profile path | +80 |
| Registrable domain matches `contact.company` | +70 |
| `crunchbase.com/person` | +50 |
| Wikipedia / Wikidata person | +40 |
| News, directories, “people also search” | −50 |

**Snippet / title match** (on normalized contact name, company, title):

| Signal | Score |
|--------|-------|
| Full name in result title | +30 |
| Company in snippet | +25 |
| Role keywords in snippet | +15 |
| Snippet suggests different person | −80 |

Agent may apply `scoreSerpCandidates(contact, candidates)` from the brief (deterministic). Optional **LLM rerank** on title+snippet only when top two deterministic scores are within 15 points — no extra page loads.

**AI Overview:** treat as extra URLs in the candidate pool; never write bio from Overview without opening a cited page.

### 5.4 Hop 1 — visit scored candidates (not SERP position)

- Visit URLs with `totalScore >= 60` (configurable threshold in brief).
- Default **K = 1** profile URL (LinkedIn or X); **K = 2** only when first visit fails to link identity.
- Company `/about` or `/team` is hop 2, not hop 1, unless no profile candidate scored above threshold.

### 5.5 Ambiguity and second search

When triage finds:

- No candidate `>= 60`, **or**
- Top two profile candidates within 15 points and both look like different humans

Then:

1. Do **not** `upsert_contact_identity` from guesswork.
2. Run **one** refined query: `"${name}" "${company}" linkedin` (Signals provides `buildContactWebResearchRefinedQuery()`).
3. Re-triage; if still ambiguous → `complete_workflow_run` with `result.ambiguous: true`, `partial: true`, `unresolvedFields: ["sameAs"]`.

### 5.6 Hop budget (caps, not ranking)

| Rule | Limit |
|------|-------|
| Max Google searches | 2 (primary + one refined) |
| Max page visits after SERP | 3 |
| Max distinct registrable domains | 2 |
| Wall clock | 120s recommended |
| Same domain | One profile page; optional one `/about` or `/team` |

### 5.7 Stop conditions

Identity linking and scalar enrichment are not stop conditions while a matching LinkedIn profile
still has required sections left to inspect. Before completion, inspect visible About, Contact info,
and the complete visible Experience section (including the same-profile Show all control and its
resulting details view). Stop when:

- Known-identity and missing-LinkedIn discovery have been attempted and all accessible required
  sections on every matching LinkedIn profile have been inspected
- An inaccessible section is named in `unresolvedFields` and the result is marked partial
- Ambiguity is declared after the second search
- Hop budget is exhausted and the result is marked partial

Do **not** pursue ARPP L2/L3 (ORCID, VC, signed proof) in v2.

### 5.8 Evidence rules

- Write only fields visible on the visited page (no AI Overview copy without opening a cited source).
- Company template parity: every `update_org` / employment write cites `evidenceUrl` in provenance where the tool supports it; use `log_interaction` summary with URLs.
- Mine every visible LinkedIn Experience entry through `enrich_contact.employmentObservations`.
  Upserts are additive and deduplicate incomplete existing roles by organization plus title.
- Mine only explicitly self-published email addresses through `enrich_contact.observedEmails`,
  including the evidence URL and exact visible sentence. Store these as unverified contact channels:
  source confirmation is not mailbox or deliverability verification.
- Report `verifiedProfileUrls`, `profileSectionsInspected`, `emailsObserved`, and
  `experiencesUpserted` so skipped sections and no-op runs are observable.

---

## 6. Agent system prompt (seed `systemPrompt`)

```markdown
You are a contact web research agent operating Signals through agent tools and RealTimeX Browser.

## Contract
1. Read `config.contactId` and call `get_contact` then `get_contact_arpp` (visibility: internal) before browsing.
2. Note `signals.conformance` and missing ARPP gaps (sameAs, experience, biography). A non-empty experience list is only a gap signal; it does not mean the verified LinkedIn career history has been mined.
3. Identity-first: if the contact already has profileUrl or a primary identity URL, open that page before Google.
4. Hop 0a: open the pre-filled Google search URL from the brief (RealTimeX Browser + agent-browser skill).
5. Hop 0b (required): snapshot the SERP, extract title/snippet/url for each visible result plus AI Overview cited URLs. Write `workflow-runs/{runId}/serp-candidates.json`. Score each candidate using the brief rules (or `scoreSerpCandidates` helper). Do not navigate to profile pages until triage completes.
6. Hop 1: visit only candidates with totalScore >= 60 — not SERP position 1–2. Prefer LinkedIn `/in/` or X profile. Call `upsert_contact_identity` only when the page confirms the same human (name + company/role alignment).
7. If triage is ambiguous or no candidate clears threshold, run one refined search (`buildContactWebResearchRefinedQuery`) and re-triage. If still ambiguous, stop without linking — set `ambiguous: true`.
8. Before leaving every matching LinkedIn profile, inspect visible About, Contact info when available, and complete visible Experience, including the same-profile Show all control and its resulting details view.
9. Mine all visible roles with `enrich_contact.employmentObservations`. Include organization, title, current/former state, evidence URL, and dates as UTC Unix seconds only when explicitly shown precisely enough. Never delete history absent from the page.
10. Mine exact self-published emails with `enrich_contact.observedEmails`, including the evidence URL and exact visible sentence. Never infer email or mark source confirmation as mailbox verification.
11. Hop 2 (optional): company homepage or team/about when employment still empty after profile mining. Use `link_contact_to_org` or `enrich_contact`; `get_org_aroo` when orgId exists.
12. Fill scalar gaps with `enrich_contact` (never overwrite existing non-empty scalar fields).
13. Log provenance: `log_interaction` with cited URLs.
14. Do not use Signals in-process Serper/Tavily.
15. Report `fieldsUpdated`, `unresolvedFields`, `identityLinked`, `verifiedProfileUrls`, `profileSectionsInspected`, `emailsObserved`, `experiencesUpserted`, `visitedUrls`, `serpCandidates` (top 5 scored), `ambiguous`, then `complete_workflow_run`.
16. Set `result.partial=true` when any source or required profile section failed, the hop budget was exhausted, or ambiguity remains unresolved.
17. Always call `complete_workflow_run` before ending the turn so Signals can release runtime resources and chain follow-on workflows.
```

---

## 7. Brief extension

```ts
// src/lib/workflows/contact-web-research.ts

export const CONTACT_WEB_RESEARCH_CONFIG_KEY = "contactWebResearch";

export function isContactWebResearchTemplateConfig(
  config: Record<string, unknown>,
): boolean {
  return (
    typeof config.contactWebResearch === "object" &&
    config.contactWebResearch !== null
  );
}

export function buildContactWebResearchBriefSection(input: {
  workflowRunId: string;
  config: Record<string, unknown>;
  signalsBaseUrl: string;
  contact: Pick<ContactWithIdentities, "id" | "name" | "company" | "title" | "headline" | "location" | "enrichmentScore">;
  arppMissing: string[];
}): string {
  const query = buildContactWebResearchQuery({ ... });
  const googleUrl = buildGoogleSearchUrl(query);
  return [
    "## Contact web research",
    `Contact ID: ${contact.id}`,
    `Enrichment score: ${contact.enrichmentScore}`,
    `ARPP gaps to prioritize: ${arppMissing.join("; ") || "none listed"}`,
    "",
    "### Hop 0a — search",
    `Query: \`${query}\``,
    `URL: ${googleUrl}`,
    "",
    "### Hop 0b — SERP triage (before profile navigation)",
    "- Snapshot SERP; write workflow-runs/${workflowRunId}/serp-candidates.json",
    "- Score each result (URL + title/snippet match); visit score >= 60, not position 1–2",
    "- LLM rerank snippets only if top two scores within 15 points",
    "- Refined query if ambiguous: buildContactWebResearchRefinedQuery(name, company)",
    "",
    "### Hop policy",
    "- Identity-first: skip Google when profileUrl or primary identity URL exists",
    "- Max 2 Google searches; max 3 profile page visits; max 2 registrable domains",
    "- Stop when identity linked, bio+headline filled, or ambiguous after refined search",
    "",
    "### Tool sequence",
    "1. get_contact_arpp → 2. RTX Browser SERP → 3. upsert_contact_identity → 4. enrich_contact → 5. link_contact_to_org (if needed) → 6. log_interaction → 7. complete_workflow_run",
  ].join("\n");
}
```

Wire into `buildAgentWorkflowBrief` like `buildNetworkSnowballBriefSection`.

`getTemplateToolsHint` for this template type should include: `get_contact_arpp`, `upsert_contact_identity`, `enrich_contact`, `link_contact_to_org`, `log_interaction`, `complete_workflow_run`.

---

## 8. Button dispatch (mirror org enrich)

### 8.1 API routes

| Method | Path | Behavior |
|--------|------|----------|
| `GET` | `/api/contacts/:id/web-research` | `getContactWebResearchState(contactId)` |
| `POST` | `/api/contacts/:id/web-research` | Start enrichment run |

**POST handler** (same structure as `src/app/api/orgs/[id]/enrich/route.ts`):

```ts
seedTemplates();
const state = getContactWebResearchState(id);
if (state.status === "pending") return 409 ENRICHMENT_IN_PROGRESS;

const template = getSystemTemplateByName(CONTACT_WEB_RESEARCH_TEMPLATE_NAME)!;
const result = await runTemplateViaRtx({
  templateId: template.id,
  config: { contactId: id },
  signalsBaseUrl: resolveSignalsBaseUrlFromRequest(req),
});
return 202 { workflowRunId, threadPath };
```

### 8.2 State helper

```ts
// src/lib/contacts/web-research-state.ts

export type ContactWebResearchState = {
  status: "idle" | "pending" | "succeeded" | "partial" | "failed";
  workflowRunId: string | null;
  lastRunAt: number | null;
  fieldsUpdated: string[];
  unresolvedFields: string[];
  identityLinked: boolean;
  visitedUrls: string[];
  message: string | null;
};

export function getContactWebResearchState(contactId: string): ContactWebResearchState;
export function shouldRunWebResearch(contact: ContactWithIdentities, arpp?: ArppPersonDocument): boolean;
```

Resolve latest run: `listWorkflowRuns({ templateId })` where `config.contactId === contactId`.

Parse `complete_workflow_run` result:

```json
{
  "fieldsUpdated": ["bio", "headline"],
  "unresolvedFields": ["experience"],
  "identityLinked": true,
  "visitedUrls": ["https://www.linkedin.com/in/...", "https://untangle.ai/about"],
  "partial": false,
  "ambiguous": false,
  "serpCandidates": [
    { "url": "https://www.linkedin.com/in/...", "totalScore": 155, "reason": "linkedin; name+company in snippet" }
  ],
  "message": "Linked LinkedIn; bio from profile page."
}
```

### 8.3 UI

**`EnrichContactButton`** (mirror `enrich-company-button.tsx`):

- Poll `GET /api/contacts/:id/web-research` every 5s while `pending`
- Labels: Enrich profile / Enriching… / Continue enrichment / Retry enrichment

**`contact-detail-client.tsx` router:**

```ts
const needsWebResearch = shouldRunWebResearch(contact, arppPreview);
const canPipeline = hasProfilePipelineTemplate && !needsWebResearch && hasIdentity;

// Primary button:
needsWebResearch ? POST web-research : handleRunProfilePipeline()
```

Optional: split button — **Research on web** | **Hydrate & persona** (dropdown).

---

## 9. Post-complete cascade

In `complete_workflow_run` handler (or workflow-events), when:

- template config has `contactWebResearch`
- `result.identityLinked === true`
- Profile Pipeline template exists

→ enqueue Profile Pipeline for `config.contactId` with `cascadePolicy: immediate` (same as other follow-ons).

---

## 10. Agent tool sequence (reference)

```
get_contact(contactId)
get_contact_arpp(contactId, visibility: internal)
  → read signals.conformance, sameAs, identity.biography

[RTX Browser]
  navigate(googleSearchUrl)           # hop 0a (skip if identity-first URL exists)
  snapshot SERP → serp-candidates.json # hop 0b triage + scoreSerpCandidates
  navigate(bestScoredProfileUrl)      # hop 1 (score >= 60, not SERP rank)
  snapshot / extract profile fields
  [optional] refined Google search if ambiguous
  [optional] navigate(companyAboutUrl) # hop 2

upsert_contact_identity({
  contactId, platform: "linkedin", platformUrl, platformUserId|handle,
  headline, bio, avatarUrl
})
enrich_contact({ contactId, bio, headline, title, company, website, location })
link_contact_to_org({ contactId, orgId, title, isCurrent: true })  # if employment gap
log_interaction({ contactId, interactionType: "note", summary: "Web research: ..." })

complete_workflow_run({
  runId, status: "completed",
  summary: "...",
  result: { fieldsUpdated, unresolvedFields, identityLinked, visitedUrls, partial }
})
```

---

## 11. Tests

| Area | Cases |
|------|--------|
| `buildContactWebResearchQuery` | name+company+title; redundant headline stripped; location appended |
| `buildContactWebResearchRefinedQuery` | quoted name+company+linkedin |
| `scoreSerpCandidates` | linkedin beats news; wrong-person snippet penalized; ambiguity when top two close |
| `shouldRunWebResearch` | 0 identities → true; score 80 + linkedin → false |
| `getContactWebResearchState` | pending run; partial with unresolvedFields |
| `POST /api/contacts/:id/web-research` | 202; 409 when pending; 404 contact |
| Brief section | contains Google URL and contactId |
| Cascade | identityLinked → pipeline child run created |

---

## 12. Implementation checklist

- [ ] `CONTACT_WEB_RESEARCH_TEMPLATE_NAME` + seed prompt (§6)
- [ ] `web-research-query.ts` (primary + refined queries), `serp-candidate-score.ts`, `web-research-state.ts`, `contact-web-research.ts`
- [ ] `buildContactWebResearchBriefSection` + `template-brief.ts` wiring
- [ ] `GET/POST /api/contacts/[id]/web-research`
- [ ] `EnrichContactButton` + contact detail router
- [ ] `complete_workflow_run` result fields + optional pipeline cascade
- [ ] `docs/rtx-agent-browser-enrichment.md` — contact path documents ARPP + router
- [ ] `docs/agent-tools.md` — note template dispatch, not new tools

---

## 13. Routing message (unchanged)

Uses existing `buildWorkflowRunBriefRoutingMessage` → agent reads `workflow-runs/{runId}/brief.md`.

Example routing line:

```
Signals workflow handoff -> Contact Web Research
Run: #3 (mJx…)
File: @/path/to/workflow-runs/mJx…/brief.md
```

Agent loads brief → follows §6 + hop policy + pre-filled Google URL.
