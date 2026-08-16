# AI Chat Assistant (retired)

> **This guide is obsolete.** The in-app Cmd+K chat panel and `/api/chat` routes were removed in Epic #1 (#4). Use your **RealTimeX workspace thread** and terminal agents with `POST /api/agent-tools/invoke` instead. See `docs/rtx-agent-orchestration.md` and `docs/agent-tools.md`.

The content below is kept for historical reference only.

---

# AI Chat Assistant

**Your entire CRM, one conversation away.**

---

## Overview

Signals's AI Chat Assistant flipped the model: press **Cmd+K** from any page and a conversational panel opened. That UI has been removed.

## Replacement

- **RealTimeX workspace thread** — conversational planning and multi-step tasks
- **Agent Tools API** — `GET /api/agent-tools`, `POST /api/agent-tools/invoke`
- **Agent Flows** — importable flows under `flows/` (see `docs/agent-tools.md`)
