# Agents & Actions — Automation Restructure

> Renames "Workflows" to "Automation" with two tabs: **Workflows** and **Runs**.
> Moves sync/import operations out of Content and Settings into the Workflows tab.
>
> **Revised (issue #128):** the original three-tab layout (Agents / Actions / Runs)
> is merged into two tabs. Users don't distinguish "run an agent template" from
> "sync LinkedIn" or "upload an export" — both are automation work. Platform action
> cards, the agent template gallery, and scheduled jobs now live together on the
> **Workflows** tab; **Runs** shows all execution history, including file imports
> persisted as `workflow_runs` rows with `workflow_type: "import"`.
>
> See [`09-multi-channel-content.md`](./09-multi-channel-content.md) for the Content page
> cleanup that pairs with this restructure.

---

## 1. Sidebar Rename

In `src/components/app-sidebar.tsx`, update the nav item:

| Current | New |
|---------|-----|
| `{ title: "Workflows", href: "/dashboard/workflows", icon: GitBranch }` | `{ title: "Automation", href: "/dashboard/automation", icon: Zap }` |

- Import `Zap` from lucide-react (remove unused `GitBranch` import).
- The route moves from `/dashboard/workflows` to `/dashboard/automation`.
- Create `/dashboard/automation/` directory; move existing workflow page files there.
- Existing deep links (`/dashboard/workflows/[id]`) redirect to `/dashboard/automation/[id]` via Next.js `redirect()` in a thin compatibility page, or use `next.config.mjs` redirects.

---

## 2. Templates to Agents Rename

The Template Gallery (`template-gallery.tsx`) becomes the **Agent Gallery**. This is a label-only change.

| Current Term | New Term | Scope |
|-------------|----------|-------|
| Template Gallery | Agent Gallery | Section heading |
| Templates | Agents | Tab labels, headings |
| Activate Template | Run Agent | Button labels |
| ActivateDialog | RunAgentDialog | Component name (file stays) |
| TemplateGallery | AgentGallery | Component name (file stays) |

Schema tables (`workflowTemplates`, `workflowTemplateSteps`, etc.) are **not renamed**. The rename is purely in user-facing strings and component exports.

---

## 3. Two-Tab Automation Page

Replace the current single-page layout with a tabbed interface.

### 3.1 Tab Structure

```
[Workflows]  [Runs]
```

| Tab | Content | Source |
|-----|---------|--------|
| **Workflows** | Platform action cards (sync + import, grouped by platform) + agent template gallery + scheduled jobs list | `action-cards.tsx` + `template-gallery.tsx` + `scheduled-jobs-list.tsx` |
| **Runs** | Workflow run history (list/kanban/swimlane views) over `workflow_runs`, including sync, import, and agent runs | Existing `workflow-view-switcher.tsx` |

Legacy URL params map onto the merged layout: `?tab=agents` and `?tab=actions`
resolve to **Workflows** (the default); `?tab=runs` keeps working.

### 3.2 Page Layout

```tsx
// src/app/dashboard/automation/page.tsx
export default function AutomationPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-heading-1">Automation</h1>
          <p className="text-muted-foreground mt-1">
            Run AI agents, sync platforms, and track all activity.
          </p>
        </div>
        <WorkflowQuickActions />
      </div>
      <Tabs defaultValue="workflows">
        <TabsList>
          <TabsTrigger value="workflows">Workflows</TabsTrigger>
          <TabsTrigger value="runs">Runs</TabsTrigger>
        </TabsList>
        {/* Tab content panels */}
      </Tabs>
    </div>
  );
}
```

Default tab: **Workflows** (most common entry point).

---

## 4. Action Cards Component

New component: `src/app/dashboard/automation/action-cards.tsx`

Displays all manual sync/import operations as a grid of cards, grouped by platform,
in the **Platform Workflows** section of the Workflows tab.

### 4.1 Card Structure

Each card contains:
- Platform icon + action name (e.g., "Import Tweets")
- One-line description
- **Run** button that triggers the sync API
- Inline status: idle, running (spinner), complete (result summary), error

### 4.2 Actions by Platform

**X (Twitter)**
| Action | Endpoint | Body |
|--------|----------|------|
| Import Tweets | `POST /api/platforms/x/sync` | `{ type: "tweets" }` |
| Import Mentions | `POST /api/platforms/x/sync` | `{ type: "mentions" }` |
| Sync Contacts | `POST /api/platforms/x/sync` | `{ type: "contacts" }` |
| Enrich Profiles | `POST /api/platforms/x/enrich` | `{}` |

**LinkedIn**
| Action | Endpoint | Body |
|--------|----------|------|
| Sync Contacts | `POST /api/platforms/linkedin/sync` | `{ type: "contacts" }` |

**Gmail**
| Action | Endpoint | Body |
|--------|----------|------|
| Sync Contacts | `POST /api/platforms/gmail/sync` | `{ type: "contacts" }` |
| Sync Metadata | `POST /api/platforms/gmail/sync` | `{ type: "metadata" }` |

### 4.3 Layout

```
[X]                          [LinkedIn]        [Gmail]
+-----------+-----------+    +-----------+     +-----------+
| Import    | Import    |    | Sync      |     | Sync      |
| Tweets    | Mentions  |    | Contacts  |     | Contacts  |
+-----------+-----------+    +-----------+     +-----------+
| Sync      | Enrich    |                      | Sync      |
| Contacts  | Profiles  |                      | Metadata  |
+-----------+-----------+                      +-----------+
```

Cards use `grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4`. Platform group headings above each set.

### 4.4 Migration from Existing Code

The action definitions already exist in `workflow-quick-actions.tsx` as the `SYNC_ACTIONS` array. The Action Cards component reuses the same endpoints and request bodies, just presented as cards instead of a dropdown menu.

The `WorkflowQuickActions` dropdown remains in the page header as a quick-launch shortcut. The Workflows tab provides the full, visible grid.

---

## 5. Slim Down Settings Page

The Settings page (`src/app/dashboard/settings/page.tsx`) currently mixes platform configuration with sync trigger buttons.

### 5.1 Remove from Settings

- Remove all "Sync Now" / "Sync Contacts" / "Sync Metadata" buttons from platform connection cards.
- Remove sync result display from the Settings page.
- Remove `handleSync` functions and related state.

### 5.2 Keep in Settings

- API key management (Anthropic, Brave, Tavily)
- Platform connection cards (connect/disconnect, status display, scope info)
- Browser session management
- Data export/import

Settings becomes config-only. All trigger actions live on the Automation → Workflows tab.

---

## 6. Chat Tool Reference Updates

The AI chat assistant references "Workflows" in tool descriptions and system prompts.

### 6.1 Changes

| Location | Current | New |
|----------|---------|-----|
| `src/lib/chat/tools.ts` — `query_workflows` | "Query workflow runs" | "Query automation runs" |
| `src/lib/chat/tools.ts` — `start_workflow` | "Start a workflow" | "Start an agent" |
| `src/lib/chat/system-prompt.ts` | References to "Workflows page" | "Automation page" |
| `src/lib/chat/smart-prompts.ts` | Workflow-related prompts | Update labels to "automation" / "agent" |

Tool names (`query_workflows`, `start_workflow`) stay the same for backward compatibility with saved chat conversations that reference them.

---

## 7. File Change Summary

| File | Change |
|------|--------|
| `src/components/app-sidebar.tsx` | Rename Workflows to Automation, Zap icon |
| `src/app/dashboard/automation/page.tsx` | New tabbed page (Agents / Actions / Runs) |
| `src/app/dashboard/automation/action-cards.tsx` | New Action Cards grid component |
| `src/app/dashboard/automation/[id]/page.tsx` | Move from workflows/[id] |
| `src/app/dashboard/automation/*.tsx` | Move existing workflow components |
| `src/app/dashboard/workflows/page.tsx` | Redirect to /dashboard/automation |
| `src/app/dashboard/settings/page.tsx` | Remove sync buttons, keep config only |
| `src/app/dashboard/content/content-list-client.tsx` | Remove import buttons (done in Spec 09) |
| `src/lib/chat/tools.ts` | Update tool descriptions |
| `src/lib/chat/system-prompt.ts` | Update page references |
| `src/lib/chat/smart-prompts.ts` | Update prompt labels |

No new tables. The `workflow_runs.workflow_type` enum gains an `"import"` value
(TypeScript-only — the column is plain `text` with no CHECK constraint, so no
migration is needed).

---

## 8. Import UX and Run Persistence (issue #128)

LinkedIn is the first import hub surface:

- The **Import Connections Export** card on Workflows accepts `.csv` / `.zip`
  (Basic Data Export) uploads and works without a connected LinkedIn account.
- Successful and failed file imports are recorded as `workflow_runs` rows with
  `workflow_type: "import"`, config `{ importSubType, platform, source, fileName }`,
  and the `SyncResult` JSON in `result` (see `src/lib/workflows/record-import-run.ts`).
- The latest import run drives last-run stats on the card (added / updated /
  skipped, relative timestamp, source, file name) via `importStats` on
  `GET /api/platforms/linkedin` — not `sync_cursors`.
- Re-import is idempotent (dedup by LinkedIn identity), and the card says so.
- Import runs appear in Runs with an **Import** type badge and the file name.
