# Contacts and Enrichment

**Every relationship starts with knowing who you're talking to.**

---

## The Missing Piece

Paul Graham wrote that [AI is the missing piece in important, almost-completed puzzles](http://www.paulgraham.com/ace.html). Managing contacts across X and LinkedIn has been one of those puzzles for years. You know the pain: someone DMs you on X, you connect on LinkedIn, you exchange emails — and now that person exists in three places with no unified view. Traditional CRMs tried to solve this with manual data entry and expensive integrations. AI enrichment is the missing piece that finally makes it work.

Signals treats every person as a single record with multiple **identities** — their X handle, LinkedIn profile, email address — all linked to one contact. When an AI agent enriches a contact, it doesn't just add a field; it searches the web, scrapes profiles, and fills in the gaps automatically.

## The Contacts List

The Contacts page is your central directory. Every person in your CRM appears here, regardless of which platform they came from.

![Contacts list — your unified contact directory](assets/contacts-list.png)
*The Contacts list: search, filter by funnel stage, and see enrichment scores at a glance.*

Key features of the contacts list:

- **Search** — Find contacts by name, company, or headline
- **Stage filter** — Filter by funnel stage (All Stages, Prospect, Engaged, Qualified, Opportunity, Customer, Advocate)
- **Show Archived** toggle — Reveal contacts that agents have flagged for pruning (hidden by default)
- **Add Contact** — Manually create a contact or let agents discover them automatically
- **Enrichment scores** — Each contact shows a score from 0-100 indicating data completeness

### Understanding Enrichment Scores

Every contact has an enrichment score that reflects how much Signals knows about them. The score is computed on every write — creating a contact, updating fields, adding identities — so it's always current.

Scores break down intuitively:

| Score Range | Label | What It Means |
|-------------|-------|---------------|
| 0-20 | Sparse | Just a name and platform. Needs enrichment. |
| 21-50 | Basic | Has some fields filled in — company, headline, maybe an email. |
| 51-80 | Good | Multiple identities linked, most fields populated, tags applied. |
| 81-100 | Rich | Fully enriched — bio, location, website, multiple platforms, notes. |

The score isn't vanity. It drives agent behavior. The **Enrich Low-Score Contacts** agent specifically targets contacts with sparse or basic scores and fills in the gaps using web search and browser scraping.

## Contact Detail

Click any contact to see their full profile.

![Contact detail — complete profile with identities and tasks](assets/contact-detail.png)
*Contact detail for Jason Calacanis: profile information, platform tags, and editable fields.*

The detail page has three tabs:

### Details Tab
The main profile view shows:
- **Contact Information** — Headline, bio, platform origin, and topic tags (investor, podcast, startups, tech-media)
- **Edit Contact** — All editable fields: name, company, title, headline, email, phone, location, website, funnel stage, platform, and free-form notes
- **Metadata** — Created date, last updated, enrichment score badge

### Identities Tab
A contact's linked profiles across platforms. One person might have:
- An X/Twitter identity (`@handle`)
- A LinkedIn identity (profile URL)
- A Gmail identity (email address)

Identities are how Signals maintains the golden record. When an agent discovers that a contact's X bio mentions their LinkedIn, it can link them automatically.

### Tasks Tab
Action items associated with this contact — follow-up reminders, outreach tasks, demo scheduling. Tasks have priority levels (high, medium, low) and due dates.

## AI-Powered Enrichment (RTX)

Signals no longer runs in-process enrichment agents. Use **RealTimeX terminal agents** with the Agent Tools API:

1. `query_contacts` with `sort: "enrichmentScore"` and `order: "asc"` to find sparse profiles
2. RealTimeX Browser + **agent-browser** to read public profile evidence
3. `enrich_contact` to fill gaps in the CRM

See `docs/rtx-agent-browser-enrichment.md` and `docs/rtx-agent-orchestration.md`.

The **Automation → Workflows** agent gallery provides task briefs for RealTimeX terminal agents. Click **Run** to launch an agent on an RTX workspace thread; the agent executes via `realtimex-signals` and `POST /api/agent-tools/invoke`. Recurring schedules belong in **RealTimeX Agent Flows** — Signals `scheduled_jobs` do not execute agent templates locally.

## Smart Pruning

Not every contact deserves a spot in your CRM. The **Prune Inactive Contacts** agent evaluates your contact list and archives people who show no recent social activity, invalid profiles, or low engagement potential.

Archived contacts aren't deleted — they're flagged with metadata that records:
- **Who** archived them (which workflow run)
- **Why** (the agent's reasoning)
- **When** (timestamp)

You can restore archived contacts individually from their detail page or in bulk from the workflow run detail page. The "Show Archived" toggle on the contacts list reveals them when you need to review the agent's decisions.

This is the AI equivalent of regularly cleaning your Rolodex, except the AI does the evaluation and you keep veto power.

## Deduplicating Contacts

Importing from several sources — an X archive, a LinkedIn CSV, a Gmail takeout, an agent research
run — tends to create more than one record for the same person. Worse, only the first record can
claim a given platform account, so the later ones are left with no identities at all and never
enrich properly.

The **Deduplicate & Merge Contacts** agent in **Automation → Prune** finds those records and
consolidates them. It matches on three levels:

- **Exact** — the same email address, or the same handle on the same platform.
- **Name + company** — the same or a near-identical name at the same organization, which catches
  "Jim Fan" and "Jim Linxi Fan" at NVIDIA.
- **Graph overlap** — the same employer plus overlapping conversation threads, for cases where the
  names alone are not close enough to trust.

Merging is lossless. Identities, email and phone channels, employment history, interactions,
tasks, and content all move to the surviving record, and anything the survivor was missing gets
filled in from the duplicate. Nothing is deleted: the duplicate is archived and stamped with the
id of the record it was merged into, so you can always see where it went.

Run it with a preview first if you want to see the plan before anything changes, and re-run it as
often as you like — merging the same group twice does nothing the second time.

### Reviewing duplicates yourself

The agent is optional. The **Review duplicates** button on the agent's card opens a panel that
runs the same detection engine directly — no agent, no model cost, no waiting on a terminal
session. It lists each group with both records side by side, marks the one it suggests keeping,
and merges only when you press **Merge** (or **Merge all**). Nothing is archived until you do.

Merges from the panel are still recorded the way agent runs are: they appear in **Runs** as a
prune run with one step per group, and they post a summary into the agent's thread alongside its
agent runs. The difference is only in who did the work — the panel merges in-app, so the run
carries no terminal session.

The panel opens on **Tier 1 only**, where a shared email address or platform handle is the
evidence and no judgment is needed. Widen it to tier 2 or 3 when you want the fuzzier candidates,
but read those groups before merging — two people at the same company with similar names are
exactly what tier 2 is designed to surface, and occasionally they really are two people.

## Multi-Platform Golden Record

The real power of Signals's contact system is the unified view. A founder you follow on X, connected with on LinkedIn, and emailed through Gmail shows up as **one contact** with three identities. Agents can enrich from any platform and the score reflects the combined data.

This matters because relationships don't live on one platform. The person who engages with your X thread might be the same person your LinkedIn connection introduced you to. Signals keeps that context intact.

## What's Next

You've got contacts in the system and agents enriching them. Now it's time to turn those relationships into content.

**Next: [Content and Publishing](03-content-and-publishing.md)** — Draft posts in Signals and publish to X and LinkedIn; use RealTimeX agents for AI-assisted drafting via agent-tools and RTX flows.

**Also see: [AI Agents and Automation](04-ai-agents-and-automation.md)** — RTX orchestration, agent-tools, and scheduling migration.
