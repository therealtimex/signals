# Agent-Readable Organization Profile (AROO)

**Specification v1.0.0**
**Status:** draft
**Media type:** `application/ld+json` (preferred) or `application/json`
**Canonical document name:** `organization.json`
**Sibling:** [`agent-readable-person-profile.md`](./agent-readable-person-profile.md) (ARPP v1.1)
**Signals projection:** `src/lib/arpp/project-org.ts`

---

## 1. Purpose

AROO describes an **organization** (company, fund, team, community) so software agents can:

1. resolve *which organization* this is
2. parse identity, industry, size, and web presence without NLP
3. link people (`ARPP`) to employers via stable org IRIs
4. distinguish self-asserted claims from evidenced claims (ROR, domain verification)
5. fetch a fresh copy later

AROO is **not** a CRM account record. Pipeline stage, owner assignment, relationship warmth, and private notes stay in Signals' org overlay — not in the public document.

AROO complements schema.org `Organization` and uses **ROR** for research-grade org identifiers (not GRID).

---

## 2. Design principles

1. Every org gets a dereferenceable `@id` IRI.
2. Display names are labels; `domain` + ROR are identifiers.
3. Unknown fields MUST be ignored (forward compatible).
4. Public documents contain no secrets (no internal email patterns, MX probe evidence, or candidate addresses).
5. One document, one organization. Subsidiaries link via `parentOrganization` / `subOrganization`.
6. Dates are ISO 8601. Founded date may be year-only (`YYYY`).

---

## 3. Discovery

| Location | Role |
|---|---|
| `https://{domain}/.well-known/organization.json` | default for corporate sites |
| `https://{host}/orgs/{handle}/organization.json` | multi-tenant hosts |
| WebFinger `rel: https://aroo.dev/ns/organization-profile` | optional |

Signals internal default IRI: `` `signals:org:${orgId}` `` until published.

---

## 4. Document envelope

| Field | Type | Notes |
|---|---|---|
| `$schema` | URI | `https://aroo.dev/schema/1.0/organization.json` |
| `@context` | array | schema.org + AROO context |
| `@type` | string | `"Organization"` |
| `@id` | IRI | Stable org node |
| `id` | URN | `` `urn:signals:org:{opaqueId}` `` |
| `spec` | string | `"aroo/1.0"` |
| `meta` | object | Same shape as ARPP `meta` |

---

## 5. Core identity

```json
"identity": {
  "legalName": "37signals LLC",
  "name": "37signals",
  "alternateNames": ["Basecamp"],
  "description": "We build project management and email tools.",
  "disambiguatingDescription": "Software company behind Basecamp and HEY; formerly 37signals.",
  "url": "https://37signals.com",
  "logo": {
    "@type": "ImageObject",
    "url": "https://37signals.com/logo.png"
  },
  "foundingDate": "1999",
  "dissolutionDate": null,
  "industry": "Computer Software",
  "numberOfEmployees": {
    "min": 51,
    "max": 200,
    "unitText": "employees"
  },
  "location": {
    "type": "headquarters",
    "addressLocality": "Chicago",
    "addressRegion": "IL",
    "addressCountry": "US"
  }
}
```

`orgType` from Signals (`company` | `fund` | `team` | `community` | `other`) maps to:

| Signals `orgType` | AROO `organizationType` |
|---|---|
| `company` | `Corporation` |
| `fund` | `InvestmentFund` |
| `team` | `Organization` (subunit) |
| `community` | `Organization` |
| `other` | `Organization` |

---

## 6. Identifiers and graph bridges

```json
"identifiers": [
  {
    "scheme": "signals",
    "value": "org_abc123",
    "iri": "signals:org:org_abc123"
  },
  {
    "scheme": "ror",
    "value": "012mzw209",
    "iri": "https://ror.org/012mzw209"
  },
  {
    "scheme": "wikidata",
    "value": "Q2915473",
    "iri": "https://www.wikidata.org/entity/Q2915473"
  }
],
"sameAs": [
  "https://ror.org/012mzw209",
  "https://www.wikidata.org/entity/Q2915473",
  "https://github.com/basecamp"
]
```

Registered `scheme` values: `signals` · `ror` · `wikidata` · `lei` · `ticker` · `domain` · `other`

`sameAs` MUST be organization-level IRIs, not homepage roots without org path when a deeper entity URL exists.

---

## 7. Domains and web presence

```json
"domains": [
  { "domain": "37signals.com", "kind": "primary", "verified": true },
  { "domain": "basecamp.com", "kind": "alias", "verified": false }
],
"profiles": [
  {
    "network": "x",
    "url": "https://x.com/37signals",
    "username": "37signals",
    "verification": { "status": "claimed" }
  },
  {
    "network": "linkedin",
    "url": "https://www.linkedin.com/company/37signals",
    "verification": { "status": "claimed" }
  }
]
```

**Public slice:** include `domains[].domain` and `kind` only — omit `mxStatus`, `catchAll`, `mailEvidence` (Signals-private).

---

## 8. People linkage (read-only references)

AROO MAY include a summary block pointing at member ARPP documents without embedding full person records:

```json
"knownPeople": [
  {
    "role": "Co-owner & CTO",
    "person": {
      "@id": "signals:contact:cnt_dhh#person",
      "name": "David Heinemeier Hansson"
    },
    "current": true
  }
]
```

Signals projects this from `contact_employments` where `isCurrent=true`. **Public export:** only `shared` employments on `shared` orgs.

---

## 9. Signals ↔ AROO projection map

| AROO field | Signals source |
|---|---|
| `identity.name` | `orgs.name` |
| `identity.description` | `orgs.description` |
| `identity.url` | `orgs.website` |
| `identity.logo.url` | `orgs.avatarUrl` |
| `identity.industry` | `orgs.industry` |
| `identity.numberOfEmployees` | parsed from `orgs.companySize` enum |
| `identity.location` | parsed from `orgs.location` string (best effort) |
| `domains` | `org_domains` table |
| `profiles` | `org_identities` |
| `identifiers[ror]` | `orgs.metadata.identifiers.ror` |
| `signals.orgId` | `orgs.id` (**extension**) |
| `signals.enrichmentScore` | `orgs.enrichmentScore` (**extension**) |
| `signals.accountStage` | `orgs.accountStage` — **internal only** |
| `signals.ownerContactId` | `orgs.ownerContactId` — **internal only** |

**Never projected (public):** `org_email_patterns`, `contact_email_candidates`, MX/catch-all evidence, `fieldProvenance`, CRM tags used for internal segmentation.

---

## 10. Conformance levels

| Level | Must include | Consumer |
|---|---|---|
| **O0 Discoverable** | envelope + `identity.name` + `@id` + (`domains[primary]` OR `profiles.length >= 1`) | crawlers |
| **O1 Profiled** | O0 + `description` + `industry` or `numberOfEmployees` | sales/collab agents |
| **O2 Grounded** | O1 + ROR or Wikidata identifier | knowledge-graph merge |
| **O3 Attested** | O2 + domain DNS/HTTPS verification or document proof | high-trust matching |

```ts
export function classifyArooConformance(doc: ArooOrganizationDocument): "O0" | "O1" | "O2" | "O3";
```

---

## 11. Full minimal example (37signals)

```json
{
  "$schema": "https://aroo.dev/schema/1.0/organization.json",
  "@context": [
    "https://schema.org",
    "https://aroo.dev/ns/1.0/context.jsonld"
  ],
  "@type": "Organization",
  "@id": "signals:org:org_37signals",
  "id": "urn:signals:org:org_37signals",
  "spec": "aroo/1.0",
  "meta": {
    "version": "1.0.0",
    "revision": 1724856000,
    "lastUpdated": "2026-08-28T17:00:00Z",
    "generatedAt": "2026-08-28T17:00:00Z",
    "visibility": "internal"
  },
  "identity": {
    "name": "37signals",
    "description": "We build project management and email tools.",
    "url": "https://37signals.com",
    "industry": "Computer Software",
    "numberOfEmployees": { "min": 51, "max": 200, "unitText": "employees" }
  },
  "identifiers": [
    {
      "scheme": "signals",
      "value": "org_37signals",
      "iri": "signals:org:org_37signals"
    }
  ],
  "domains": [
    { "domain": "37signals.com", "kind": "primary", "verified": false }
  ],
  "profiles": [
    {
      "network": "x",
      "url": "https://x.com/37signals",
      "username": "37signals",
      "verification": { "status": "claimed" }
    }
  ],
  "signals": {
    "orgId": "org_37signals",
    "enrichmentScore": 42,
    "conformance": "O0"
  }
}
```

---

## 12. API surface (Signals)

### `GET /api/orgs/:id/aroo`

Query: `visibility=internal|public`

Response: `application/ld+json`

### Agent tool

`get_org_aroo` — same projection, callable from enrichment and snowball workflows.

---

## 13. Relationship to company-intelligence epic

[`company-intelligence.md`](./company-intelligence.md) owns CRM overlays (stage, owner, email intelligence, signals feed). AROO owns the **agent-interchange slice**:

- Company detail **Overview** shows human-readable fields
- **Agent view** shows `projectOrgToAroo()` JSON + O0–O3 badge
- Enrichment pipeline writeback targets both `orgs` columns **and** AROO-grounded identifiers (`metadata.identifiers.ror`)

Person ↔ org join on contact pages uses `contact_employments` → AROO `@id` in experience blocks (ARPP §10).

---

## 14. File split (public publish — future)

```
/.well-known/organization.json     public O0–O2
/organization.private.json           CRM overlay (never served at well-known)
```

For individuals: ARPP `experience[].organization` SHOULD reference the employer's AROO `@id` when known.
