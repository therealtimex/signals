# UI 4.6 — Audience map (/dashboard/explore constellation)

**Status:** Approved v1 (System Design, 2026-08-16) — Dev implements exactly this surface; contract changes go back through design.
**Issue:** [#85](https://github.com/therealtimex/signals/issues/85) · **Epic:** [#83](https://github.com/therealtimex/signals/issues/83) · **Parents:** `signals-spec-v0.5.md` §4.B, `ui-4.2-contact-explore.md` §11.3
**Note:** numbered 4.6 — `ui-4.4` (launches hub) and `ui-4.5` (wind tunnel runs) are taken; the Dev handoff's suggested `ui-4.4-explore-map.md` would collide.

## 1. Scope

New `/dashboard/explore` page rendering the owner-centered audience graph as an interactive 2D force constellation, with a slide-over drawer embedding the #84 `ContactExploreCardView` on contact-node click.

Surfaces in scope:

1. `GET /api/explore/map` — one new REST route (thin adapter per `ui-4.1` conventions)
2. `getExploreMap()` — one new query-layer function (single-pass assembly, no client N+1)
3. `/dashboard/explore` page + client map component + contact drawer
4. Sidebar nav entry **Explore**
5. Loading / empty / truncated states

**Out of scope (explicit):** Launch bridge (#86); account picker (#87); niche clustering job; niche detail drawer or page; org/goal/content/interaction node layers; WebGL shaders / custom render passes; real-time sync animation; map search, filtering, or layout persistence; graph editing from the map; 3D mode.

## 2. Node & edge model (design decisions)

### 2.1 One node per contact, not per identity

Nodes are **contacts** (golden records), never `contact_identities`. Rationale: identity resolution is the graph engine's job (spec §4.A); all v1 edge types (`follows`, `connected_to`, `belongs_to_niche`) are contact-scoped in `graph_edges`; and #84 already consolidated identities per contact in the explore card (ui-4.2 §11.1). Platform-colored rings per identity are rejected for v1 — they imply per-identity edges we do not store.

### 2.2 Graph scope: owner-centered 1-hop audience + niche layer

- **Owner** = `getOwnerContactId()` (`contacts.is_self`, oldest wins — existing helper).
- **Audience contacts** = contacts joined to the owner by a `shared`-scope `follows` edge (either direction) or `connected_to` edge. This is the "X-follower subgraph" of spec §4.B generalized to the platform-agnostic edge layer.
- **Inter-audience edges**: `shared` `follows` / `connected_to` edges *between* included audience contacts are also returned — they are what makes the constellation a graph rather than a star.
- **Niche layer**: niches referenced by a `shared` `belongs_to_niche` edge from any *included* contact (owner included), where the niche row is `scope = 'shared'` and `status NOT IN ('merged', 'archived')`. Niches with no included member are omitted.
- Contacts have no `scope` column; edge scope is the privacy boundary (same rule as #84 §12). `properties_private` is never read; `includeLocalOnly` is **not** a supported param on this route.

### 2.3 Edge collapsing

- A mutual follow pair (A→B and B→A) collapses at the query layer into **one** edge with `mutual: true`. Non-mutual follows keep `source` = follower, `target` = followed, `mutual: false`.
- `connected_to` is undirected; emit once per unordered pair with `mutual: null`.
- `belongs_to_niche` keeps `source` = contact node, `target` = niche node, and carries the edge `weight` (confidence hint, same semantics as ui-4.2 niche chips).

### 2.4 Node identity namespacing

Graph node ids are prefixed — `contact:<id>` / `niche:<id>` — so contact and niche id spaces can never collide in the force-graph's flat node array. The raw row id travels separately as `entityId`.

## 3. API

`GET /api/explore/map`

| Param | Type | Default | Notes |
|-------|------|---------|-------|
| `limit` | int 1–500 | 200 | Max **audience contact** nodes (owner and niches excluded from the count) |

- Zod-validated; invalid `limit` → 400 `VALIDATION_ERROR` via `toErrorResponse` (shared errors helper).
- **No owner configured** is a 200 with empty `nodes`/`edges` and `meta.ownerContactId: null` — it is an onboarding state, not an error.
- camelCase fields, unix-seconds timestamps, JSON parsed at the boundary (ui-4.1 §1 conventions).

### 3.1 Response shape

```typescript
type ExploreMapNode =
  | {
      id: string;                 // "contact:<id>"
      kind: "contact";
      entityId: string;
      label: string;              // contacts.name
      avatarUrl: string | null;
      isOwner: boolean;
      followersCount: number | null; // max followersCount across the contact's identities (metric-precedence rule of ui-4.2 §2); null when unknown — drives node sizing
      nicheIds: string[];         // raw niche ids of this contact's included belongs_to_niche edges — drives node coloring
    }
  | {
      id: string;                 // "niche:<id>"
      kind: "niche";
      entityId: string;
      label: string;              // niches.name
      nicheType: string;
      memberCount: number;        // included members only, not global count
    };

type ExploreMapEdge = {
  id: string;                     // graph_edges.id of the surviving row after collapse
  source: string;                 // node id (prefixed)
  target: string;                 // node id (prefixed)
  kind: "follows" | "connected_to" | "belongs_to_niche";
  mutual: boolean | null;         // follows: true/false; others: null
  weight: number | null;
};

type ExploreMapResponse = {
  nodes: ExploreMapNode[];
  edges: ExploreMapEdge[];
  meta: {
    ownerContactId: string | null;
    totalContacts: number;        // audience size before truncation (owner excluded)
    shownContacts: number;        // audience nodes returned
    truncated: boolean;
    limit: number;
  };
};
```

### 3.2 Truncation rule (`limit`)

Audience contacts are ordered by their owner-edge `last_seen_at DESC` (recency of the relationship signal), tie-break `contacts.name ASC`, then `contacts.id ASC` (fully deterministic); the first `limit` rows are kept. `meta.totalContacts` counts the full audience so the UI can badge truncation. Inter-audience and niche edges are computed **after** truncation, against the included set only — the response never references a node it doesn't contain. The 500 cap keeps `inArray` binds well under SQLite parameter limits.

## 4. Query layer

New `getExploreMap(opts?: { limit?: number }): ExploreMapResponse` in `src/lib/db/queries/explore-map.ts`.

Assembly plan (bounded round-trips, no per-node queries):

1. `getOwnerContactId()`; null → empty response.
2. Owner-adjacent `shared` edges, `edgeType IN ('follows','connected_to')`, both directions (one query each direction or reuse `queryGraphEdges` pattern); dedupe, rank, truncate per §3.2.
3. One `inArray` fetch of included contact rows (owner + audience): `id`, `name`, `avatarUrl`.
4. One query for `followersCount`: max over `contact_identities` denormalized column vs latest `identity_metrics` snapshot, reusing the metric-precedence helper from `contact-explore.ts` (extract/share, don't duplicate).
5. Inter-audience `shared` `follows`/`connected_to` edges via `inArray` on both endpoints; collapse per §2.3.
6. `shared` `belongs_to_niche` edges for included contacts via `inArray`, joined to `shared` non-merged/archived niche rows; build niche nodes + `memberCount` + per-contact `nicheIds`.

The route handler stays a thin adapter: parse params → call `getExploreMap` → `NextResponse.json`, errors via `toErrorResponse` (same shape as `explore/route.ts` for contacts).

## 5. UI

### 5.1 Dependency

Add **`react-force-graph-2d`** (2D-only package — avoids the three.js/A-Frame payload of the combined `react-force-graph`). Canvas rendering; imported client-side only via `next/dynamic` with `ssr: false` inside a client component (App Router: the dynamic import must live in a `"use client"` module).

### 5.2 Page & component breakdown

| Piece | Path | Responsibility |
|-------|------|----------------|
| Page | `src/app/dashboard/explore/page.tsx` | Server component shell: page title/header chrome, renders the client view. No data fetch — the graph is client-only, so data loads client-side (this page is the sanctioned exception to the server-component-fetch preference of ui-4.2 §3, and the reason the REST route exists). |
| Map view | `src/components/explore/explore-map-view.tsx` (client) | Fetches `GET /api/explore/map` on mount; owns loading/empty/error states; full-viewport `ForceGraph2D` sized to container (resize-observed); count badge; node click → drawer (contact) / tooltip only (niche); hover tooltip = node label. |
| Drawer | `src/components/explore/explore-contact-drawer.tsx` (client) | shadcn `Sheet`, `side="right"`, content width ~400px (within the 360–420px band of ui-4.2 §11.3), internally scrollable. Fetches `GET /api/contacts/[id]/explore` **on open**, renders `ContactExploreCardView contactId={id} explore={fetched}` unchanged. Skeleton while loading; on fetch error, message + plain-anchor link to `/dashboard/contacts/[id]` (Audience tab fallback per issue acceptance). |
| Nav | `src/components/app-sidebar.tsx` | Insert `{ title: "Explore", href: "/dashboard/explore", icon: Telescope }` (lucide) between **Dashboard** and **Contacts** — headline experience placement. Active-state rule already generalizes (`pathname.startsWith`). |

**Drawer data decision — client fetch on open**, not server-prefetched projections for every node: prefetching N cards would multiply the map query cost by the per-card assembly cost for cards mostly never opened; the card is drawer-ready precisely so it can be fed a lazily fetched projection (ui-4.2 §11.2/§11.3). Re-opening the same node within the page session may reuse a simple in-memory cache keyed by contact id (optional; not a contract).

### 5.3 Visual rules

- Node color by kind: owner (accent/primary), audience contact (muted foreground), niche (per-`nicheType` categorical hue from the chart token palette — reuse `src/components/charts` token conventions; no hardcoded hex).
- Node size (`val`): contacts scaled by `log10(followersCount + 1)`, clamped; owner gets a fixed larger size; niches sized by `log`-scaled `memberCount`.
- Edge styling: `follows`/`connected_to` solid low-alpha; `mutual: true` slightly heavier; `belongs_to_niche` dashed/lighter so the niche layer reads as grouping, not connection.
- Labels: render on hover always; render inline only above a zoom threshold (canvas `nodeCanvasObject` label at zoom > ~1.5) to keep large graphs legible.

### 5.4 States

| State | Trigger | Render |
|-------|---------|--------|
| Loading | fetch in flight | Centered spinner/skeleton in the viewport region (existing dashboard skeleton conventions) |
| Empty — no owner | `meta.ownerContactId === null` | `EmptyState` component: "Mark your own contact to see your audience" + hint that agents set `is_self` (`update_contact`) |
| Empty — owner, no audience | owner set, `totalContacts === 0` | `EmptyState`: "No audience connections synced yet" |
| Loaded | nodes present | Graph + count badge |
| Error | non-200 / network | `EmptyState` with retry button (re-fetch) |

**Count badge** (top corner overlay, `Badge` component): untruncated → `"{totalContacts} people · {nicheCount} niches"`; truncated → `"Showing {shownContacts} of {totalContacts} people · {nicheCount} niches"`. Niche count is never truncated (it derives from shown members), so it needs no of-N form.

## 6. Privacy rules

1. Only `scope = 'shared'` graph edges are read; `includeLocalOnly` is not accepted on this route.
2. Only `scope = 'shared'`, non-merged/archived niches appear; `local_only` niches are excluded even if a shared edge points at them (join-side filter, sentinel test required — parity with #84 §12.3).
3. The map response contains no persona, relationship-stage, notes, or interaction data — node payload is limited to the enumerated fields in §3.1. Persona privacy is enforced downstream by the drawer's `/api/contacts/[id]/explore` fetch, which already implements the #84 rules.
4. `properties` / `properties_private` on edges are never returned by this route.
5. `is_self` is exposed only as the derived `isOwner` flag (needed for rendering); the raw column stays out of the response.

## 7. Tests

### 7.1 Query unit — `src/lib/db/queries/explore-map.test.ts`

1. No owner ⇒ empty nodes/edges, `meta.ownerContactId: null`.
2. Audience inclusion: incoming follow, outgoing follow, `connected_to` each pull the contact in; unrelated contacts stay out.
3. **Privacy sentinels:** seeded `local_only` follows edge excluded; `local_only` niche (and its edge) excluded despite shared membership edge; edge `properties_private` never in output.
4. Mutual collapse: A↔B ⇒ one edge, `mutual: true`; one-way ⇒ `mutual: false` with correct direction.
5. Inter-audience edges: included pair's edge present; edge to a truncated-out contact absent (no dangling endpoint — assert every edge endpoint exists in `nodes`).
6. Niche layer: niche nodes only for included members; `memberCount` counts included members only; `nicheIds` populated on contact nodes; merged/archived niches excluded.
7. Truncation: `limit` respected; deterministic order per §3.2; `meta` counts and `truncated` flag correct.
8. `followersCount`: snapshot-over-column precedence and max-across-identities.

### 7.2 API route — `src/app/api/explore/map/route.test.ts` (or colocated per repo convention)

1. 200 fixture matches §3.1 shape (prefixed ids, meta block).
2. `limit=0`, `limit=501`, `limit=abc` ⇒ 400 `VALIDATION_ERROR`.
3. No-owner DB ⇒ 200 empty (not 4xx/5xx).

### 7.3 Component smoke (`renderToStaticMarkup`, force-graph mocked)

`ForceGraph2D` is canvas-based and cannot render in the test environment — mock the dynamic import; smoke tests cover the non-canvas chrome:

1. Count badge renders both truncated and untruncated variants.
2. Empty states: no-owner and no-audience texts render.
3. Drawer: given a fetched `ContactExploreCard` fixture, renders `ContactExploreCardView` output (reuses #84 fixture); error state renders the contact-page fallback anchor (`/dashboard/contacts/[id]`).
4. Sidebar: Explore entry present with correct href.

### 7.4 Gate

`npm run check` green (lint + typecheck + vitest suite).

## 8. Design decisions (System Design, 2026-08-16)

1. **New sibling spec `ui-4.6`** — §4.B of `signals-spec-v0.5.md` is a one-paragraph module description; the implementable contract lives here, following the ui-4.x pattern. Numbered 4.6 to avoid the 4.4/4.5 collision.
2. **One node per contact** (§2.1) — rejected per-identity nodes and platform rings for v1.
3. **Owner-centered 1-hop + inter-audience edges + niche layer** (§2.2) — rejected "all contacts" scope (unbounded, mostly disconnected) and multi-hop traversal (no v1 use case).
4. **Client fetch for both map and drawer** (§5.2) — the graph is client-only; drawer lazily fetches the existing explore REST route on open. Rejected server-prefetching per-node cards.
5. **`react-force-graph-2d`** (§5.1) — 2D-only package; 3D/VR bundles rejected as dead weight.
6. **Truncation by owner-edge recency** (§3.2) — rejected followersCount ordering (biases toward celebrities over active audience) and random sampling (non-deterministic tests).
7. **Mutual-collapse at the query layer** (§2.3) — the API stays render-agnostic; clients should not need to dedupe.
8. **No-owner is 200-empty, not an error** (§3) — onboarding state; the page owns the guidance copy.
9. **Prefixed node ids** (§2.4) — removes a whole class of cross-table id-collision bugs in the flat node array.

## 9. Acceptance (#85)

- [ ] `react-force-graph-2d` added; graph renders client-side only (no SSR import errors)
- [ ] `GET /api/explore/map` matches §3.1 exactly; params/errors per §3; thin adapter over `getExploreMap`
- [ ] `getExploreMap` implements §2 scope, §2.3 collapsing, §3.2 truncation in bounded round-trips
- [ ] `/dashboard/explore` page + `ExploreMapView` + `ExploreContactDrawer` per §5.2; drawer embeds `ContactExploreCardView` with unchanged props
- [ ] Sidebar **Explore** entry per §5.2
- [ ] States and count badge per §5.4
- [ ] Privacy rules §6 enforced with sentinel tests
- [ ] Test matrix §7 implemented; `npm run check` green
