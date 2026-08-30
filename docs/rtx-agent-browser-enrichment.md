# RealTimeX agent-browser profile enrichment

Signals no longer scrapes X profiles with in-process Playwright. Enrichment runs through **RealTimeX Browser** sessions and the **agent-browser** CLI, with CRM writes via the local **Agent Tools API**.

Publish and engage flows for **X** use the RTX Browser `signals-publish` session via CDP (`docs/rtx-browser-publish.md`). LinkedIn publish still uses Signals-managed browser sessions until P6b.

## Architecture

```
RTX terminal agent
  → RealTimeX Browser session (CDP port)
  → agent-browser connect / snapshot / extract
  → POST /api/agent-tools/invoke (enrich_contact | create_contact)
  → SQLite CRM (local)
```

## Prerequisites

1. Signals running from a private source checkout or as an RTX Local App.
2. RealTimeX Browser session with an authenticated X tab (see workspace `agent-browser` skill).
3. Agent Tools API reachable at `http://127.0.0.1:3000/api/agent-tools/invoke` (or your Signals port).

Optional auth when not on localhost:

```bash
export SIGNALS_AGENT_TOOL_TOKEN="your-secret-token"
```

## Workflow (terminal agent)

### Contact Web Research from contact detail

The contact detail **Enrich profile** action is a smart router:

- Contacts with no active identity, `enrichmentScore < 40`, or an empty ARPP `sameAs` launch the
  seeded **Contact Web Research** template through `runTemplateViaRtx`.
- Rich contacts with a linked identity stay on **Contact profile pipeline** for X hydration,
  avatars, and persona synthesis.
- A successful web-research result with `identityLinked: true` immediately cascades the same
  contact into Contact profile pipeline.

The web-research run uses `get_contact_arpp` as its v1 gap checklist (`sameAs`, biography/headline,
and experience). It is identity-first: an existing primary profile URL is opened before Google.
Otherwise the generated brief provides a deterministic primary query and one quoted LinkedIn
refinement.

Before opening any result, the agent must snapshot the SERP and write
`workflow-runs/{runId}/serp-candidates.json`. Signals owns the scoring rules: LinkedIn `/in/`
`+100`, X profile `+80`, matching company domain `+70`, Crunchbase person `+50`,
Wikipedia/Wikidata person `+40`, and news/directories `-50`, plus name/company/role text matches
and a `-80` wrong-person penalty. Only candidates scoring at least 60 may be visited; SERP position
is not a selection rule. AI Overview citations are candidate URLs, never evidence until opened.

Ambiguous or sub-threshold results get one refined search and a second triage. Remaining ambiguity
must complete without `upsert_contact_identity`, with `ambiguous: true` and `partial: true`. The
total budget is two Google searches, three post-SERP page visits, two registrable domains, and
about 90 seconds.

Dashboard endpoints:

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/contacts/:id/web-research` | Poll the latest run state and structured result |
| `POST` | `/api/contacts/:id/web-research` | Launch Contact Web Research (`202`) or reject a duplicate pending run (`409`) |

The completion callback stores `fieldsUpdated`, `unresolvedFields`, `identityLinked`,
`visitedUrls`, `serpCandidates`, `ambiguous`, `partial`, and `message` under the workflow run
result. Only facts from visited pages may be written back.

### 1. Select contacts to enrich

```bash
curl -s http://127.0.0.1:3000/api/agent-tools/invoke \
  -H 'Content-Type: application/json' \
  -d '{"tool":"query_contacts","input":{"pageSize":10,"sort":"enrichmentScore","order":"asc"}}'
```

Prioritize low `enrichmentScore` contacts or pass explicit IDs from the dashboard.

### 2. Open RealTimeX Browser and attach agent-browser

Follow the workspace **agent-browser** skill:

1. Create/start a RealTimeX Browser session (moderator SDK or `realtimex-pp-cli`).
2. Log into X in the content tab if needed.
3. Attach: `agent-browser --session <name> connect <remoteDebugPort>`
4. Select the HTTPS X tab (not the Electron shell target).

### 3. Scrape profile evidence

Use agent-browser upstream commands (`snapshot`, `get text`, etc.) to read:

- Display name, bio, location, website
- Pinned tweet and recent tweets (when visible)
- Public email/phone only when explicitly present in bio

Do not guess fields. Only write what you can cite from the page.

### 4. Write structured updates

Use `enrich_contact` to fill gaps without overwriting existing data:

```bash
curl -s http://127.0.0.1:3000/api/agent-tools/invoke \
  -H 'Content-Type: application/json' \
  -d '{
    "tool": "enrich_contact",
    "input": {
      "contactId": "<id>",
      "title": "CTO",
      "company": "AcmeAI",
      "email": "jane@acme.ai",
      "headline": "CTO at AcmeAI"
    }
  }'
```

For net-new people discovered during prospecting, use `create_contact` instead.

### 5. Record provenance (optional)

Add a note on the contact or log an interaction when enrichment came from a manual agent pass:

```bash
curl -s http://127.0.0.1:3000/api/agent-tools/invoke \
  -H 'Content-Type: application/json' \
  -d '{
    "tool": "log_interaction",
    "input": {
      "contactId": "<id>",
      "interactionType": "note",
      "summary": "Profile enriched via RTX agent-browser on 2026-08-15"
    }
  }'
```

## Signals UI behavior

- **Automation → Workflows → Enrich Profiles (RTX)** shows migration guidance on the Workflows tab. It does not queue or run in-app enrichment.
- **Contact detail → Enrich profile** launches Contact Web Research for sparse or identity-less
  contacts and Contact Profile Pipeline for rich linked contacts. The legacy in-app `RTX enrich`
  button remains removed.
- **Settings → Browser Session** remains for **publish/engage**, not in-app enrichment.

## Related docs

- `docs/agent-tools.md` — tool manifest and invoke envelope
- `docs/rtx-agent-orchestration.md` — removed in-app AI SDK / chat / agent runner
- Workspace skill: `.claude/skills/agent-browser/SKILL.md`
