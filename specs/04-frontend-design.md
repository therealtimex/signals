# Signals Product Design System

This document is the normative UI contract for Signals. It replaces the inherited OpenVolo visual conventions with a product system for a local-first Social GTM and relationship knowledge graph. The implemented source of truth is `src/app/globals.css` plus the shared components in `src/components`.

## Purpose and principles

Signals should feel operational, trustworthy, and calm while users move between relationship context, agent work, and publishing state.

1. **Meaning before decoration.** Color communicates a named product meaning, never an arbitrary palette step.
2. **Progressive density.** Default surfaces stay scannable; details and secondary actions appear on demand.
3. **State is explicit.** Loading, success, warning, failure, stale work, and empty data use shared primitives and accessible semantics.
4. **Actions stay predictable.** Primary page actions live in the page header. Row actions live in a consistent overflow menu.
5. **Responsive by reduction.** Preserve the primary object and its state first; hide supporting metrics before essential controls.
6. **One system in both themes.** Dark mode changes luminance, not product meaning.

## Foundations

### Color tokens

Use semantic utilities (`text-success`, `bg-warning/10`, `border-info/25`) in product UI. Raw Tailwind palette utilities such as `text-green-600` or `bg-blue-50` are not allowed in migrated surfaces.

| Meaning | Light | Dark | Intended use |
| --- | --- | --- | --- |
| `success` | `oklch(0.50 0.14 155)` | `oklch(0.72 0.13 155)` | Completed, connected, healthy |
| `warning` / `stale` | `oklch(0.51 0.13 80)` | `oklch(0.78 0.13 80)` | Attention, stale work, limits |
| `info` / `syncing` | `oklch(0.51 0.15 245)` | `oklch(0.70 0.13 245)` | In progress, advisory information |
| `live` | `oklch(0.49 0.16 170)` | `oklch(0.74 0.15 170)` | Live or actively monitored state |
| `danger` / `destructive` | `oklch(0.52 0.22 27.325)` | `oklch(0.70 0.18 27.325)` | Failure and destructive action |

These values were tuned from the initial semantic palette. Text using each semantic token on its matching `/10` wash has at least 4.5:1 contrast over both `background` and `card`: light minimums are success 4.71, warning 4.98, info 4.77, live 4.56, and danger 4.93; dark minimums are 6.92, 7.92, 6.21, 7.56, and 5.80 respectively.

Core surface tokens remain lavender-tinted neutrals:

| Token | Light | Dark |
| --- | --- | --- |
| `background` | `oklch(0.995 0.005 270)` | `oklch(0.15 0.02 270)` |
| `foreground` | `oklch(0.17 0.02 270)` | `oklch(0.96 0.01 270)` |
| `card` | `oklch(1 0.003 270)` | `oklch(0.18 0.02 270)` |
| `muted` | `oklch(0.96 0.01 270)` | `oklch(0.25 0.02 270)` |
| `muted-foreground` | `oklch(0.52 0.02 270)` | `oklch(0.65 0.02 270)` |
| `border` | `oklch(0.91 0.01 270)` | `oklch(0.28 0.02 270)` |

The light primary is `oklch(0.50 0.18 195)`, tuned to maintain at least 4.5:1 against `primary-foreground`; dark primary remains `oklch(0.65 0.18 195)`.

Chart colors are for categorical data series only. They must not encode success, warning, or failure.

### Platform color exception

Platform identity is the one approved brand-color exception. Use only the platform tokens and keep color to a small dot or icon inside a neutral container.

| Token | Light | Dark |
| --- | --- | --- |
| `platform-x` | `oklch(0.20 0 0)` | `oklch(0.95 0 0)` |
| `platform-linkedin` | `oklch(0.54 0.13 252)` | `oklch(0.62 0.13 252)` |
| `platform-gmail` | `oklch(0.63 0.19 29)` | `oklch(0.70 0.17 29)` |

Use `PLATFORM_SHORT_LABELS` for dense UI. Do not create local platform-name maps in new work.

### Typography

- Display and headings: Plus Jakarta Sans via `--font-display`.
- Body and controls: Inter via `--font-body` / `--font-sans`.
- Technical values: JetBrains Mono via `--font-mono`.
- Page title: `.text-heading-1` (30px, 700, 1.2 line-height).
- Section title: `.text-heading-2` (20px, 600).
- Card title: `.text-heading-3` (16px, 600).
- Labels remain short; avoid uppercase prose.

### Spacing and density

Use Tailwind's 4px spacing rhythm. Standard page sections use `space-y-6`; compact clusters use gaps 1–2; cards use 4–6 units of padding. Dense tables remain readable with 8–12px cell padding and no nested card chrome. Confidence and user-selectable density controls are deferred; do not invent page-local versions.

### Radius and elevation

The base radius is 10px: small 6px, medium 8px, large 10px, extra-large 14px. Prefer borders and surface contrast to heavy shadows. Popovers and menus may use `shadow-md`; cards normally do not.

### Motion

Motion explains state change. Use existing Tailwind/Radix transitions and `animate-fade-slide-in` sparingly. Loading rotation must include `motion-reduce:animate-none`. Do not add decorative perpetual animation. A shared shimmer decision is deferred; skeletons currently use the shadcn `Skeleton` primitive.

### Icons

Use Lucide only. Controls use the icon sizes already encoded by `Button` (`icon-xs`, `icon-sm`, and standard). Decorative icons must be `aria-hidden`; icon-only controls require an accessible label.

### Dark mode

All new primitives must be valid in light and dark themes without component-level palette overrides. Prefer semantic tokens and alpha washes so surfaces inherit the current background. Never use a light-only color with a separate raw `dark:` palette patch.

## Shared component contracts

| Component | Contract |
| --- | --- |
| `PageHeader` | Page title, optional description, optional primary actions; server-safe and wrapping. |
| `FeedbackBanner` | `info`, `success`, `warning`, or `danger`; optional action and dismissal. Danger uses `role=alert`; other tones use `role=status`. |
| `Badge` semantic variants | `success`, `warning`, `danger`, `info`, `live`, and `neutral`. Existing shadcn variants remain supported. |
| `ContentStatusBadge` | Canonical draft, queued, publishing, published, imported, failed, and stale presentations. Suppresses redundant Draft in the Drafts view. |
| `PlatformBadge` | Neutral compact badge with tokenized platform dot and short label. Unknown platforms degrade to muted text. |
| `RowActionsMenu` | Kebab trigger and consistent row commands, including destructive presentation and event isolation. |
| `EmptyState` | Icon, title, explanation, and either legacy link CTA or an inline action node. |
| `TableSkeleton` | Shared responsive table loading structure configured with column labels, visibility, widths, and skeleton shapes. |

Foundation components continue to come from `src/components/ui` (shadcn/Radix) and are composed rather than forked.

## Interaction patterns

### Page hierarchy

Every product page begins with `PageHeader`. Put the page's dominant creation or completion action in `actions`. Filters and view controls form the next horizontal, wrapping toolbar. Feedback appears between the header and working surface.

### Feedback and failure

Use `FeedbackBanner` for persistent in-context messages. Use toasts only for transient confirmation after the toast contract is standardized. Error copy should name what failed and, where possible, the next action. A dismiss button never replaces recovery.

### Status

Status labels use title case and semantic Badge variants. A status may include one familiar icon, but never rely on color alone. Stale is an advisory modifier represented by a separate compact Attention badge and tooltip; it does not replace the underlying workflow status.

### Row actions and clickable rows

The primary row click opens the object. Rows acting as links must be keyboard-focusable and activate with Enter or Space. Nested controls stop row propagation. Secondary and destructive commands live in `RowActionsMenu`; external links state their destination in the label.

### Empty and loading states

An empty state explains why the surface is empty and exposes the next meaningful action. Route loading uses a structure-matched skeleton; do not show an indefinite blank table.

## Content reference composition

The Content surface is the first complete design-system reference.

- `PageHeader` owns the title, description, and Compose action. It lives in the client boundary because Compose owns local dialog state.
- One wrapping toolbar contains origin tabs, platform tabs, and Reset when filters differ from defaults. Drafts maps to `status=draft`; changing filters resets pagination.
- Table columns are Content, Status, Engagement, Date, and Actions. Engagement hides below `md`; Date hides below `sm`.
- Content metadata is one flexible line: platform, content type, origin only in All, and thread count. Title and expandable body follow.
- Status uses `ContentStatusBadge`; Imported is neutral, and publish targets use semantic compact badges only when a multi-target job needs disambiguation. Target badges expose platform URLs or errors as accessible detail.
- Engagement contains metrics only. Commands use the row action menu.
- Stale rows use `bg-warning/5` plus the Attention advisory.
- Compose remains a single post input. Users request a thread in the content; the RealTimeX agent performs platform-specific splitting. Thread editor controls are legacy props and are not part of the current product pattern.
- Sent-to-agent and Content engagement errors use `FeedbackBanner`.

## Migration rules

1. Migrate one product surface at a time; preserve behavior and backend contracts.
2. Replace raw palette classes with semantic tokens before changing visual composition.
3. Reuse shared primitives; add a variant only when its meaning applies across surfaces.
4. Keep class strings literal where Tailwind scanning requires them.
5. Add pure tests for mappings and SSR tests for server-safe primitives; interactive primitives get focused happy-dom coverage.
6. Validate typecheck, lint, unit tests, palette grep, both themes, desktop/mobile, keyboard flow, and reduced motion.
7. Record intentional deferrals rather than leaving local one-off patterns.

## Rollout backlog

1. Migrate workflow status maps and category colors.
2. Migrate Settings connection success presentation.
3. Migrate Analytics, Goals, Contacts, action toast, and import feedback.
4. Adopt `FeedbackBanner` in remaining in-context feedback.
5. Adopt `PageHeader` across remaining pages.
6. Consolidate remaining platform label maps into `PLATFORM_SHORT_LABELS`.
7. Remove chart-token misuse for severity.
8. Adopt the `EmptyState` action contract across empty surfaces.
9. Decide and standardize skeleton versus shimmer loading behavior.
10. Define the toast contract.
11. Apply clickable-row keyboard accessibility to Workflows.
12. Remove dead `PostInput` thread/reorder props after usage audit.

Confidence indicators and user-selectable density are intentionally deferred until their data and preference contracts exist.
