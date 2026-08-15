# UI 4.4 — Launches hub (list, detail, variant board)

**Status:** Approved (System Design, 2026-08-15) — Dev implements exactly this surface.
**Issue:** [#55](https://github.com/therealtimex/signals/issues/55) · **Epic:** [#51](https://github.com/therealtimex/signals/issues/51)
**Base:** `main` @ `0b5582d` (#54 merged)

## 1. Scope

Net-new dashboard section for GTM launches, backed entirely by the #52 query layer and REST surface:

| Route | Purpose |
|-------|---------|
| `/dashboard/launches` | Searchable, filterable launch list with create dialog |
| `/dashboard/launches/[id]` | Launch brief, audience spec, linked goals, variant board, edit/add dialogs |

Plus two cross-cutting touches: a sidebar **Launches** nav entry (§3.4) and the #54 follow-up that wires the Wind Tunnel launch-name stub to the real detail route (§3.5).

**Out of scope:** running/calibrating simulations from the dashboard (agent-tools-only, ui-4.1 §2), publishing variants (400 over REST by design; sanctioned paths unchanged), goal linking/unlinking (graph edges are agent-owned), audience-spec editing (freeform JSON; agent-owned), variant generation, simulation run timeline and transcripts (#56), launch/variant deletion (no REST route exists — do not add one).

## 2. Data contract

**No new query functions and no new routes.** Both pages are **server components** calling the query layer directly (#53/#54 pattern); `GET /api/launches` and `GET /api/launches/[id]` remain the parallel REST surface for non-dashboard consumers, and the v1 write routes (`POST/PUT /api/launches*`, `POST .../variants`, `PUT /api/variants/[id]`) are what the dialogs call (§3.3).

- **List page:** `listLaunches({ search, status, page, pageSize: 20, includeLocalOnly })` — all params URL-driven (§3.1).
- **Detail page:** `getLaunchWithDetails(id, { includeLocalOnly: true })`; unknown id → `notFound()`. Passing `includeLocalOnly: true` is correct here: detail-by-ID surfaces don't scope-gate (ui-4.1 §6 rule 2) and the user must see their own local-only goal links.
- **Goal names:** the detail page resolves `goalIds` via existing `getGoal(id)` (`queries/goals.ts`) and renders name chips; ids that no longer resolve (deleted goals) are skipped. No batch query — launches link to a handful of goals and this is local SQLite.

### 2.1 Sanctioned additive change: `LaunchVariantSummary`

The variant board needs four fields the summary currently drops. Extend `LaunchVariantSummary` (`queries/launches.ts`) **additively**:

```typescript
export type LaunchVariantSummary = {
  id: string;
  label: string | null;
  status: string;
  predictedScore: number | null;
  // NEW ↓
  variantType: string;
  predictionConfidence: number | null;
  simulatedAt: number | null;
  contentItemId: string | null;   // the "published_as" link target
};
```

This flows additively into `GET /api/launches` and `GET /api/launches/[id]` responses and any agent-tool payload embedding the summary — intentional and safe per the ui-4.1 §5 precedent (existing consumers ignore unknown fields). Add the one-line note to `docs/agent-tools.md` if the summary appears there. **No other DTO, serializer, or route change.**

## 3. UI

### 3.1 List — `/dashboard/launches`

`page.tsx` (server) + `launches-list-client.tsx` (client), exactly the goals/content split. Header: `text-heading-1` "Launches" + subtitle "Plan GTM launches and compare variants in the Wind Tunnel."

**Table, not card grid** (decision §5.1) — `Table` from `ui/table`, content-list idiom:

| Column | Render |
|--------|--------|
| Name | launch name; `Badge variant="outline"` **Private** when `scope === "local_only"` |
| Status | `Badge` per status (launch enum: `draft · generating · simulating · ready · live · completed · archived`) |
| Variants | `{n} variant(s)`, plus ` · {m} published` when any summary has status `published` |
| Goals | linked-goal count from `goalIds` (names live on detail — keeps list rows to data already loaded) |
| Updated | `formatDate(updatedAt)` (local helper, #54 style) |

Row click navigates to `/dashboard/launches/[id]` (whole-row `Link`/router-push, content-list idiom).

**Controls row:**
- Status filter: `Tabs` (goals idiom) — "All" + the 7 statuses; sets `?status=`, clears `?page`.
- Search: `Input` bound to `?search=` on submit/Enter (contacts idiom); server passes it to `listLaunches` (substring match on name).
- **Include private** `Switch` → `?includeLocalOnly=true`; default off, mirroring the API/list default `scope=shared` (ui-4.1 §6 rule 1). When on, private rows appear with the badge.
- "New launch" `Button` → launch dialog (§3.3).

Pagination: `PaginationControls`, pageSize 20 (REST default). Empty states: no launches at all → `EmptyState` (icon `Rocket`) "No launches yet" / "Create a launch here or from your terminal agent to start testing content in the Wind Tunnel." + New launch button; filters active but zero rows → the goals-style centered "No launches match the current filters."

### 3.2 Detail — `/dashboard/launches/[id]`

**Single-column card stack** (decision §5.2), content-detail idiom, in this order:

1. **Header block** (not a card): back link ("← Launches"), launch name `text-heading-1`, status `Badge`, **Private** badge when `local_only`, `primaryPlatform` badge when set, `launchedAt`/`completedAt` line when set, "Edit" button → launch dialog.
2. **Shared-scope guard callout** — only when `scope === "local_only"`: a full-width muted callout (bordered `div`, not a new component): **"Private launch — Wind Tunnel simulation is blocked."** body: "Simulations only run against shared launches. Set scope to Shared (Edit above, or via your terminal agent) to simulate variants." This is the §6-rule messaging surface the issue's second acceptance test asserts; it names the unblock action and sits directly above the board whose predicted columns will be empty.
3. **Brief card** — `brief` as `whitespace-pre-wrap` text; null → "No brief yet."
4. **Audience card** — from parsed `audienceSpec`: render `nicheIds` as a count + monospace id chips and `sampleSize` when present; any remaining keys as a small `<pre>` JSON block; `{}` → "No audience spec yet." Read-only (out of scope §1).
5. **Linked goals card** — resolved goal name chips linking to `/dashboard/goals/[id]`; none → "No linked goals. Link goals from your terminal agent."
6. **Variant board card** (last, full card width) — see below.

**Variant board** — a `Table` (one row per variant; kanban-style columns are wrong for a ≤handful of variants compared on numbers):

| Column | Render |
|--------|--------|
| Label | `label` ?? "Untitled"; `variantType` as small outline badge |
| Status | `Badge` — variant enum `draft → simulated → selected/rejected → published` |
| Predicted score | `predictedScore.toFixed(2)`; null → `—` |
| Confidence | `(predictionConfidence * 100).toFixed(0)%`; null → `—` |
| Simulated | `formatDate(simulatedAt)`; null → `—` |
| Content | when `contentItemId` set: `Link` "View post →" to `/dashboard/content/[contentItemId]`; else `—` |
| (actions) | "Edit" → variant dialog; **disabled with tooltip "Published variants are read-only" when status is `published`** |

Sort: `predictedScore` desc, nulls last, tiebreak `createdAt` asc — done in the component (the board's job is ranking variants; the query keeps its stable order for other callers). Card header carries an "Add variant" button. Empty board → "No variants yet. Add one here or generate variants with your terminal agent."

### 3.3 Dialogs (v1 writes — decision §5.3)

Two dialogs, both `GoalDialog` pattern exactly: client component, `Dialog` + controlled fields, `fetch` to REST, error line from the `{ error }` envelope, `router.refresh()` on success. Enums come from the registries (`LAUNCH_STATUSES`/`VARIANT_STATUSES` in `gtm-status.ts`, `PLATFORMS`) — never hand-copied literals.

- **Launch dialog** (create from list; edit from detail): `name` (required), `brief` (`Textarea`), `status` (`Select`, launch enum), `primaryPlatform` (`Select`, PLATFORMS + "None"), `scope` (`Select`: Shared / Private (local only)). POST `/api/launches` / PUT `/api/launches/[id]`. PUT sends the full editable set with `name` (ui-4.1 §3.3). `audienceSpec`, `metadata`, timestamps: not editable — omitted from the payload so the query layer preserves existing values.
- **Variant dialog** (add + edit from board): `label`, `variantType` (`Select`, VARIANT_TYPES), `body` (`Textarea`), `status` (`Select` offering **`draft · selected · rejected` only** — `simulated` is pipeline-owned, `published` is 400 over REST; when editing a currently-`simulated` variant the select shows it as the disabled current value and picking selected/rejected is the intended pick-the-winner action). POST `/api/launches/[id]/variants` / PUT `/api/variants/[id]`. Published variants never open the dialog (§3.2 row rule).

No delete anywhere (§1).

### 3.4 Nav

`app-sidebar.tsx` main items: insert `{ title: "Launches", href: "/dashboard/launches", icon: Rocket }` (lucide `Rocket`) **after Content, before Automation** — launches sit between content production and automation in the GTM flow, and the existing `pathname.startsWith` active-state logic needs no change.

### 3.5 #54 follow-up (in this diff)

`wind-tunnel-section.tsx`: replace the `<a href="#" title="Launch detail coming soon">` stub with `next/link` `Link` to `` `/dashboard/launches/${launch.id}` `` (drop the title). Update the #54 component test that pins the `#` stub to assert the real href. No API/query change — exactly the one-line wiring #54 §5.6 planned for.

## 4. Tests

Pattern: component smoke via `renderToStaticMarkup` (#53/#54 precedent) + query/route deltas. Fixture: one shared launch linked to one goal, with 2 variants — one `draft` (no predictions), one `published` with `predictedScore`/`predictionConfidence`/`simulatedAt`/`contentItemId` set; plus one `local_only` launch.

1. **Query test** (`launches.test.ts` delta): `getLaunchWithDetails` summaries carry the four new fields (§2.1).
2. **Route regression** (existing launches route tests): extend list + detail assertions with the new summary fields — additive only, envelope unchanged.
3. **List smoke:** seeded launch renders name, status badge, "2 variants · 1 published", goal count; `local_only` launch absent by default, present with **Private** badge when `includeLocalOnly` data is passed.
4. **Detail smoke (issue acceptance 1):** brief, goal-name chip with `/dashboard/goals/` href, board rows — draft row shows `—` for score/confidence/simulated, published row shows formatted values and `/dashboard/content/` link.
5. **Guard smoke (issue acceptance 2):** `local_only` launch detail renders the §3.2.2 callout text and Private badge; shared launch renders neither.
6. **Wind Tunnel wiring:** updated #54 test asserts `/dashboard/launches/{id}` href.
7. `npm run check` green. Optional nice-to-have: dialog submit path exercised in a component test with a mocked `fetch`.

## 5. Design decisions (System Design, 2026-08-15)

1. **List = table, not card grid** — launches are compared on uniform scannable fields (status, counts, recency), which is the content-list situation, not the goals situation (goals cards earn their space with progress bars). A table also grows a column more cheaply than a card redesign when #56 adds simulation info. Trade-off: less visual weight for a marquee feature; the detail page carries that instead.
2. **Detail = single-column card stack, not two-column brief+board** — same rationale as #54 §5.2: the two-column layout restructures for one page, breaks at narrow widths, and the board is the widest element anyway so it wants the full column. Order puts identity/guard first, prose second, board last-and-widest.
3. **v1 ships minimal dialogs, not a read-only hub** — ui-4.1 §2 Q5 added the launch/variant write routes *specifically for #55's dialogs*; shipping read-only would strand that surface and force every small edit through the terminal agent. Scope is deliberately thin: no publish, no delete, no audience-spec/goal editing — those stay agent-owned so the dashboard cannot create states the pipeline guards against. Trade-off: two more client components to maintain, mitigated by cloning the proven GoalDialog shape.
4. **Guard UX = persistent callout on detail, not a disabled-board or hidden page** — the §6 badge rule covers *labeling*; the acceptance test wants *explanation*. A callout names the cause (private scope) and both unblock paths (edit scope here / terminal agent) without hiding data the local user legitimately owns. Simulation being blocked upstream (§8.1 write-path guard) means the UI never needs to enforce anything — it only explains.
5. **Status select in the variant dialog excludes pipeline-owned states** — `simulated` is written by the projection rule and `published` by the two sanctioned publish paths; offering them in a dropdown invites 400s (published) or lying state (simulated). The dialog offers exactly the human decisions: draft, selected, rejected.
6. **Summary extension over a second detail query** — the alternative (page calls `listVariantsByLaunchId` for full rows) forks the page from the REST detail response and leaks full `body`/`generationMetadata` into a board that renders neither. Four scalar fields on the existing summary keep page, REST, and agent tools on one shape (the #54 "one source" principle applied to a DTO instead of a function).
7. **Nav after Content with `Rocket`** — the sidebar reads as a funnel (people → content → launches → automation → analytics → goals); `Rocket` is the unclaimed, obvious glyph.

## 6. Acceptance

- [ ] `/dashboard/launches` list per §3.1 (table, status tabs, search, include-private switch, pagination, create dialog, empty states)
- [ ] `/dashboard/launches/[id]` per §3.2 (header, guard callout, brief, audience, goal chips, sorted variant board, edit/add dialogs)
- [ ] `LaunchVariantSummary` extended per §2.1; no other API shape change
- [ ] Sidebar Launches entry per §3.4; Wind Tunnel launch link wired per §3.5
- [ ] Tests §4 including both issue acceptance smokes; `npm run check` green
