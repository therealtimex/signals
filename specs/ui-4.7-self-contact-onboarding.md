# UI 4.7 — Self-contact onboarding (set yourself for the Explore map)

**Status:** Approved v1 (System Design, 2026-08-16) — Dev implements exactly this surface; contract changes go back through design.
**Issue:** [#90](https://github.com/therealtimex/signals/issues/90) · **Epic:** [#83](https://github.com/therealtimex/signals/issues/83) · **Parents:** `ui-4.6-explore-map.md` §5.4, `ui-4.1-rest-api.md`
**Amends:** `ui-4.6-explore-map.md` §3.1 (map `meta`) and §5.4 (no-owner empty-state copy) — see §3.3 and §5.2 here.

## 1. Scope

First-class UI to set, change, and clear the self contact (`contacts.is_self`) without an agent, plus the REST surface it needs.

Surfaces in scope:

1. **Explore empty state** (`meta.ownerContactId === null`) — onboarding CTAs: choose an existing contact or create your profile
2. **Explore chrome** — persistent `You: {name}` owner chip with a Change affordance once the owner is set
3. **Contact detail** — "This is me" toggle
4. **REST API** — `isSelf` on `POST /api/contacts` and `PATCH`/`PUT /api/contacts/[id]`; `meta.owner` on `GET /api/explore/map`
5. **Query-layer invariant hardening** — create-path swap; archiving the owner clears `is_self`

**Out of scope (explicit):** launch bridge (#86); account picker (#87); auto-detecting self from platform sync; onboarding banners outside `/dashboard/explore`; multi-user/auth semantics (`is_self` stays a single-workspace concept); agent-tool schema changes (`update_contact` already handles `is_self`).

## 2. Design decisions (System Design, 2026-08-16)

1. **Invariant lives in the query layer, not routes.** `updateContact` already runs the at-most-one swap transaction; `createContact` gets the same treatment (§4.1) so every caller (REST, agent tools, scripts) inherits the invariant. Rejected route-level enforcement — it would silently miss the agent/create paths.
2. **No dedicated owner endpoint.** The Explore chrome gets the owner from `meta.owner` on the map response it already fetches (§3.3); contact detail already receives the full row including `isSelf`. A `GET /api/contacts/self` route would be a third way to answer a question two existing responses already answer. Revisit only when a surface without one of those fetches needs the owner.
3. **Archiving the owner clears `is_self`** (§4.2). `archiveContact` already severs the owner's graph edges, so keeping `is_self` set would strand Explore in a misleading "no audience connections synced yet" state anchored on a hidden contact. Explicit clearing returns Explore to onboarding, with no hidden state. Restore does **not** re-set it — the user re-chooses (cheap, unambiguous).
4. **Clearing self is allowed and unceremonious.** Toggling "This is me" off sends `isSelf: false`; Explore simply returns to the onboarding empty state. No confirmation dialog — the action is trivially reversible.
5. **CTA matrix is driven by a parallel candidate-count fetch**, not a map-contract extension (§5.1). Adding a candidate count to map `meta` would tax every steady-state map load for an onboarding-only need. The view fetches `GET /api/contacts?pageSize=1` alongside the map fetch and reads `total` (archived and platform-actor contacts already excluded by `listContacts` defaults).
6. **Create flow reuses `AddContactDialog`** with three new optional props (§5.3) rather than a parallel create dialog — same form, same identity drafts, same error handling; the onboarding path only adds `isSelf: true` to the payload.
7. **Picker is a plain searched list, not a command palette.** No `command` primitive exists in `src/components/ui`; a `Dialog` + `Input` + result list matches existing idiom and needs no new dependency.

## 3. API contract

### 3.1 `POST /api/contacts`

Add to `createContactSchema`:

```typescript
isSelf: z.boolean().optional(),
```

- `isSelf: true` — the created contact becomes the owner; any previous owner is cleared in the same transaction (§4.1).
- `isSelf: false` / omitted — unchanged behavior.
- Invalid type ⇒ existing 400 Zod-error shape.
- Response (201) is the contact row and already carries `isSelf` (full-row select) — no response-shape change.

### 3.2 `PATCH` / `PUT /api/contacts/[id]`

Add to `updateContactSchema`:

```typescript
isSelf: z.boolean().optional(),
```

- `isSelf: true` — swap semantics (existing `updateContact` transaction): previous owner's flag cleared, this contact set, at most one row with `is_self = 1` at commit.
- `isSelf: false` — clears the flag on this contact (no-op if it wasn't the owner). System may end with **zero** owners; that is a valid onboarding state, not an error.
- Both verbs share `updateContactHandler`; the field works identically on each.

### 3.3 `GET /api/explore/map` — `meta.owner` (amends ui-4.6 §3.1)

```typescript
meta: {
  ownerContactId: string | null;   // unchanged
  owner: { id: string; name: string; avatarUrl: string | null } | null;  // NEW — null iff ownerContactId is null
  totalContacts: number;
  shownContacts: number;
  truncated: boolean;
  limit: number;
};
```

- Assembled from the owner row `getExploreMap` already fetches (ui-4.6 §4 step 3) — no extra query in the populated path; the no-audience path may need the single owner-row fetch it currently skips.
- Privacy posture of ui-4.6 §6.5 is preserved: `owner` exposes only id/name/avatar (fields already public on contact nodes); the raw `is_self` column stays out of the map response.

## 4. Query layer

### 4.1 `createContact` swap (`src/lib/db/queries/contacts.ts`)

When `data.isSelf === true`, wrap the insert in a transaction that first clears any existing `is_self = 1` row (same shape as the `updateContact` branch), then inserts. All other calls keep the current single-statement path.

### 4.2 `archiveContact` clears self

Inside `archiveContact`, when the target row has `isSelf === true`, include `isSelf: false` in the update (it already funnels through `updateContact`, so pass it with the metadata update). `restoreContact` is unchanged — it does not re-set `is_self`.

### 4.3 `getExploreMap` owner meta

Populate `meta.owner` per §3.3, including in the owner-set/zero-audience response. The no-owner empty response keeps `owner: null`.

`getOwnerContactId()` is unchanged (oldest-`createdAt` wins stays as the defensive read for legacy double-flag data).

## 5. UI

### 5.1 Explore empty state — CTA matrix (replaces ui-4.6 §5.4 no-owner row)

`ExploreMapView` fetches the map and `GET /api/contacts?pageSize=1` **in parallel** on mount/refetch; `total > 0` selects the row:

| Candidates | Title | Description | CTAs |
|---|---|---|---|
| ≥ 1 contact | "Set yourself to see your audience" | "Your audience map is drawn around your own contact. Tell Signals which contact is you." | Primary **Choose my contact** (opens picker §5.2) · Outline **Create my profile** (opens create §5.3) |
| 0 contacts | "Set yourself to see your audience" | "Create your profile to anchor the map — audience connections attach to it as they sync." | Primary **Create my profile** only |

- Rendering: keep the existing `EmptyState` component unchanged; CTA buttons render as siblings below it (same pattern as the current error-state Retry button).
- The old copy referencing the agent `update_contact` tool is **removed**.
- If the candidate-count fetch errors, fall back to the ≥1 variant (both paths remain available; the picker's own empty state covers the truly-zero case).
- After either flow succeeds, the view refetches the map (and count) — on success the graph or the "no audience yet" state renders, unblocking per issue acceptance.

### 5.2 Picker — `src/components/explore/explore-self-picker.tsx` (client)

Controlled `Dialog` (`open`/`onOpenChange` from the parent), props: `currentOwnerId: string | null`, `onOwnerChanged: () => void`.

- **Header:** title "Who are you?", description "Pick the contact that represents you. Signals keeps at most one self contact."
- **Search:** `Input`, debounced ~300 ms → `GET /api/contacts?search={q}&pageSize=20`. Default (empty query) shows the first page. Archived and platform-actor contacts are excluded by the endpoint's defaults — the picker adds no params for this (sentinel test §7.3).
- **Rows:** name (primary); `company · title`, else email, else headline (secondary, single line). Clicking a row selects it (highlight); footer **Set as me** button confirms, disabled until a selection exists and while the request is in flight.
- **Current owner** (change flow): row shows a secondary `Badge` "Current" and is not selectable.
- **Confirm:** `PATCH /api/contacts/{id}` with `{ isSelf: true }` → on success close and call `onOwnerChanged` (parent refetches the map). On failure show inline error text in the footer; dialog stays open.
- **No results:** "No contacts match" plus hint text "You can create your profile instead." (The zero-contact case normally never reaches the picker per §5.1.)
- No pagination in v1 — 20 results plus search is sufficient; note as a known limit.

### 5.3 Create flow — extend `src/components/add-contact-dialog.tsx`

Three new optional props, all defaulting to current behavior:

| Prop | Type | Default | Purpose |
|---|---|---|---|
| `trigger` | `ReactNode` | current "Add Contact" button | Custom trigger for the Explore CTA |
| `title` | `string` | "Add Contact" | Explore passes "Create your profile" |
| `payloadExtras` | `Record<string, unknown>` | `{}` | Merged into the `POST /api/contacts` body last; Explore passes `{ isSelf: true }` |
| `onCreated` | `() => void` | — | Called after a successful create (in addition to the existing close/refresh); Explore refetches the map |

Existing call sites (`contact-list-client.tsx`) pass nothing and are untouched.

### 5.4 Explore chrome — owner chip

When `meta.ownerContactId !== null`, `ExploreMapView` renders an owner chip in **both** the loaded-graph state and the owner-set/zero-audience empty state:

- **Loaded:** overlay pill at top-left of the canvas container (`absolute left-4 top-4 z-10`), mirroring the existing count badge at top-right.
- **Zero-audience empty state:** rendered above the `EmptyState`.
- **Content:** `You: {meta.owner.name}` (secondary `Badge` or equivalent bordered pill) followed by a ghost/outline **Change** button that opens the picker (§5.2) with `currentOwnerId = meta.ownerContactId`. On `onOwnerChanged`, refetch the map.

### 5.5 Contact detail — "This is me" toggle

In `contact-detail-client.tsx`, header right-hand cluster (before `FunnelStageBadge`): a `Label` "This is me" + `Switch`.

- `checked = contact.isSelf`; disabled while a request is in flight.
- Toggle on → `PATCH { isSelf: true }` → `router.refresh()`. Silent swap — any previous self contact is cleared server-side. `Tooltip` on the control: "Marks this contact as you. Any previous self contact is cleared."
- Toggle off → `PATCH { isSelf: false }` → `router.refresh()`.
- **Hidden when the contact is archived** (the archived banner already directs to Restore first; an archived contact can never be the owner per §4.2).
- On request failure, revert the visual state (re-render from server state via refresh; no optimistic persistence).

## 6. States & edge cases

| Case | Behavior |
|---|---|
| No owner, ≥1 candidate contact | Empty state with Choose + Create CTAs (§5.1) |
| No owner, 0 contacts | Empty state with Create CTA only |
| Owner set, no audience | ui-4.6 "No audience connections synced yet" state **plus** owner chip (§5.4) so a wrong self choice can be corrected |
| Owner set, audience present | Graph + count badge + owner chip |
| Set self via create while an owner exists | Create-path swap (§4.1); new contact is the single owner |
| Change self via picker | Swap transaction; picker marks the current owner "Current"/unselectable |
| Clear self (detail toggle off) | Zero owners; Explore returns to onboarding empty state |
| `isSelf: false` on a non-owner | Success no-op |
| Archive the owner | `is_self` cleared (§4.2); Explore returns to onboarding; restore does not re-set it |
| Archived contacts in picker | Excluded by `listContacts` defaults; sentinel-tested |
| Platform-actor shadow contacts in picker | Excluded by `listContacts` defaults |
| Concurrent set from two surfaces | Last committed swap wins; `getOwnerContactId` oldest-wins read remains the defensive tiebreak |

## 7. Tests

### 7.1 Query unit (extend `src/lib/db/queries/contacts-is-self.test.ts`)

1. `createContact({ isSelf: true })` with an existing owner ⇒ exactly one `is_self` row (the new contact).
2. `updateContact(id, { isSelf: false })` clears the owner ⇒ zero `is_self` rows; `getOwnerContactId()` returns null.
3. `archiveContact` on the owner clears `is_self`; `restoreContact` does not re-set it.
4. Existing swap tests stay green.

### 7.2 Explore-map query/route (extend existing tests)

1. `meta.owner` is `{ id, name, avatarUrl }` when an owner exists — including the zero-audience case; `null` when none.
2. Raw `is_self` still absent from the map response (privacy parity with ui-4.6 §6.5).

### 7.3 API route (`src/app/api/contacts` tests)

1. `POST` with `isSelf: true` when another owner exists ⇒ 201 and a single `is_self` row in the DB.
2. `PATCH` with `isSelf: true` ⇒ swap; response body has `isSelf: true`; previous owner's row reads `false`.
3. `PATCH` with `isSelf: false` on the owner ⇒ cleared.
4. `isSelf: "yes"` (wrong type) ⇒ 400.

### 7.4 Component smoke (`renderToStaticMarkup`, force-graph mocked — ui-4.6 §7.3 conventions)

1. Empty-state CTA matrix: candidates ≥1 renders both CTAs; 0 renders Create only; agent-tool copy no longer present.
2. Owner chip renders `You: {name}` + Change in both the loaded and zero-audience states; absent when no owner.
3. Picker: rows render from a contacts fixture; current owner row shows "Current" and is not selectable.
4. Contact detail: "This is me" switch present for a normal contact, hidden for an archived fixture.
5. `AddContactDialog` default call sites render unchanged (no new required props).

### 7.5 Gate

`npm run check` green (lint + typecheck + vitest suite).

## 8. Acceptance (#90)

- [ ] `isSelf` accepted on `POST /api/contacts` and `PATCH`/`PUT /api/contacts/[id]` per §3.1–3.2; at-most-one invariant enforced in the query layer per §4.1
- [ ] `meta.owner` on `GET /api/explore/map` per §3.3
- [ ] Archiving the owner clears `is_self` per §4.2
- [ ] Explore empty-state CTA matrix, picker, and create flow per §5.1–5.3; agent-tool copy removed
- [ ] Owner chip with Change affordance per §5.4
- [ ] Contact detail "This is me" toggle per §5.5
- [ ] Edge cases per §6; test matrix §7 implemented; `npm run check` green
