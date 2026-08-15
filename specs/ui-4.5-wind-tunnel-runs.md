# UI 4.5 — Wind Tunnel run history and calibration views

**Status:** Approved (System Design, 2026-08-15) — Dev implements exactly this surface.
**Issue:** [#56](https://github.com/therealtimex/signals/issues/56) · **Epic:** [#51](https://github.com/therealtimex/signals/issues/51)
**Base:** `main` @ `35ddf21` (#55 merged)

## 1. Scope

The simulation drill-down deferred from #55: variant detail with run timeline, and run detail with agent results, lazy transcripts, and calibration history.

| Route | Purpose |
|-------|---------|
| `/dashboard/launches/[id]/variants/[variantId]` | Variant body, projection fields, simulation run timeline |
| `/dashboard/simulations/[id]` | Run status, aggregates, agent results, lazy transcripts, calibration panel |

Folder note: the variant page nests under the existing `launches/[id]` segment, so the launch param stays `id` (Next.js requires consistent param names along a path); the URL shape is exactly the issue's `[launchId]/variants/[variantId]`. The simulations page uses `[id]` like every other detail section.

Plus two cross-cutting wirings: #55 variant-board label → variant detail (§3.5), #54 Wind Tunnel section variant + run deep links (§3.6). No sidebar entry for `/dashboard/simulations` — runs are drill-down-only, reached through their variant.

**Out of scope:** running/calibrating/cancelling simulations from the dashboard (agent-tools-only, ui-4.1 §2 — both pages carry the terminal-agent note instead), variant editing on the new pages (stays on the #55 launch board), `predictedActions` rendering (defer until a consumer needs it), calibration post/skipped-post breakdown (`calibration.posts` — latest-row summary fields only), batch views (`batchId` renders as a plain badge), an agent-tools guide chapter (§5.7).

## 2. Data contract

Both pages are **server components** calling the query layer directly (#53–#55 pattern); the #52 REST routes stay the parallel surface. The transcript expander is the one client fetch, against existing route 10 (`GET /api/simulations/[id]/agents/[agentId]/transcript`, ui-4.1 §4.7). **No new REST routes.**

- **Variant detail:** `getVariantById(variantId)` → 404 `notFound()` when missing **or when `variant.launchId !== id`** (no aliased URLs); `getLaunchById(launchId)` for header lineage; `listSimulationRuns({ variantId, page, pageSize: 20 })`, page URL-driven with `PaginationControls`.
- **Run detail:** `getSimulationRun(id, { includeAgents: true, includeCalibration: true })`; unknown id → `notFound()`. Lineage via `getVariantById(run.variantId)` + `getLaunchById(variant.launchId)`; if either is missing (shouldn't happen — no delete routes), render the run without lineage links and fall back the back-link to `/dashboard/launches`.
- **Transcripts are never bulk-loaded:** the page must not pass `includeTranscripts`; each transcript comes from route 10 on expand (§3.4).

### 2.1 Sanctioned additions: calibration history ("per-horizon rows")

The issue requires per-horizon calibration rows. The calibration sweep (`simulation-calibration-sweep.ts`) writes one `simulation_calibrations` row per run per horizon (`observedUntil`), but the query layer and REST only expose `getLatestCalibrationForRun`. **This is the gap found during design** (per the handoff's "no new API routes unless a gap is found") — closed with a query function and one additive DTO field, not a new route:

```typescript
// queries/calibrations.ts
export function listCalibrationsForRun(runId: string): SimulationCalibration[];
// all rows for the run, ordered observedUntil DESC, computedAt DESC
// (same ordering as getLatestCalibrationForRun, so rows[0] is the latest)
```

`getSimulationRun(id, { includeCalibration: true })` additionally returns `calibrations: serializeCalibration(row)[]` alongside the existing `latestCalibration` (kept — #54's gtm-context and existing consumers depend on it). This flows additively into `GET /api/simulations/[id]?includeCalibration=true` and the agent-tool payload — intentional and safe per the ui-4.1 §5 / ui-4.4 §2.1 precedent; add the one-line note to `docs/agent-tools.md`. **No other DTO, serializer, or route change.**

### 2.2 Display helpers (unit-testable, no DOM)

Colocate with the existing `buildCalibrationMetricRows` pattern:

- `src/lib/wind-tunnel-calibration.ts` — add `buildCalibrationRows(calibration: CalibrationDto): CalibrationMetricRow[]`: score row from `calibration.calibration.predictedScore` / `actualScore` / `scoreError` (stored columns, never recomputed — §8.5 display rule, ui-4.3 §2.1 applies verbatim here), then the stored `calibration.calibration.metricComparisons` triples sorted by key. If `metricComparisons` is absent (defensive: `calibration` JSON is `Record<string, unknown>`), fall back to the union-of-keys derivation the existing helper uses, with `predictedMetrics` from the run passed as an optional second arg — but stored triples win when present.
- `src/lib/simulation-run-display.ts` (new) —
  - `findProjectionSourceRunId(runs: SimulationRun[]): string | null`: among `status === "completed"`, max `completedAt`; tiebreak max `createdAt`, then `id` desc. Null when no completed run.
  - `summarizeAgentGrounding(grounding: Record<string, unknown>): { name: string; headline: string | null }`: name = contact display/full name if the digest carries one, else first identity `displayName` ?? `platformHandle`, else `"Agent"`; headline = persona `archetype` + `tone` (" · "-joined) when present, else first identity `bio`, else null. Purely defensive reads — the grounding digest is the §8.2 allowlist projection and safe to render, but its keys are untyped at this boundary.

## 3. UI

### 3.1 Variant detail — `/dashboard/launches/[id]/variants/[variantId]`

`page.tsx` (server) + `variant-detail-view.tsx` (presentational, smoke-testable) in `src/app/dashboard/launches/[id]/variants/[variantId]/`. **Single-column card stack** (decision §5.1), #55 detail idiom:

1. **Header block:** back link `← {launch.name}` → `/dashboard/launches/[id]`; title `{variant.label ?? "Untitled"}` `text-heading-1`; badges: `variantType` (outline), variant `status`, **Private launch** (outline) when `launch.scope === "local_only"` (ui-4.1 §6 rule 2). Meta line: `predictionModel` and `formatDate(simulatedAt)` when set.
2. **Body card** — `body` as `whitespace-pre-wrap`; null → "No body yet. Edit this variant from the launch board."; footer row: `generationModel` when set, and "View post →" link to `/dashboard/content/[contentItemId]` when `contentItemId` set (board idiom).
3. **Projection card** — `predictedScore.toFixed(2)` + `(predictionConfidence * 100).toFixed(0)%` + model + simulated-at (wind-tunnel-section idiom); parsed `predictedMetrics` as key/value rows when non-empty. `predictedScore` null → "Not simulated yet." Sub-line when a completed run exists: "Projected from the latest completed run below."
4. **Run timeline card** (last, full width) — header "Simulation runs" + count; the terminal-agent CTA note (§5.7): *"Runs live in your terminal agent — ask it to run the Wind Tunnel on this variant. The dashboard is read-only."* (plain text, no link). Table, one row per run, **query order verbatim (`createdAt` desc — decision §5.3)**, `PaginationControls` when `total > 20`:

| Column | Render |
|--------|--------|
| Status | `Badge` (run enum `pending · running · completed · failed · cancelled`) |
| Model | `predictionModel` ?? `—` |
| Predicted score | `predictedScore.toFixed(2)` ?? `—` |
| Agents | `agentCount` |
| Completed | `formatDate(completedAt)`; null → `—` |
| (marker) | **"Projection source" `Badge variant="secondary"`** on the row whose id is `findProjectionSourceRunId(page rows)` (§5.3) |

Row click navigates to `/dashboard/simulations/[runId]` (whole-row link, list idiom). Zero runs → `EmptyState` (icon `Wind`): "No simulation runs yet" / the CTA copy above.

### 3.2 Run detail — `/dashboard/simulations/[id]`

`page.tsx` (server) + `run-detail-view.tsx` (presentational) + `run-agents-table.tsx` (client, §3.4) in `src/app/dashboard/simulations/[id]/`. Card stack:

1. **Header block:** back link `← {variant.label ?? "Untitled"}` → variant detail (§2 fallback: `← Launches`); title "Simulation run" + monospace short id; badges: run `status`, `source` (outline), `batchId` (outline, when set), **Private launch** when lineage launch is `local_only`. Lineage line under the title: `{launch.name} (link) · {variant.label} (link)` — with the back link this is the full launch → variant → run hierarchy (decision §5.2).
2. **Error callout** — only when `status` is `failed` or `cancelled`: full-width destructive-muted bordered `div` (the #55 guard-callout pattern): **"Run {failed|cancelled}"** + `error` text (null → "No error message was recorded.").
3. **In-progress note** — only when `pending`/`running`: muted line "This run is still in progress — results appear as the terminal agent records them."
4. **Aggregates card** — definition rows: predicted score (+confidence), prediction model, agent count, `populationSpec` summary (`sampleSize` + any `nicheIds` count; raw keys in a small `<pre>` like #55's audience card), started/completed timestamps, `workflowRunId` when set (plain mono text — provenance, no route to link).
5. **Agent results card** — §3.4 client table.
6. **Calibration card** — §3.3.

### 3.3 Calibration panel (per-horizon rows)

Data: `run.calibrations` (§2.1), already `observedUntil` desc. One **sub-block per calibration row**, newest first (no accordion — expected volume is a handful of horizons):

- Sub-header: "Observed until {formatDate(observedUntil)}" + muted "window {formatDate(observedFrom)} → {formatDate(observedUntil)} · computed {formatDate(computedAt)} · score error {scoreError >= 0 ? "+" : ""}{scoreError.toFixed(2)}". Latest block gets a `Badge variant="secondary"` "Latest".
- Body: the ui-4.3 triples table — columns Predicted / Actual / Error, rows from `buildCalibrationRows` (§2.2), score row first. Values `toFixed(2)`, null → `—`. Stored values verbatim, never recomputed (§8.5).

Empty panel: zero calibrations → variant status not `published` → "Calibration starts after this variant is published."; else "No calibration yet — actuals are compared after the observation window." (both copy strings reused from ui-4.3 §3). Run not `completed` → "Calibration runs against completed runs only."

### 3.4 Agent table + lazy transcripts (`run-agents-table.tsx`, client)

Props: `runId`, `agents` (serialized rows: `id`, `contactId`, `engagementScore`, `outcome`, `grounding`), `transcriptsPrunedAt`. Table:

| Column | Render |
|--------|--------|
| Agent | `summarizeAgentGrounding(grounding).name`; `contactId` as muted mono sub-line |
| Persona | `.headline` ?? `—` |
| Engagement | `engagementScore.toFixed(2)` ?? `—` |
| Outcome | `Badge variant="outline"`; null → `—` |
| Transcript | expander (below) |

Grounding renders only through the summary helper — the digest is the §8.2 allowlist so nothing in it is private, but the table shows the two summary fields, not the raw JSON (decision §5.5). Zero agents → "No agent results yet."

**Transcript expander (decision §5.6):**

- `transcriptsPrunedAt` set → **no button**; the column renders muted "Pruned {formatDate}" for every row. Zero fetches — the page knows the terminal state.
- Otherwise a "Show transcript" toggle per row (chevron `Button variant="ghost"`; no Collapsible primitive exists in `ui/` — plain `useState` conditional render). First expand fetches `GET /api/simulations/${runId}/agents/${agent.id}/transcript` **once**, caches the result in component state for the session (collapse/re-expand does not refetch); while in flight, `Skeleton` lines.
- 200 → `transcript.content` pretty-printed JSON in a `<pre>` inside `ScrollArea` (`max-h-80`, mono, `text-xs`) + muted byte/token counts. 404 `TRANSCRIPT_NOT_FOUND` → "No transcript recorded for this agent." Other errors → inline error line + "Retry" (the one path allowed to refetch).

### 3.5 #55 follow-up (in this diff)

Variant board (`launch-detail-view.tsx`): the Label cell's `{variant.label ?? "Untitled"}` span becomes a `Link` to `` `/dashboard/launches/${launch.id}/variants/${variant.id}` `` (hover underline, "View post →" styling precedent). No dedicated "View runs" action column (decision §5.4). The `variantType` badge and every other column are unchanged.

### 3.6 #54 follow-up (in this diff)

`wind-tunnel-section.tsx`: the plain `· {variant.label}` span becomes a `Link` to the variant detail route (both `launch.id` and `variant.id` are already in the gtm-context DTO — the wiring #55 §3.5 did for the launch name, one level deeper). Additionally, when `latestRun` is set, the latest-run line links "View run →" to `` `/dashboard/simulations/${latestRun.id}` ``. Update the #54 component test accordingly. No API/query change.

## 4. Tests

Pattern: helper unit tests + component smoke via `renderToStaticMarkup` (#53–#55 precedent) + query/route deltas. Fixture: one shared launch/variant with **two completed runs** (distinct `completedAt`, the newer one carrying agents with grounding digests) plus one `failed` run with `error` text; two calibration rows at different `observedUntil` horizons on the projection-source run.

1. **Query tests** (`calibrations`/`simulations` deltas): `listCalibrationsForRun` ordering (`observedUntil` desc, `rows[0]` equals `getLatestCalibrationForRun`); `getSimulationRun` with `includeCalibration` returns both `latestCalibration` and `calibrations[]`.
2. **Route regression** (existing simulations detail route test): `includeCalibration=true` response carries `calibrations` with both horizon rows — additive only, envelope unchanged.
3. **Helper tests:** `findProjectionSourceRunId` (picks max `completedAt`; ignores failed/pending; null when none; tiebreaks); `buildCalibrationRows` (stored `metricComparisons` triples win; score row from stored columns; fallback derivation when comparisons absent — **issue acceptance: calibration row renders predicted/actual/error triples**); `summarizeAgentGrounding` fallback chain.
4. **Variant detail smoke (issue acceptance: multi-run variant):** both completed runs render; "Projection source" badge sits on the row with the latest `completedAt` and the projection card shows the variant's stored `predicted*`; failed run row shows status badge and `—` completed; zero-runs fixture renders the EmptyState CTA copy.
5. **Run detail smoke:** agent rows render name/score/outcome; both calibration horizon blocks render with "Latest" on the newer; failed-run fixture renders the error callout text; pruned fixture (`transcriptsPrunedAt` set) renders "Pruned" and no "Show transcript" button.
6. **Lazy transcript (issue acceptance):** component/helper test with mocked `fetch` — collapsed render triggers zero calls; expand triggers exactly one call to the route-10 URL; collapse + re-expand still one; 404 `TRANSCRIPT_NOT_FOUND` renders the no-transcript copy.
7. **Wiring smokes:** #55 board label cell asserts the variant-detail href; #54 wind-tunnel test asserts variant href + "View run →" href.
8. `npm run check` green.

## 5. Design decisions (System Design, 2026-08-15) — answers to the six handoff questions

1. **Variant detail = single-column card stack, not tabs** (Q1) — the #54/#55 rationale applies unchanged: tabs hide the run timeline (the page's reason to exist) behind a click, restructure for one page, and break the established detail idiom. Order puts identity first, prose second, the widest element (timeline) last-and-widest.
2. **Back-link hierarchy, not a breadcrumb component** (Q2) — every detail page ships one `←` back link to its parent: run → variant → launch → list. The run header adds a lineage line (launch link · variant link), so the full trail is visible without inventing a breadcrumb primitive for two levels. Trade-off: no one-click run → launch jump; it's two clicks and the lineage line covers it.
3. **Run list keeps query order (`createdAt` desc); highlight is decoupled from sort** (Q3) — the handoff floated `completed_at` desc, but that buries in-flight runs (null `completedAt`) and forces client re-sorting with null rules; creation order *is* the timeline and puts newest activity first. "Latest completed" is a computed marker, not a sort: `findProjectionSourceRunId` = max `completedAt` among completed, matching the Phase 3 §6 projection rule the acceptance test pins. Known limit: the badge is computed over the loaded page; a projection-source run beyond page 1 goes unmarked there — accepted for v1 (20 runs per variant is already an outlier).
4. **Board label becomes the link; no "View runs" action column** (Q4) — the label is the variant's identity and the row already spends its action budget (Edit, View post); a third action column adds width for a duplicate affordance. Precedent: goal-name chips and content links navigate by label everywhere else.
5. **#54 deep links: variant label + latest run** (Q5) — both ids are already in the gtm-context DTO, so this is two `Link` wrappings, and it completes the QA loop from the content side (content → variant → runs and content → latest run directly). Grounding stays summarized in the agent table (name + persona headline) rather than raw JSON: it's allowlist-safe but unreadable as a column.
6. **Empty states are terminal-state-aware** (Q6) — zero runs gets the CTA EmptyState (the only next action is the terminal agent); `transcriptsPrunedAt` suppresses the expander entirely instead of letting users fetch guaranteed 404s (the ui-4.1 §4.7 pruned-vs-missing distinction rendered proactively, not reactively); the 404 copy still exists for the unpruned no-transcript case.
7. **CTA is plain copy, no docs link** — the handoff asked for an agent-tools docs link, but no in-app guide chapter covers simulations (checked `guide/*.md`) and `docs/agent-tools.md` isn't a servable surface; a dead or external link is worse than none. Writing a Wind Tunnel guide chapter is real work outside this issue — flagged for the epic backlog, and the copy names the action ("ask your terminal agent") without a link.
8. **Calibration history via one query + additive DTO field, not a new route or a latest-only panel** (the found gap) — "per-horizon rows" is in the issue text and the sweep writes those rows today; showing only the latest would silently drop shipped data. A `calibrations` array under the existing `includeCalibration` flag keeps REST, agent tools, and the page on one shape (ui-4.4 §2.1 precedent) and costs no new route; `latestCalibration` stays for #54 and existing consumers.

## 6. Acceptance

- [ ] `/dashboard/launches/[id]/variants/[variantId]` per §3.1 (header, body, projection, run timeline with projection-source badge, CTA, pagination, empty state)
- [ ] `/dashboard/simulations/[id]` per §3.2–3.4 (lineage header, error callout, aggregates, agent table, lazy transcripts, per-horizon calibration panel)
- [ ] `listCalibrationsForRun` + `getSimulationRun` `calibrations` field per §2.1; no other API shape change; `docs/agent-tools.md` note
- [ ] #55 board label link per §3.5; #54 variant + run links per §3.6
- [ ] Tests §4 including the three issue-acceptance tests; `npm run check` green
- [ ] QA can walk launch → variant → runs → calibration entirely in the UI, no curl/agent-tools
