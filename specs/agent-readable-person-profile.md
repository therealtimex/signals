# Agent-Readable Person Profile (ARPP)  
**Specification v1.1.0**  
Status: draft  
Media type: `application/ld+json` (preferred) or `application/json`  
Canonical document name: `person.json`

---

## 1. Purpose

ARPP is a portable, versioned document that describes a **human** so software agents can:

1. resolve *which person* this is
2. parse identity, skills, work, and artifacts without NLP
3. distinguish self-asserted claims from evidenced claims
4. fetch a fresh copy later
5. respect visibility and consent

It is **not** an agent card. Agent identity belongs in a separate `agent.json` / Agent Card. A person profile MAY point at agents they operate.

It is **not** a replacement for schema.org Person on HTML pages. A public ARPP document SHOULD be projectable into schema.org JSON-LD for the web graph.

---

## 2. Design principles

1. Every entity that can be named in a public graph gets a resolvable IRI.
2. Display strings are labels, not identifiers.
3. Self-assessment is allowed and marked as such.
4. Unknown fields MUST be ignored (forward compatible).
5. Public documents contain no secrets (email MAY be present; tokens, private notes, and home address MUST NOT).
6. Dates are ISO 8601. Month precision (`YYYY-MM`) is allowed for employment/education.
7. One document, one person. Alternate personas are separate documents linked with `relatedProfiles`.

---

## 3. Discovery

Publish the public profile at one or more of:

| Location | Role |
|---|---|
| `https://{domain}/.well-known/person.json` | origin default (one person per origin) |
| `https://{domain}/@{handle}/person.json` | multi-person host |
| `https://{domain}/.well-known/webfinger` | `acct:` resolution |

WebFinger JRD for `acct:alex@alexrivera.dev`:

```json
{
  "subject": "acct:alex@alexrivera.dev",
  "aliases": [
    "https://alexrivera.dev/#person",
    "did:web:alexrivera.dev"
  ],
  "links": [
    {
      "rel": "https://arpp.dev/ns/person-profile",
      "type": "application/ld+json",
      "href": "https://alexrivera.dev/.well-known/person.json"
    },
    {
      "rel": "http://schema.org/Person",
      "type": "application/ld+json",
      "href": "https://alexrivera.dev/#person"
    }
  ]
}
```

Serving rules:

- HTTPS only
- `Content-Type: application/ld+json` or `application/json`
- `Cache-Control` recommended (`max-age` 300–86400)
- `ETag` / `Last-Modified` required for public hosts
- body SHOULD be ≤ 256 KiB for the public slice

---

## 4. Document envelope

Required at the root:

| Field | Type | Notes |
|---|---|---|
| `$schema` | URI | JSON Schema for this version |
| `@context` | array | MUST include schema.org and the ARPP context |
| `@type` | string | `"Person"` |
| `@id` | IRI | Stable, dereferenceable person node. Prefer `https://{site}/#person` or `did:web:…` |
| `id` | URN | Persistent opaque id, typically `urn:uuid:…`. Never reuse. |
| `spec` | string | `"arpp/1.1"` |
| `meta` | object | versioning, visibility, provenance |

`@id` is the graph identity. `id` is the document subject key. They MUST NOT change independently without a `replaces` / `sameAs` link.

---

## 5. `meta`

```json
"meta": {
  "version": "1.1.0",
  "revision": 14,
  "generatedAt": "2026-08-28T17:00:00Z",
  "lastUpdated": "2026-08-28T17:00:00Z",
  "visibility": "public",
  "locale": "en-US",
  "license": "CC0-1.0",
  "canonicalUrl": "https://alexrivera.dev/.well-known/person.json",
  "publisher": "https://alexrivera.dev/#person",
  "signature": null,
  "replaces": null,
  "ttlSeconds": 3600
}
```

| Field | Required | Notes |
|---|---|---|
| `version` | yes | SemVer of **this document instance** |
| `revision` | yes | Monotonic integer |
| `lastUpdated` | yes | RFC 3339 UTC |
| `visibility` | yes | `public` \| `unlisted` \| `restricted` \| `private` |
| `canonicalUrl` | yes for public | URL of this representation |
| `signature` | no | Detached or embedded proof (see §14) |

`visibility: private` documents MUST NOT be served at a well-known URL.

---

## 6. Core identity

```json
"identity": {
  "fullName": "Alex Rivera",
  "givenName": "Alex",
  "familyName": "Rivera",
  "preferredName": "Alex",
  "alternateNames": ["A. Rivera"],
  "pronouns": {
    "language": "en",
    "subject": "they",
    "object": "them",
    "possessive": "their",
    "display": "they/them"
  },
  "primaryLanguage": "en-US",
  "knowsLanguages": [
    { "code": "en-US", "fluency": "native" },
    { "code": "es", "fluency": "professional" }
  ],
  "biography": "Distributed systems researcher turned protocol engineer…",
  "disambiguatingDescription": "Protocol engineer working on decentralized storage safety since 2018.",
  "image": {
    "@type": "ImageObject",
    "url": "https://alexrivera.dev/alex.jpg",
    "contentUrl": "https://alexrivera.dev/alex.jpg",
    "license": "CC-BY-4.0"
  },
  "url": "https://alexrivera.dev",
  "jobTitle": "Principal Protocol Engineer",
  "email": null,
  "contact": {
    "preferredChannel": "web",
    "url": "https://alexrivera.dev/contact",
    "timezone": "America/Los_Angeles",
    "availability": "open-to-collaboration"
  }
}
```

Rules:

- `fullName` required.
- `primaryLanguage` is BCP-47.
- `pronouns` is an object, not a bare array.
- `email` omitted or null in public docs unless the subject wants inbound mail from agents.
- `availability`: `not-specified` \| `open-to-work` \| `open-to-collaboration` \| `not-available`.

Fluency enum: `elementary` | `limited` | `professional` | `full-professional` | `native`.

---

## 7. Identifiers and graph bridges

Do not store catalog homepages. Store the subject’s own IRI.

```json
"identifiers": [
  {
    "scheme": "uuid",
    "value": "fca35083-d56a-4933-97ec-f623bb6dfc92",
    "iri": "urn:uuid:fca35083-d56a-4933-97ec-f623bb6dfc92"
  },
  {
    "scheme": "orcid",
    "value": "0000-0002-1825-0097",
    "iri": "https://orcid.org/0000-0002-1825-0097"
  },
  {
    "scheme": "wikidata",
    "value": "Q42",
    "iri": "https://www.wikidata.org/entity/Q42"
  },
  {
    "scheme": "did",
    "value": "did:web:alexrivera.dev",
    "iri": "did:web:alexrivera.dev"
  }
],
"sameAs": [
  "https://www.wikidata.org/entity/Q42",
  "https://orcid.org/0000-0002-1825-0097",
  "https://github.com/alexrivera",
  "https://www.linkedin.com/in/alexrivera",
  "https://alexrivera.dev"
]
```

Registered `scheme` values:

`uuid` · `orcid` · `wikidata` · `did` · `github` · `linkedin` · `scholar` · `ror` (orgs only) · `doi` · `issn` · `other`

`sameAs` MUST be subject-level profile IRIs, not site roots like `https://github.com`.

Organization identifiers MUST use ROR (`https://ror.org/0…`), not GRID. GRID public resolution is retired.

---

## 8. Profiles (formerly “verifiedProfiles”)

```json
"profiles": [
  {
    "network": "github",
    "url": "https://github.com/alexrivera",
    "username": "alexrivera",
    "verification": {
      "method": "https-well-known",
      "status": "claimed",
      "checkedAt": "2026-08-28T09:00:00Z"
    }
  },
  {
    "network": "website",
    "url": "https://alexrivera.dev"
  }
]
```

`verification.status`: `claimed` | `challenge-passed` | `signed` | `unknown`.

A processor MUST treat `claimed` as self-assertion. Only `challenge-passed` or `signed` may be called verified.

---

## 9. Competencies

Skills are graph nodes plus a self-assessed level plus optional evidence.

```json
"competencies": [
  {
    "id": "comp:distributed-systems",
    "name": "Distributed Systems",
    "concept": {
      "@id": "https://www.wikidata.org/entity/Q484847",
      "scheme": "wikidata"
    },
    "level": "expert",
    "levelSource": "self",
    "years": 8,
    "lastUsed": "2026-08",
    "contextTags": ["consensus-mechanisms", "raft", "p2p"],
    "evidence": [
      { "type": "repository", "url": "https://github.com/alexrivera/zk-receipts" },
      { "type": "role", "ref": "exp:ipl-principal" }
    ]
  },
  {
    "id": "comp:rust",
    "name": "Rust",
    "concept": {
      "@id": "https://www.wikidata.org/entity/Q575650",
      "scheme": "wikidata"
    },
    "level": "proficient",
    "levelSource": "self",
    "contextTags": ["async-tokio", "wasm-targets"]
  }
]
```

Level enum (required if present):  
`familiar` | `working` | `proficient` | `expert` | `authority`

`levelSource`: `self` | `peer` | `exam` | `credential` | `inferred`

Also emit schema.org `knowsAbout` as the concept IRIs so web agents can consume the same file as Person JSON-LD.

---

## 10. Experience timeline

```json
"experience": [
  {
    "id": "exp:ipl-principal",
    "role": "Principal Protocol Engineer",
    "employmentType": "full-time",
    "organization": {
      "@type": "Organization",
      "name": "Interplanetary Labs",
      "url": "https://interplanetarylabs.io",
      "sameAs": ["https://ror.org/012mzw209"]
    },
    "location": { "type": "remote", "addressCountry": "US" },
    "timePeriod": {
      "start": "2022-03",
      "end": null,
      "current": true
    },
    "summary": "Lead protocol work for decentralized storage safety.",
    "contributions": [
      {
        "text": "Architected the zero-knowledge verification pipeline for block storage receipts.",
        "artifacts": [
          { "type": "repository", "url": "https://github.com/iplabs/zk-receipts" }
        ]
      },
      {
        "text": "Led a team of 6 engineers migrating legacy Go pipelines to idiomatic Rust.",
        "metrics": [
          { "name": "teamSize", "value": 6, "unit": "people" }
        ]
      }
    ]
  }
]
```

`employmentType`: `full-time` | `part-time` | `contract` | `fellowship` | `founder` | `advisory` | `volunteer` | `other`

If `current` is true, `end` MUST be null.  
If `end` is set, `current` MUST be false.

Map to schema.org as `hasOccupation` + `Role` with `startDate` / `endDate`.

---

## 11. Education, credentials, works

```json
"education": [
  {
    "id": "edu:mit-ms",
    "institution": {
      "name": "Massachusetts Institute of Technology",
      "url": "https://web.mit.edu",
      "sameAs": ["https://ror.org/042nb2s44"]
    },
    "award": "M.S.",
    "area": "Electrical Engineering and Computer Science",
    "timePeriod": { "start": "2016-09", "end": "2018-06", "current": false }
  }
],
"credentials": [
  {
    "name": "Example Professional Certificate",
    "issuer": "Example Institute",
    "url": "https://example.net/credential/abc",
    "validFrom": "2024-01-01",
    "validUntil": null,
    "credentialType": "https://schema.org/EducationalOccupationalCredential"
  }
],
"works": [
  {
    "@type": "SoftwareSourceCode",
    "name": "zk-receipts",
    "codeRepository": "https://github.com/iplabs/zk-receipts",
    "datePublished": "2023-04",
    "programmingLanguage": "Rust"
  },
  {
    "@type": "ScholarlyArticle",
    "name": "Safety properties for receipt-based storage",
    "url": "https://doi.org/10.1234/example",
    "identifier": "10.1234/example",
    "datePublished": "2024"
  }
]
```

---

## 12. Agent interop block

This is how *other agents* should treat this person. It is not a persona dump.

```json
"agentInterop": {
  "preferredName": "Alex",
  "addressAs": "Alex",
  "summaryForAgents": "Protocol engineer. Prefer precise technical answers, citations, and code in Rust when relevant.",
  "delegation": {
    "allowed": ["research", "drafting", "code-review"],
    "requiresConfirmation": ["public-posting", "outbound-email"],
    "forbidden": ["financial-transfer", "legal-commitment"]
  },
  "citationPolicy": "prefer-primary-sources",
  "relatedAgents": [
    {
      "role": "operated-by-subject",
      "url": "https://alexrivera.dev/.well-known/agent.json"
    }
  ]
}
```

Put tone, verbosity, and long-term memory in a **private** companion file (`person.private.json`), not in the public profile.

---

## 13. Consent and redaction

```json
"consent": {
  "allowIndexing": true,
  "allowModelTraining": false,
  "allowAutonomousOutreach": false,
  "retainUntil": null,
  "purpose": ["identity-resolution", "collaboration-matching"]
}
```

Processors SHOULD honor `allowModelTraining` and `allowAutonomousOutreach`. Absence means unspecified, not granted.

---

## 14. Integrity

Optional `meta.signature` using a Data Integrity or JOSE proof over the canonicalized JSON (JCS):

```json
"proof": {
  "type": "DataIntegrityProof",
  "cryptosuite": "eddsa-rdfc-2022",
  "created": "2026-08-28T17:00:00Z",
  "verificationMethod": "did:web:alexrivera.dev#key-1",
  "proofPurpose": "assertionMethod",
  "proofValue": "z…"
}
```

Individual high-value claims (degree, employment, license) SHOULD be attached as W3C Verifiable Credentials in `credentials[].verifiableCredential` rather than unsigned strings.

---

## 15. Full public example

```json
{
  "$schema": "https://arpp.dev/schema/1.1/person.json",
  "@context": [
    "https://schema.org",
    "https://arpp.dev/ns/1.1/context.jsonld"
  ],
  "@type": "Person",
  "@id": "https://alexrivera.dev/#person",
  "id": "urn:uuid:fca35083-d56a-4933-97ec-f623bb6dfc92",
  "spec": "arpp/1.1",
  "meta": {
    "version": "1.1.0",
    "revision": 14,
    "generatedAt": "2026-08-28T17:00:00Z",
    "lastUpdated": "2026-08-28T17:00:00Z",
    "visibility": "public",
    "locale": "en-US",
    "license": "CC0-1.0",
    "canonicalUrl": "https://alexrivera.dev/.well-known/person.json",
    "ttlSeconds": 3600
  },
  "identity": {
    "fullName": "Alex Rivera",
    "givenName": "Alex",
    "familyName": "Rivera",
    "preferredName": "Alex",
    "pronouns": {
      "language": "en",
      "subject": "they",
      "object": "them",
      "possessive": "their",
      "display": "they/them"
    },
    "primaryLanguage": "en-US",
    "knowsLanguages": [
      { "code": "en-US", "fluency": "native" }
    ],
    "biography": "Distributed systems researcher turned protocol engineer, focusing on decentralized storage safety architectures since 2018.",
    "disambiguatingDescription": "Protocol engineer specializing in decentralized storage safety.",
    "url": "https://alexrivera.dev",
    "jobTitle": "Principal Protocol Engineer",
    "contact": {
      "preferredChannel": "web",
      "url": "https://alexrivera.dev/contact",
      "timezone": "America/Los_Angeles",
      "availability": "open-to-collaboration"
    }
  },
  "identifiers": [
    {
      "scheme": "uuid",
      "value": "fca35083-d56a-4933-97ec-f623bb6dfc92",
      "iri": "urn:uuid:fca35083-d56a-4933-97ec-f623bb6dfc92"
    },
    {
      "scheme": "orcid",
      "value": "0000-0002-1825-0097",
      "iri": "https://orcid.org/0000-0002-1825-0097"
    }
  ],
  "sameAs": [
    "https://orcid.org/0000-0002-1825-0097",
    "https://github.com/alexrivera",
    "https://www.linkedin.com/in/alexrivera",
    "https://alexrivera.dev"
  ],
  "knowsAbout": [
    "https://www.wikidata.org/entity/Q484847",
    "https://www.wikidata.org/entity/Q575650"
  ],
  "profiles": [
    {
      "network": "github",
      "url": "https://github.com/alexrivera",
      "username": "alexrivera",
      "verification": { "method": "self", "status": "claimed" }
    },
    {
      "network": "linkedin",
      "url": "https://www.linkedin.com/in/alexrivera",
      "verification": { "method": "self", "status": "claimed" }
    },
    {
      "network": "website",
      "url": "https://alexrivera.dev"
    }
  ],
  "competencies": [
    {
      "id": "comp:distributed-systems",
      "name": "Distributed Systems",
      "concept": {
        "@id": "https://www.wikidata.org/entity/Q484847",
        "scheme": "wikidata"
      },
      "level": "expert",
      "levelSource": "self",
      "contextTags": ["consensus-mechanisms", "raft", "p2p"]
    },
    {
      "id": "comp:rust",
      "name": "Rust",
      "concept": {
        "@id": "https://www.wikidata.org/entity/Q575650",
        "scheme": "wikidata"
      },
      "level": "proficient",
      "levelSource": "self",
      "contextTags": ["async-tokio", "wasm-targets"]
    }
  ],
  "experience": [
    {
      "id": "exp:ipl-principal",
      "role": "Principal Protocol Engineer",
      "employmentType": "full-time",
      "organization": {
        "@type": "Organization",
        "name": "Interplanetary Labs",
        "url": "https://interplanetarylabs.io"
      },
      "timePeriod": {
        "start": "2022-03",
        "end": null,
        "current": true
      },
      "contributions": [
        {
          "text": "Architected the zero-knowledge verification pipeline for block storage receipts."
        },
        {
          "text": "Led a team of 6 engineers migrating legacy Go pipelines to idiomatic Rust.",
          "metrics": [{ "name": "teamSize", "value": 6, "unit": "people" }]
        }
      ]
    }
  ],
  "works": [],
  "education": [],
  "credentials": [],
  "agentInterop": {
    "preferredName": "Alex",
    "summaryForAgents": "Distributed systems and Rust protocol engineer. Prefer precise, cited technical answers.",
    "delegation": {
      "allowed": ["research", "drafting"],
      "requiresConfirmation": ["public-posting"],
      "forbidden": ["financial-transfer"]
    }
  },
  "consent": {
    "allowIndexing": true,
    "allowModelTraining": false,
    "allowAutonomousOutreach": false,
    "purpose": ["identity-resolution", "collaboration-matching"]
  }
}
```

---

## 16. JSON Schema (normative sketch)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://arpp.dev/schema/1.1/person.json",
  "title": "ARPP Person Profile",
  "type": "object",
  "required": ["$schema", "@context", "@type", "@id", "id", "spec", "meta", "identity"],
  "additionalProperties": true,
  "properties": {
    "$schema": { "type": "string", "format": "uri" },
    "@context": {
      "type": "array",
      "minItems": 1,
      "items": { "type": ["string", "object"] }
    },
    "@type": { "const": "Person" },
    "@id": { "type": "string", "format": "uri" },
    "id": { "type": "string", "pattern": "^urn:" },
    "spec": { "const": "arpp/1.1" },
    "meta": {
      "type": "object",
      "required": ["version", "revision", "lastUpdated", "visibility"],
      "properties": {
        "version": { "type": "string", "pattern": "^[0-9]+\\.[0-9]+\\.[0-9]+$" },
        "revision": { "type": "integer", "minimum": 1 },
        "lastUpdated": { "type": "string", "format": "date-time" },
        "visibility": {
          "enum": ["public", "unlisted", "restricted", "private"]
        },
        "canonicalUrl": { "type": "string", "format": "uri" },
        "ttlSeconds": { "type": "integer", "minimum": 0 }
      }
    },
    "identity": {
      "type": "object",
      "required": ["fullName"],
      "properties": {
        "fullName": { "type": "string", "minLength": 1 },
        "preferredName": { "type": "string" },
        "primaryLanguage": { "type": "string" },
        "biography": { "type": "string" }
      }
    },
    "sameAs": {
      "type": "array",
      "items": { "type": "string", "format": "uri" }
    },
    "competencies": { "type": "array", "items": { "$ref": "#/$defs/competency" } },
    "experience": { "type": "array", "items": { "$ref": "#/$defs/experience" } }
  },
  "$defs": {
    "competency": {
      "type": "object",
      "required": ["name"],
      "properties": {
        "name": { "type": "string" },
        "level": {
          "enum": ["familiar", "working", "proficient", "expert", "authority"]
        },
        "levelSource": {
          "enum": ["self", "peer", "exam", "credential", "inferred"]
        }
      }
    },
    "experience": {
      "type": "object",
      "required": ["role", "organization", "timePeriod"],
      "properties": {
        "role": { "type": "string" },
        "employmentType": {
          "enum": ["full-time", "part-time", "contract", "fellowship", "founder", "advisory", "volunteer", "other"]
        }
      }
    }
  }
}
```

---

## 17. Conformance

| Level | Must include | Intended consumer |
|---|---|---|
| **L0 Discoverable** | envelope + `identity.fullName` + `@id` + `sameAs` ≥ 1 | crawlers |
| **L1 Professional** | L0 + experience or works + competencies | recruiting / collab agents |
| **L2 Grounded** | L1 + at least one of ORCID / Wikidata / DID + concept IRIs on ≥ 50% of competencies | knowledge-graph merge |
| **L3 Attested** | L2 + document proof or ≥ 1 verifiable credential | high-trust matching |

A consumer that cannot validate a proof MUST still accept L0–L2 data and mark claims `unverified`.

---

## 18. Processing rules for agents

1. Fetch `canonicalUrl` or well-known path. Honor `ETag`.
2. Validate against `$schema` if present; ignore unknown properties.
3. Resolve `@id` as the person node. Merge `sameAs` only after URL fetch confirms the remote page refers back, when possible.
4. Treat `competencies[].level` with `levelSource: self` as preference, not fact.
5. Do not invent missing Wikidata/ORCID IDs.
6. Do not copy private companion fields into prompts that leave the user’s trust boundary.
7. If `consent.allowAutonomousOutreach` is false or absent, do not cold-email or DM.

---

## 19. What changed from the original draft

| Original | ARPP 1.1 |
|---|---|
| `$schema` only | `$schema` + JSON-LD `@context` / `@type` / `@id` |
| UUID as sole id | UUID + dereferenceable `@id` + DID optional |
| Catalog homepages as “IDs” | subject IRIs (ORCID, Wikidata entity, GitHub user) |
| GRID org id | ROR |
| `verifiedProfiles` map of site roots | `profiles[]` + explicit verification status |
| pronouns as two tokens | structured pronoun object |
| skill name + tags | skill + concept IRI + level source + evidence |
| contribution strings only | optional artifacts and metrics |
| no discovery | well-known + WebFinger |
| no consent | `consent` block |
| no proof | optional document proof / VCs |
| one blob for everything | public `person.json` vs private companion |

---

## 20. File split

```
/.well-known/person.json          public L0–L2
/person.private.json              local / encrypted (tone, notes, constraints)
/.well-known/agent.json           agents the person operates
```
