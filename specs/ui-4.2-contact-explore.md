# UI 4.2 — Contact explore card (Audience bridge)

**Status:** Approved v2 (System Design, 2026-08-15) — v1 shipped under #53; §7 parity addendum (§§7–12) approved for #84. Dev implements exactly this surface.  
**Issue:** [#53](https://github.com/therealtimex/signals/issues/53) (v1) · [#84](https://github.com/therealtimex/signals/issues/84) (v2 addendum) · **Epic:** [#51](https://github.com/therealtimex/signals/issues/51) · [#83](https://github.com/therealtimex/signals/issues/83)

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

---

# v2 addendum — Schema §7 explore-card parity (#84)

Approved by System Design 2026-08-15. Closes every remaining `specs/schema-v0.5.md` §7 row on the explore card. **All changes are additive and backward-compatible**: v1 response fields, privacy rules, and component props are unchanged; existing consumers keep working without modification. This addendum lives here rather than in a new `ui-4.3-*` file because `ui-4.3` is already taken (content-gtm-context) and one canonical explore-card contract beats two.

## 7. Scope additions

| Block | Source | Notes |
|-------|--------|-------|
| Identity header | primary `contact_identities` row + `contacts` fallback | Avatar, name, handle, verified, bio, location, account age |
| Persona chips ×2 | `contact_personas.conversion_triggers / engagement_formats` | "What converts them" / "Formats they engage with" |
| Relationship chip | `graph_edges` (`follows` / `connected_to`) vs owner contact | Requires owner resolution (§9) |
| Org badge | `works_at` edge → `orgs` | Links to `/dashboard/organizations/[id]` (note: NOT `/dashboard/orgs`) |
| Recent posts | `content_items` + `content_posts` | Public content only; DMs/emails excluded (§10.3) |

**Still out of scope:** the `/dashboard/explore` map and drawer themselves (#85), account picker (#86/#87), persona/niche editing, org detail changes.

## 8. API — extended response shape

`GET /api/contacts/[id]/explore` (unchanged route, 404 behavior, and server-component data path). Extended 200 body — `// v1` marks unchanged fields:

```typescript
type ContactExploreResponse = {
  /** NEW: card is self-contained for the #85 map drawer (no second fetch for header basics). */
  contact: {
    id: string;
    name: string;
    headline: string | null;
    avatarUrl: string | null;   // contacts.avatar_url — fallback when no identity avatar
    location: string | null;    // contacts.location — fallback per schema §7
  };
  persona: {
    visibility: "shared" | "local_only" | "absent";  // v1
    archetype: string | null;                         // v1
    tone: string | null;                              // v1
    summary: string | null;                           // v1
    interests: string[];                              // v1
    confidence: number | null;                        // v1
    generatedAt: number | null;                       // v1
    stale: boolean | null;                            // v1 (impl. addition, now canonical)
    conversionTriggers: string[];                     // NEW — contact_personas.conversion_triggers
    engagementFormats: string[];                      // NEW — contact_personas.engagement_formats
  };
  identities: Array<{
    id: string;                                       // v1
    platform: string;                                 // v1
    platformHandle: string | null;                    // v1
    displayName: string | null;                       // v1
    followersCount: number | null;                    // v1
    followingCount: number | null;                    // v1
    postsCount: number | null;                        // v1
    listedCount: number | null;                       // v1
    engagementRate: number | null;                    // v1
    statsUpdatedAt: number | null;                    // v1
    metricSnapshotAt: number | null;                  // v1
    avatarUrl: string | null;                         // NEW
    bio: string | null;                               // NEW
    location: string | null;                          // NEW
    isVerified: boolean | null;                       // NEW
    platformCreatedAt: number | null;                 // NEW — unix seconds; UI derives account age
    platformUrl: string | null;                       // NEW — handle links out
    isPrimary: boolean;                               // NEW — header selection (§11.1)
  }>;
  niches: Array<{ /* v1 — unchanged */
    id: string; name: string; slug: string; nicheType: string; weight: number | null;
  }>;
  relationship: {                                     // NEW — null when no owner or no edge (§9)
    label: "Follower" | "Following" | "Mutual" | "Connected";
    edgeType: "follows" | "connected_to";
  } | null;
  org: {                                              // NEW — null when none (§10.2)
    id: string;
    name: string;
    domain: string | null;      // orgs has NO slug column; domain is the stable secondary key
    avatarUrl: string | null;
  } | null;
  recentPosts: Array<{                                // NEW — ≤5, ordered newest first (§10.3)
    id: string;                 // content_items.id
    contentType: string;
    platform: string | null;    // content_items.platform_target
    text: string;               // title ?? body, server-truncated to 280 chars + "…"
    url: string | null;         // content_posts.platform_url when available
    publishedAt: number | null; // content_posts.published_at ?? content_items.created_at
  }>;
};
```

Query layer stays `getContactExploreCard(contactId)` in `src/lib/db/queries/contact-explore.ts` — batched queries in one synchronous assembly (existing style), no client N+1. No new query params; owner resolution is internal (§9).

## 9. Owner contact + relationship derivation (design questions 3–4)

### 9.1 Owner resolution rule

No owner/self concept exists in the schema today, and `platform_accounts` stores no queryable platform user id (credentials are encrypted). Decision — **Option A, explicit marker column**:

- **New additive migration:** `contacts.is_self` (`integer`, boolean mode, `NOT NULL DEFAULT 0`). Standard Drizzle migration + empty-DB and upgrade tests per repo convention. This is the only schema change in #84.
- **Owner :=** the contact with `is_self = 1`. Write-path invariant: at most one — setting `is_self = 1` clears the flag on all other contacts in the same transaction. Read-path guard: if the invariant is ever violated, lowest `created_at` wins (deterministic).
- **Setter:** additive optional `is_self` boolean param on the `update_contact` agent tool ("mark this contact as me"), enforcing the clear-others transaction. No dashboard UI for setting it in #84 — account/owner settings UX belongs to #87.
- **Unknown owner ⇒ `relationship: null`** and the chip simply doesn't render. Same when the displayed contact *is* the owner.

Rejected alternatives: reserved `"self"` tag in `contacts.tags` (zero-migration but stringly, user-editable through tag UI, no uniqueness enforcement); deriving owner from `platform_accounts` (no plaintext platform user id to match on). Trade-off accepted: one tiny migration buys a deterministic, agent-settable, queryable rule.

### 9.2 Relationship label mapping

Given owner `O` and displayed contact `C` (`C ≠ O`), consider **shared-scope** `graph_edges` with `srcType = dstType = 'contact'` between `C` and `O`:

| Edge evidence | Label |
|---|---|
| `follows` C→O **and** `follows` O→C | `Mutual` |
| `follows` C→O only | `Follower` (they follow the owner) |
| `follows` O→C only | `Following` (the owner follows them) |
| `connected_to` either direction (symmetric semantics) | `Connected` |

Precedence when multiple edge types exist: `Mutual` > `Follower` > `Following` > `Connected`. `edgeType` in the response is the edge that produced the label (`follows` for the first three). Only `scope = 'shared'` edges count — consistent with the niche filter; `follows`/`connected_to` default shared per ADR-022-2, and `local_only` relationship edges must not surface (schema §6 read rule).

## 10. Derivation rules for org and posts (design questions 5–6)

### 10.2 Org badge precedence

Edges `edgeType = 'works_at'`, `srcType = 'contact'`, `srcId = C`, `dstType = 'org'`, `scope = 'shared'` on **both** the edge and the joined org row (`orgs.scope = 'shared'`). When multiple match, order by `last_seen_at DESC` (current employer signal), then `weight DESC` (nulls last), then `orgs.name ASC` (deterministic); take the first. Badge links to `/dashboard/organizations/[id]` via a plain anchor (drawer-safe, §11.3).

### 10.3 Recent posts selection

- **Source filter:** `content_items.contact_id = C` AND `origin IN ('received', 'imported')` (schema §7) AND `content_type NOT IN ('dm', 'email')`. `content_items` has no `scope` column, so the content-type filter **is** the privacy boundary: DMs and emails are private correspondence and must never render on an explore surface that will be reused in the shared map drawer. Document-level test required (§12).
- **N = 5**, ordered by `COALESCE(content_posts.published_at, content_items.created_at) DESC`.
- **URL join:** left-join `content_posts` on `content_item_id`; when multiple post rows exist, prefer the one with a non-null `platform_url` and the latest `published_at`. `url: null` renders text without an external link.
- **Text:** `title ?? body ?? ""`, server-truncated to 280 chars with a trailing `…` when cut (bounded payload; tweet-length covers the preview). Items with neither title nor body are skipped.

### 10.4 Account age formatting (design question 8)

Signal-parity: **"2,331 days on X"** — `formatAccountAge(platformCreatedAt, platformLabel)` returning `"${days.toLocaleString()} days on ${label}"`, computed from `platform_created_at` to now, floored to whole days. The distinctive day count *is* the parity target; no humanized `6y` variant. Hidden when `platformCreatedAt` is null.

## 11. UI (design questions 7, 10)

### 11.1 Section order (top → bottom)

```
┌─ Identity header ────────────────────────────────┐
│ [avatar]  Name  ✓verified   [Follower] [@ Org]   │
│           @handle · Location · 2,331 days on X   │
│           bio (primary identity, 2-line clamp)   │
├─ Persona ────────────────────────────────────────┤
│ archetype badge · tone · confidence · summary    │
│ INTERESTS chips                       (v1)       │
│ WHAT CONVERTS THEM chips              (new)      │
│ FORMATS THEY ENGAGE WITH chips        (new)      │
├─ Platform stats (per identity) ──────────────────┤
│ [avatar] Platform ✓  @handle                     │
│ Followers · Following · Posts · Listed           │
│ Engagement rate · 2,331 days on X     (new age)  │
├─ Niches ─────────────────────────────────────────┤
│ chips (v1 unchanged)                             │
├─ Recent posts ───────────────────────────────────┤
│ • text preview (3-line clamp) · date · ↗ link    │
│   (≤5 items; section hidden when empty)          │
└──────────────────────────────────────────────────┘
```

- **Consolidated header, not one header per identity** (design question 7): the persona is the cross-platform synthesis, so the card header is too. Header identity = the `isPrimary` identity; fallback: highest `followersCount`, then earliest `created_at`; when the contact has zero identities the header renders from the `contact` block (name/avatar/location) alone. Per-identity detail (avatar, verified, account age) still appears on each platform-stats row, so nothing is hidden by consolidation.
- Relationship chip and org badge render in the header row; each hidden when null. Empty states: existing v1 texts unchanged; recent-posts section renders "No synced posts yet." only on the dashboard tab (drawer may hide empty sections).

### 11.2 Component factoring

`ContactExploreCardView` keeps its exact v1 props — `{ contactId: string; explore: ContactExploreCard }` — so the #85 drawer embeds it by passing a fetched projection. Internally split into subcomponents (same directory, exported for reuse/tests): `ExploreIdentityHeader`, `ExplorePersonaSection` (absorbs existing persona JSX), `ExplorePlatformStats`, `ExploreNicheChips`, `ExploreRecentPosts`.

### 11.3 Drawer-readiness constraints (#85)

- No `next/navigation` router hooks, no route-param reads, no dashboard-layout assumptions inside the card; links are plain anchors.
- Persona generate/refresh actions remain (they only need `contactId` + REST).
- The card must render correctly at drawer width (~360–420px): the stats grid already collapses to 2 columns; header wraps chips below the name.

## 12. Privacy rules (additions — design question 9)

1. `conversionTriggers` / `engagementFormats` follow **exactly** the v1 persona rules: `local_only` persona ⇒ `visibility: "local_only"` and both arrays empty; absent ⇒ empty. Parsed with the same tolerant JSON-array parser as `interests` (malformed ⇒ `[]`, never throws).
2. Relationship chip derives from `scope = 'shared'` edges only; `properties_private` is never read (§9.2).
3. Org badge: shared-scope edge **and** shared-scope org only (§10.2).
4. Recent posts: `dm`/`email` content types excluded at the query layer (§10.3); `platform_data` is not spread into the response — only the enumerated fields.
5. `contacts.is_self` is an app-local marker; it is **not** included in `ContactExploreResponse`.

## 13. Design decisions (System Design, 2026-08-15)

1. **Addendum over new spec file** — `ui-4.3` is taken; one canonical explore-card contract, versioned in place.
2. **`contacts.is_self` owner marker** (§9.1) — the only schema change; deterministic and agent-settable; rejected tag-based and platform-account-based alternatives.
3. **Relationship from shared edges with Mutual > Follower > Following > Connected precedence** (§9.2) — labels match Signal's chip vocabulary; direction semantics documented once.
4. **Org shape uses `domain`, not `slug`** — `orgs` has no slug column; link path corrected to `/dashboard/organizations/[id]` (issue #84 text says `/dashboard/orgs/[id]`, which does not exist).
5. **DM/email exclusion is the posts privacy boundary** (§10.3) — `content_items` has no scope column; content-type filtering is enforced in the query layer with a sentinel test.
6. **Self-contained `contact` block** — the drawer (#85) renders the header without a second fetch; costs ~5 fields on a response that already joins `contacts`.
7. **Day-count account age** (§10.4) — literal Signal parity beats humanized durations.
8. **Consolidated identity header, per-identity detail preserved** (§11.1) — matches the per-contact persona boundary in schema §7's closing paragraph.

## 14. Tests (v2)

1. **Query unit** (`contact-explore.test.ts` extensions): seeded identity fields surface (`avatarUrl`, `isVerified`, `platformCreatedAt`, `isPrimary`); persona triggers/formats parse (incl. malformed JSON ⇒ `[]`); relationship derivation — each label, precedence, no-owner ⇒ null, self-view ⇒ null, `local_only` edge ignored; org precedence (`last_seen_at` > weight > name) and `local_only` org/edge excluded; recent posts — N=5 cap, ordering, URL join, truncation, and **privacy sentinel: seeded `dm` + `email` items never appear**.
2. **Migration test**: `is_self` column exists on empty-DB and upgraded-DB paths; `update_contact` with `is_self: true` clears the previous owner (invariant).
3. **API route test**: 200 fixture includes new fields; 404 unchanged.
4. **Component smoke** (`renderToStaticMarkup`): header renders avatar/name/verified/age; new chip rows render; relationship chip and org badge render when provided and are absent when null; posts list renders text + link; `local_only` persona still leaks nothing (extended sentinel covers the two new arrays).

## 15. Acceptance (#84)

- [ ] `contacts.is_self` migration + write-path invariant + `update_contact` param
- [ ] `GET /api/contacts/[id]/explore` matches §8 shape (additive; v1 fields unchanged)
- [ ] Derivation rules §§9–10 implemented in `getContactExploreCard` (single-pass, no client N+1)
- [ ] Audience tab renders §11.1 section order with graceful empty states
- [ ] `ContactExploreCardView` props unchanged; subcomponents per §11.2; drawer constraints §11.3 respected
- [ ] Privacy rules §12 enforced with sentinel tests (persona arrays, DM/email posts, local_only edges/orgs)
- [ ] `npm run check` green
