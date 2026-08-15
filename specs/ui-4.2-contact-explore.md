# UI 4.2 — Contact explore card (Audience bridge)

**Status:** Approved (System Design, 2026-08-15) — Dev implements exactly this surface.  
**Issue:** [#53](https://github.com/therealtimex/signals/issues/53) · **Epic:** [#51](https://github.com/therealtimex/signals/issues/51)

## 1. Scope

Extend `/dashboard/contacts/[id]` with an **Audience** tab showing Wind Tunnel grounding data already stored in schema v0.5:

| Block | Source | Notes |
|-------|--------|-------|
| Active persona | `contact_personas` (`status = active`) | Shared-scope fields only in card body |
| Identity metrics | `contact_identities` + latest `identity_metrics` row | Per-platform explore stats |
| Niche chips | `belongs_to_niche` (`contact` → `niche`, shared scope) | Weight as confidence hint |

**Out of scope:** persona generation UI, niche admin, editing persona/niches from dashboard (read-only v1).

## 2. API

`GET /api/contacts/[id]/explore`

- 404 when contact missing (`{ error, code: "NOT_FOUND" }` via shared errors helper where applicable; match contacts route style for 404).
- 200 body:

```typescript
type ContactExploreResponse = {
  persona: {
    visibility: "shared" | "local_only" | "absent";
    archetype: string | null;
    tone: string | null;
    summary: string | null;
    interests: string[];
    confidence: number | null;
    generatedAt: number | null;
  };
  identities: Array<{
    id: string;
    platform: string;
    platformHandle: string | null;
    displayName: string | null;
    followersCount: number | null;
    followingCount: number | null;
    postsCount: number | null;
    listedCount: number | null;
    engagementRate: number | null;
    statsUpdatedAt: number | null;
    metricSnapshotAt: number | null;
  }>;
  niches: Array<{
    id: string;
    name: string;
    slug: string;
    nicheType: string;
    weight: number | null;
  }>;
};
```

### Privacy rules

1. When active persona `scope === "local_only"`: `visibility: "local_only"` and **all persona content fields null/empty** (never leak private copy).
2. When no active persona: `visibility: "absent"`.
3. Niche list: shared-scope edges and shared niches only (same as `assembleAgentGrounding` niche filter).
4. Identities: include all identities for the contact. **Metric precedence:** the latest `identity_metrics` snapshot wins per field when present (`followersCount`, `followingCount`, `postsCount`, `listedCount`, `engagementRate`), falling back to the denormalized identity columns; `engagementRate` exists only on snapshots. Both `statsUpdatedAt` (identity sync) and `metricSnapshotAt` (snapshot) are exposed so the UI can show data recency. Known v1 edge: if an identity column is re-synced after the last snapshot, the older snapshot value still wins — acceptable while both writers run in the same sync pipeline; revisit if writers diverge.

### Query layer

New `getContactExploreCard(contactId)` in `src/lib/db/queries/contact-explore.ts` — single round-trip assembly (no client N+1).

## 3. UI

- **Data load:** server component. `page.tsx` calls `getContactExploreCard(id)` directly and passes the projection as a prop to the client tab — no client fetch, no loading state, data consistent with the rest of the page render. `GET /api/contacts/[id]/explore` is the parallel REST surface (per `ui-4.1-rest-api.md` conventions) for non-dashboard consumers; the dashboard does not call it.
- Add **Audience** tab on contact detail (alongside Details / Identities / Tasks).
- `ContactExploreCard` component renders three sections: Persona, Platform stats, Niches.
- `local_only` persona → badge “Private persona” + short explanation; no archetype/summary text.
- Niche chips link to `#` with `title="Niche detail coming soon"` (stub per issue).
- Empty states per section (“No shared persona yet”, etc.).

## 4. Tests

1. Query unit test: shared persona + niches rendered; `local_only` persona yields `visibility: local_only` with null content.
2. API route test: 404 unknown contact; 200 seeded fixture.
3. Component smoke test (`renderToStaticMarkup`): shows persona summary and niche name when props provided; shows local-only badge without leaking summary.

## 5. Design decisions (System Design, 2026-08-15)

1. **Dedicated `GET /api/contacts/[id]/explore`** rather than extending `GET /api/contacts/[id]`: the explore projection has its own privacy rules and query cost (persona + snapshots + graph edges); keeping it out of the base contact payload keeps that endpoint stable and cheap. Trade-off: one more route to maintain.
2. **`local_only` persona → visible badge, zero content leak.** The API returns `visibility: "local_only"` with all content fields null/empty; the card renders a "Private persona" badge. Hiding the persona entirely would make shared vs. private indistinguishable from "no persona", which misleads teammates.
3. **Metric precedence: latest `identity_metrics` snapshot wins, identity columns are fallback** (see §2.4). Snapshots are the time-series source of truth going forward; columns remain for identities that predate snapshots.
4. **Niche chip = `{ id, name, slug, nicheType, weight }`**, link stubbed to `#` with a "coming soon" title until a niche detail page exists. `slug` is included now so the future link needs no API change.
5. **Server-component data load** for the Audience tab; the REST endpoint exists in parallel for external consumers (see §3). Avoids a client fetch waterfall and a loading state for data already available at render time.

## 6. Acceptance

- [ ] Audience tab visible on contact detail
- [ ] `GET /api/contacts/[id]/explore` matches §2 shape
- [ ] Privacy rules §2 enforced in query + tests
- [ ] `npm run check` green
