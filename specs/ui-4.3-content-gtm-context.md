# UI 4.3 — Content detail GTM lineage & calibration (Wind Tunnel bridge)

**Status:** Approved (System Design, 2026-08-15) — Dev implements exactly this surface.
**Issue:** [#54](https://github.com/therealtimex/signals/issues/54) · **Epic:** [#51](https://github.com/therealtimex/signals/issues/51)
**Base:** `main` @ `a71172a` (#53 merged)

## 1. Scope

Extend `/dashboard/content/[id]` with a **Wind Tunnel** section showing the content item's GTM lineage and feedback loop, sourced entirely from data already stored by Phase 3 (#43–#50) and exposed by `GET /api/content/[id]/gtm-context` (#52):

| Block | Source | Notes |
|-------|--------|-------|
| Launch / variant lineage | `getVariantByContentItemId` → `getLaunchById` | launch name, status, scope; variant label, type, status |
| Projected scores | `variants.predicted_*` | score, confidence, model, simulated_at |
| Latest run | `listSimulationRuns({ variantId, status: "completed", pageSize: 1 })` | agent count, model, completed_at — no agents payload |
| Calibration summary | `getLatestCalibrationForRun(latestRun.id)` | predicted vs actual metric triples, score_error, observation window |
| Empty states | progressive nulls (§2) | actionable copy at every level |

**Out of scope:** launch/variant editing, running or calibrating simulations from this page (agent-tools-only per ui-4.1 §2), transcript display (#56), launches hub (#55), calibration history (latest row only, matching the API).

## 2. Data contract

**Reuse the #52 `gtm-context` projection unchanged — no new DTO.** To keep the page and the REST route from drifting, extract the assembly currently inlined in `src/app/api/content/[id]/gtm-context/route.ts` into a shared query-layer function:

```typescript
// src/lib/db/queries/content-gtm-context.ts
export function getContentGtmContext(contentItemId: string): ContentGtmContext | null;
// null when the content item does not exist (route maps this to 404 NOT_FOUND)
```

Return shape is exactly the ui-4.1 §4.8 response body: `{ contentItemId, variant, launch, latestRun, latestCalibration }` with **progressive nulls** — `variant: null` (no GTM lineage), `launch` null only when variant is null, `latestRun: null` (no completed run), `latestCalibration: null` (no calibration row). The route handler becomes a thin wrapper (404 + `NextResponse.json`); its behavior and response shape must not change.

### §8.5 display rules (issue acceptance)

1. Calibration values rendered on this page come **only** from the stored `simulation_calibrations` row (`actualMetrics`, `actualScore`, `scoreError`, `observedFrom`, `observedUntil`, `computedAt`). The UI must not recompute or "freshen" actuals from live engagement/interaction data — value invariance to `local_only` evidence is guaranteed upstream by the calibration pipeline (Phase 3 §7.2a, §8.5(3.4)) and holds on this surface precisely because we display stored rows verbatim.
2. Per-metric display error is derived render-side as `actual − predicted` for metrics present in both records; metrics present on one side only render `—` in the missing cell and the error cell. `scoreError` uses the stored column, never a recomputation.
3. `launch.scope === "local_only"` → render a **"Private launch"** badge (ui-4.1 §6 rule 2: any surface rendering launch/variant data must badge local_only; same rule as #53 personas). No content is hidden — detail-by-ID routes don't scope-gate and this is the local user's own dashboard.

## 3. UI

- **Data load: server component**, per the #53 pattern. `page.tsx` calls `getContentGtmContext(id)` directly and passes the result as a prop — no client fetch, no loading state. `GET /api/content/[id]/gtm-context` remains the parallel REST surface for non-dashboard consumers; the dashboard does not call it.
- **Inline section card, not a sidebar.** New `WindTunnelSection` component rendered as the **last card** in the existing single-column stack (after "Your Activity"), matching the page's `Card`-stack idiom.
- Card header: "Wind Tunnel" title + launch lineage line: launch name, launch status badge, variant label + variant status badge, "Private launch" badge when `scope === "local_only"`. Launch name links to `#` with `title="Launch detail coming soon"` until #55 ships `/dashboard/launches/[id]` (exact #53 niche-chip stub pattern). No variant link (no variant route exists or is scheduled).
- **Projected block:** predicted score + confidence, prediction model, simulated-at timestamp (page's existing `formatDate`). When variant exists but `predictedScore` is null: "Not simulated yet."
- **Calibration block: metric triples table** — rows = score row (`predictedScore` / `actualScore` / `scoreError`) then union of `predictedMetrics` ∪ `actualMetrics` keys; columns = Predicted / Actual / Error (§2.2). Plain table, no chart: one run's handful of metrics needs exact-value comparison, and a chart adds a client dependency to a server-rendered section for no reading gain. Below the table: observation window (`observedFrom` → `observedUntil`) and `computedAt`.
- **Empty states** (each level renders the blocks above it plus one line of actionable copy):
  | Condition | Copy |
  |---|---|
  | `variant === null` | "Not part of a GTM launch yet. Create a variant from a launch to see Wind Tunnel projections." |
  | variant, `latestRun === null` | "No completed simulation runs yet. Run the Wind Tunnel from your terminal agent." |
  | run, `latestCalibration === null`, variant not `published` | "Calibration starts after this variant is published." |
  | run, `latestCalibration === null`, variant `published` | "No calibration yet — actuals are compared after the observation window." |
  The card always renders (even with `variant: null`) so the feature is discoverable; it never blocks or reorders the existing content/thread/engagement sections.

## 4. Tests

1. **Query unit test** (`getContentGtmContext`): null for unknown id; full fixture (published variant + completed run + calibration row) returns all four blocks; progressive-null fixtures at each level (no variant / no run / no calibration).
2. **§8.5 value invariance (issue acceptance):** with the full fixture calibrated, seed additional `local_only` interactions/engagement evidence against the published post, re-read `getContentGtmContext` — `latestCalibration.actualMetrics`, `actualScore`, and `scoreError` are **numerically identical**.
3. **Route test:** 404 unknown content item; 200 full fixture matches the pre-refactor response shape byte-for-byte on keys (regression guard for the extraction).
4. **Component smoke test** (`renderToStaticMarkup`, per #53): full fixture renders launch name, predicted score, and a triples table row; each empty-state copy renders under its condition; `local_only` launch renders "Private launch" badge; launch link is the `#` stub.

## 5. Design decisions (System Design, 2026-08-15)

1. **Reuse the gtm-context shape, no slimmer DTO** — the #52 projection is already exactly the four blocks #54 renders, `latestRun` already excludes agents, and a second content-detail DTO would be a drift surface with no payload or privacy win. The variant DTO's `body` duplicates the content body; the UI simply doesn't render it. What changes is *where the assembly lives*: extracted to `getContentGtmContext` so page and route share one source (the #53 `getContactExploreCard` precedent). Trade-off: one small refactor of shipped #52 code, protected by test §4.3.
2. **Inline section over sidebar** — the page is a single-column `max-w-3xl` card stack; a sidebar means restructuring the whole page layout for one feature and breaks on narrow widths. Placed last: the Wind Tunnel is the feedback loop *about* the content, secondary to the content itself and the user's own activity.
3. **Metric triples table over compact cards or a chart** — the §8.5-adjacent job here is exact predicted-vs-actual comparison of ~4–6 metrics from one run; a 3-column table is the highest-resolution, lowest-machinery rendering. Cards hide the row-wise comparison; charts need client JS and mislead with one data point. Revisit charting when calibration history (multiple rows over time) reaches the UI.
4. **Calibration display = stored row verbatim** (§2.1) — the UI inherits §8.5 value invariance from the pipeline instead of re-implementing scope filtering, and the invariance test (§4.2) pins that the read path can't regress into live-evidence recomputation.
5. **Always-rendered card with per-level empty states** — hiding the section when `variant` is null makes the Wind Tunnel undiscoverable exactly for the users who haven't adopted it; the four copy lines (§3) each name the next action (create variant → run simulation → publish → wait for window).
6. **Launch link stubbed to `#` "coming soon"** (#55 not shipped), matching the #53 niche-chip precedent; the DTO already carries `launch.id` so wiring the real href when #55 lands is a one-line change with no API or query edit.

## 6. Acceptance

- [ ] Wind Tunnel card on `/dashboard/content/[id]` per §3 (lineage, projections, calibration triples, 4 empty states, private-launch badge, stub link)
- [ ] `getContentGtmContext` shared by page and REST route; route response shape unchanged
- [ ] §8.5 value-invariance test (§4.2) green
- [ ] `npm run check` green
