**Signals v0.5 — Full Implementable Specification**

**Version:** 0.5  
**Date:** 2026-08-14  
**Product Name:** Signals  
**Previous codenames:** SocialGTM / OpenSignal / AudienceForge

### 1. Vision
Signals is a local-first platform that maintains a true multi-source living knowledge graph of people (Contacts) and organizations (Orgs).

It operates in two tightly integrated modes:

- **Social GTM mode**: High-signal X audience mapping, creative generation, and simulated audience testing (Wind Tunnel) so every launch and post is optimized against real audience structure before it goes live.
- **Relationship Management mode**: Intentional tracking and nurturing of personal and professional relationships (including turning acquaintances into friends) with interaction history, health scoring, and AI-powered suggestions.

Goals are first-class nodes that convert activity into measurable outcomes. Analytics show both current state and progress toward those outcomes.

**Core philosophy**  
Activity is not outcome. Measure what matters.  
The same graph that powers audience simulation also powers deep human relationship tracking — professional and personal.

Signals is proprietary software distributed through the RealTimeX Marketplace. No public source release is planned under this specification.

### 2. Core Principles
- Graph-first: Everything is nodes + typed edges.
- Multi-source by default: Contacts aggregate identity and activity across X, LinkedIn, Gmail, and future sources. A Contact is never X-only.
- Dual-mode design: Strong X-centric GTM loop for launches; Relationship Management mode for people and relationship health.
- Contacts **and** Orgs are first-class citizens.
- Goals are Nodes. Contribution relationships are edges.
- Local-first, privacy-preserving.
- Outcome-oriented: major actions can advance one or more Goals.
- Private personal notes and relationship stages remain local and are excluded from public GTM simulations unless explicitly permitted.

### 3. Graph Model

#### Nodes
- **Contact** — Unified multi-source person
- **Org** — Organization / company / fund / team
- **Content** — Post, thread, email, message, etc.
- **Niche** — Derived interest or firmographic cluster
- **Launch** (Campaign)
- **Variant** — Generated creative
- **Goal** — Measurable target
- **Interaction / Event**
- **PlatformIdentity**
- **WorkflowRun / AgentRun** (optional)

#### Key Edge Types
**Social & Professional**
- follows, connected_to, works_at / founded / advises / invested_in, member_of, engaged_with, etc.

**Relationship Management**
- relationship (with properties):
  - relationship_type: professional | personal | mixed
  - stage (personal: stranger → acquaintance → friendly → friend → close_friend; professional equivalents)
  - strength / warmth_score (0–100)
  - last_meaningful_interaction
  - context / notes
  - desired_direction
  - private_notes (strictly local)
- had_interaction
- contributes_to / advances → Goal

### 4. Primary Modules

**A. Graph Engine**  
Multi-source ingestion, identity resolution, embeddings, continuous sync, living graph storage & querying.

**B. Audience Intelligence**  
X-follower subgraph, automatic niche clustering + naming, interactive Audience Map (people + org grouping), org-level views.

**C. Creative Studio**  
Single brief → multi-niche / org-aware variants (copy + visuals). Versioning and comparison.

**D. Wind Tunnel**  
Agent populations grounded in real Contact + Org data. Multi-variant simulation, predicted engagement + confidence, real-outcome feedback.

**E. Launch & Deploy**  
Publish to X, track real performance, link outcomes to niches, orgs, and Goals.

**F. Relationship Management Mode**  
- Relationship Dashboard / People View
- Individual Relationship Timeline
- Health indicators
- AI nurturing suggestions
- Auto + manual interaction logging
- Privacy controls for personal data

**G. Analytics Dashboard**  
Overview, Audience/Graph Health, Launches & Content, Simulation Performance, Relationship Health, Agents/Workflows, Sync Health. Date-range filtering throughout.

**H. Goals System**  
Goals are first-class Nodes.

Types include: Audience Growth, Niche Coverage, Content Publishing, Engagement Lift, Org Penetration, Simulation Accuracy, Relationship Deepening, New Friendships, Re-engagement, Network Maintenance, Custom.

Auto-progress via contribution edges. Manual override available. Goals organize the system.

### 5. Recommended Tech Stack

**Application shell**
- Next.js (App Router) + React 19 + TypeScript
- SQLite + Drizzle ORM + local vector support
- Local data under `~/.signals/` (override with `SIGNALS_DATA_DIR`)
- Tailwind CSS + shadcn/ui
- Marketplace bootstrap: signed, target-specific Local App runtime managed by RealTimeX
- AES-256 encrypted credentials
- Strong isolation of private relationship data

**RealTimeX Local App integration**
- RealTimeX SDK — `POST /sdk/register`, permission grants, embedded lifecycle (`RTX_APP_ID`)
- Terminal agents + Agent Flows — open-ended CRM work via Signals [`/api/agent-tools`](../docs/agent-tools.md)
- RealTimeX Browser + **agent-browser** — profile enrichment and delegated scraping (replaces in-process Playwright enrichment)
- RTX `llm.embed` — on-demand embeddings for semantic search (vectors stay in Signals)
- RTX `llm.chat` — schema-validated workflows Signals orchestrates itself (e.g. persona generation), provenance on `workflow_runs`

See [`docs/realtimex-local-app.md`](../docs/realtimex-local-app.md) for the integration map and upstream RTX references.

**Still in Signals (migration in progress)**
- Playwright — publish/engage browser sessions only (`#6` migrates remaining paths to agent-browser)
- react-force-graph — audience map visualization (planned)

**Removed (#4–#5, shipped)**
- Vercel AI SDK — in-app chat (`/api/chat`), in-process agent tool loops, content AI routes
- In-process Playwright profile scraping / LLM profile parsing — delegate to RTX agent-browser + `enrich_contact`

### 6. Data Model (Conceptual)
Unified contacts with platform_identities, first-class orgs, flexible property-graph edges, embeddings, goals as nodes with contribution edges, interactions linked to relationships, launches/variants/simulations fully connected to the graph and Goals. Private notes clearly isolated.

### 7. Phased Roadmap

**Phase 1** — Graph Foundation + X Audience Map  
Multi-source identity, living graph, niche clustering, interactive map, basic org detection, Goal nodes.

**Phase 2** — Creative Studio + Wind Tunnel  
Variant generation, Contact+Org-aware simulation, publish, real metrics, core GTM Goal auto-progress.

**Phase 3** — Relationship Management + Org Intelligence  
Relationship edges, stages, strength scoring, Dashboard & Timeline, interaction logging, AI suggestions, Relationship Goal types, expanded Analytics.

**Phase 4** — Scale, Calibration & Open Source Prep  
Large-account handling, continuous improvement of simulations, advanced suggestions, richer scoring, exports, privacy hardening, and hardened proprietary marketplace distribution.

### 8. Key Design Decisions
- Product name is **Signals**.
- Goal = Node; contribution = Edge.
- Same graph powers both GTM audience simulation and personal/professional relationship tracking.
- X is the highest-priority signal for the classic launch experience; the graph underneath is fully multi-source.
- Users can stay in pure GTM mode, pure Relationship mode, or move fluidly between them.
- Developed and distributed as proprietary software through the RealTimeX Marketplace.

### 9. Example Flows
**GTM Launch**: Sync → cluster niches → brief → generate variants → Wind Tunnel → ship → outcomes advance Goals.

**Build a Friendship**: Identify Contact → set relationship edge (stage + desired direction + context) → system tracks & suggests → log interactions → strength/stage update → progress visible in Relationship Goals and timeline.

---
