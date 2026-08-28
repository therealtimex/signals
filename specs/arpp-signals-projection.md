# ARPP ↔ Signals Projection

**Status:** draft
**Date:** 2026-08-28
**Parent:** [`agent-readable-person-profile.md`](./agent-readable-person-profile.md) (ARPP v1.1)
**Sibling:** [`agent-readable-organization-profile.md`](./agent-readable-organization-profile.md) (AROO v1.0)
**Implementation:** `src/lib/arpp/project-contact.ts`, `src/lib/arpp/project-org.ts`

---

## 1. Purpose

Signals stores contacts as a **normalized graph** (identities, channels, employments, orgs, personas). ARPP is a **portable interchange document** for agents.

This spec defines:

1. `projectContactToArpp()` — read-path projection from `ContactDTO` (+ org lookups) → ARPP-shaped JSON
2. `classifyArppConformance()` — L0–L3 level for UI and enrichment targets
3. Field mapping tables and explicit **exclusions** (CRM-private data never leaks)
4. API surface for agents and the contact-detail "Agent view"

ARPP is **not** the database shape. Do not store a `person.json` blob on `contacts.metadata`. Project on read; optionally cache with `ETag` at export time for self-contact publish.

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Signals storage                          │
│  contacts · contact_identities · contact_channels            │
│  contact_employments → orgs · contact_personas (separate)    │
└──────────────────────────┬──────────────────────────────────┘
                           │ projectContactToArpp()
                           ▼
┌─────────────────────────────────────────────────────────────┐
│              ARPP document (application/ld+json)             │
│  L0 discoverable → L3 attested                               │
└──────────────────────────┬──────────────────────────────────┘
                           │ optional publish (isSelf only)
                           ▼
              /.well-known/person.json  (future)
```

**Two visibility modes:**

| Mode | Includes | Use |
|---|---|---|
| `internal` | All `shared` + `local_only` employments/channels; email if present | Agent tools, in-app Agent view |
| `public` | `shared` scope only; email only if verified (and omitted when `includeEmail=false`) | Export, well-known publish |

**Never projected:** relationship stage/warmth/notes, funnel stage, tags (CRM), `contact_personas` (simulation — not factual profile), raw `metadata`, private companion fields.

---

## 3. `projectContactToArpp()` signature

```ts
import type { ContactDTO } from "@/lib/db/queries/contact-dto";
import type { Org } from "@/lib/db/types";
import type { ArppPersonDocument, ArppProjectionOptions } from "@/lib/arpp/types";

export type ProjectContactToArppInput = {
  contact: ContactDTO;
  orgsById: Map<string, Org>;
};

export function projectContactToArpp(
  input: ProjectContactToArppInput,
  opts?: ArppProjectionOptions,
): ArppPersonDocument;
```

`orgsById` is required for `experience[].organization` blocks. Load via `getOrgById` for each distinct `employment.orgId`.

**Convenience loader** (API route / agent tool):

```ts
export function loadAndProjectContactToArpp(
  contactId: string,
  opts?: ArppProjectionOptions,
): ArppPersonDocument | undefined;
```

---

## 4. Field mapping — envelope

| ARPP field | Signals source | Notes |
|---|---|---|
| `$schema` | constant `https://arpp.dev/schema/1.1/person.json` | |
| `@context` | constant `["https://schema.org", "https://arpp.dev/ns/1.1/context.jsonld"]` | |
| `@type` | `"Person"` | |
| `@id` | `opts.canonicalPersonIri` ?? `` `${opts.baseIriPrefix}/${contact.id}#person` `` | Default prefix: `signals:contact` |
| `id` | `` `urn:signals:contact:${contact.id}` `` | Opaque; stable for Signals nanoid |
| `spec` | `"arpp/1.1"` | |
| `meta.version` | `"1.1.0"` | Spec version, not contact revision |
| `meta.revision` | `contact.updatedAt` | Monotonic unix seconds |
| `meta.lastUpdated` | ISO8601 from `contact.updatedAt` | |
| `meta.generatedAt` | `new Date().toISOString()` | Projection time |
| `meta.visibility` | `opts.visibility` (`internal` \| `public`) | |
| `meta.canonicalUrl` | `opts.canonicalUrl` | Omit when not public |
| `meta.publisher` | `opts.publisherIri` | Optional |
| `signals.contactId` | `contact.id` | **Extension** — round-trip for Signals agents |
| `signals.enrichmentScore` | `contact.enrichmentScore` | **Extension** — not ARPP normative |
| `signals.conformance` | `classifyArppConformance(doc)` | **Extension** |

Extensions live under `signals.*` so strict ARPP validators ignore them (forward compatible).

---

## 5. Field mapping — `identity`

| ARPP field | Signals source | Fallback |
|---|---|---|
| `identity.fullName` | `contact.name` | required |
| `identity.givenName` | `contact.firstName` | |
| `identity.familyName` | `contact.lastName` | |
| `identity.preferredName` | primary identity `displayName` if ≠ fullName | |
| `identity.biography` | `contact.profile.bio` | |
| `identity.disambiguatingDescription` | `contact.profile.headline` | Headline is short; ARPP allows longer disambiguator later |
| `identity.jobTitle` | Internal: `contact.currentEmployment.title`; public: first current employment remaining after the shared-scope filter | Prevents a local-only current role from leaking through the identity block |
| `identity.url` | `contact.website` | |
| `identity.image.url` | `contact.resolvedAvatarUrl` | Omit if null |
| `identity.contact.timezone` | `contacts.metadata.profile.timezone` | Future — parse JSON metadata |
| `identity.contact.preferredChannel` | derived | `"email"` if verified email; else `"web"` if website; else `"not-specified"` |
| `identity.email` | `contact.primaryEmail` | **public mode:** only if channel `isVerified` and `scope=shared` |

---

## 6. Field mapping — identifiers, profiles, sameAs

### `identifiers[]`

| scheme | value | When |
|---|---|---|
| `signals` | `contact.id` | always |
| platform-specific | `platformUserId` | per active identity |

### `profiles[]`

One row per active `contact_identities` row:

```json
{
  "network": "x",
  "url": "https://x.com/dhh",
  "username": "dhh",
  "verification": {
    "method": "platform-badge",
    "status": "challenge-passed",
    "checkedAt": "2026-08-28T17:00:00Z"
  }
}
```

| `identity.isVerified` | `verification.status` |
|---|---|
| `true` | `challenge-passed` |
| `false` / null | `claimed` |

`method`: `platform-badge` when verified; else `self`.

### `sameAs[]`

Collect unique URLs:

- Each `identity.platformUrl` (subject profile URL, not site root)
- `identity.websiteUrl` when distinct
- `contact.website`

**Exclude** `mailto:` and unverified email strings.

---

## 7. Field mapping — `experience`

Source: `contact.employments[]` joined with `orgsById`.

Filter: `scope=shared` in public mode; all in internal mode. Skip employments whose org has `scope=local_only` in public mode.

| ARPP field | Signals source |
|---|---|
| `id` | `` `exp:${employment.id}` `` |
| `role` | `employment.title` |
| `employmentType` | `employment.metadata.employmentType` or `"other"` |
| `organization.name` | `org.name` |
| `organization.url` | `org.website` |
| `organization.sameAs` | Signals org IRI plus `https://ror.org/…` from `org.metadata.identifiers.ror` when present |
| `timePeriod.start` | `YYYY-MM` from `employment.startedAt` unix |
| `timePeriod.end` | `YYYY-MM` or null |
| `timePeriod.current` | `employment.isCurrent` |

Nested org projection uses `projectOrgRefToArpp(org)` (minimal `Organization` stub — see AROO spec).

**DHH example** after employment link exists:

```json
"experience": [{
  "id": "exp:emp_abc",
  "role": "Co-owner & CTO",
  "employmentType": "founder",
  "organization": {
    "@type": "Organization",
    "name": "37signals",
    "url": "https://37signals.com",
    "sameAs": ["signals:org/org_xyz"]
  },
  "timePeriod": { "start": "2004-02", "end": null, "current": true }
}]
```

---

## 8. Deferred ARPP blocks (v1 projection = empty arrays)

| Block | Status | Planned source |
|---|---|---|
| `competencies` | `[]` | Future `contact_competencies` table |
| `education` | `[]` | Future table or enrichment writeback |
| `credentials` | `[]` | Future |
| `works` | `[]` | `content_items` authorship link (future) |
| `agentInterop` | omitted | **Not** `contact_personas` — separate consent/delegation store |
| `consent` | omitted internal; defaults on public export | `contacts.metadata.consent` when self-contact publishes |

---

## 9. Conformance classification

Implements ARPP §17 against the **projected** document:

```ts
export type ArppConformanceLevel = "L0" | "L1" | "L2" | "L3";

export function classifyArppConformance(doc: ArppPersonDocument): ArppConformanceLevel;
```

| Level | Rule (simplified) |
|---|---|
| **L0** | envelope + `identity.fullName` + `@id` + `sameAs.length >= 1` |
| **L1** | L0 + (`experience.length >= 1` OR `works.length >= 1`) + `competencies.length >= 1` |
| **L2** | L1 + external id (`orcid` \| `wikidata` \| `did` in identifiers) + ≥50% competencies have `concept.@id` |
| **L3** | L2 + `meta.signature` or verifiable credential |

Until competencies ship, **L1 is unreachable** for most contacts — UI should show "L0 (discoverable)" with a checklist of missing L1 fields rather than relying on `enrichmentScore` alone.

---

## 10. API surface

### `GET /api/contacts/:id/arpp`

Query params:

- `visibility=internal|public` (default `internal`)
- `pretty=1` (optional JSON formatting)

Response: `Content-Type: application/ld+json`

Auth: same as other dashboard routes today (none); agent tools use `get_contact_arpp` wrapper.

### Agent tool

```json
{
  "name": "get_contact_arpp",
  "description": "Return ARPP projection for a contact",
  "parameters": {
    "contactId": "string",
    "visibility": { "enum": ["internal", "public"] }
  }
}
```

---

## 11. Import path (future)

`mergeArppIntoContact(doc, { contactId, provenance })` — inverse projection:

1. Match `signals.contactId` or `identifiers[scheme=signals]`
2. Upsert identities from `profiles[]`
3. Upsert employments from `experience[]` via `ensureOrgByName` / `ensureOrgByDomain`
4. Write `identity.biography` → primary identity bio + resolved profile
5. Never overwrite relationship notes or persona

Out of scope for v1; document here so enrichment pipelines share one target shape.

---

## 12. Contact detail UI contract

**Profile card** (Details tab) shows:

- Biography (from `contact.profile.bio`)
- Disambiguating line (headline)
- Current role card → links to `/dashboard/organizations/{orgId}`
- Experience timeline
- **Agent view** accordion: pretty-printed `projectContactToArpp()` + conformance badge + copy button

**Relationship card** stays separate (stage, warmth, notes).

---

## 13. Test vectors

See `src/lib/arpp/project-contact.test.ts`:

1. Sparse contact (name + one X identity) → L0, empty experience
2. Full contact (employments, channels, bio) → L0 with rich `identity`
3. Public mode strips `local_only` employment
4. Verified email included in public only when verified
5. `contact_personas` never appears in output
