# App Automation

Automation that drives **Signals running as a Local App inside the RealTimeX Dev app**, over the
Dev app's CDP endpoint (`http://127.0.0.1:9888` by default, override with `RTX_DEV_CDP_URL`).

Structure borrowed from `realtimex-ai-app/scripts/app-automation`, deliberately not its code — that
harness is macOS-only and built around installed-app lifecycle (install version, reset data, kill
app), which Signals does not need.

## Why this exists

`AGENTS.md` §10 already described how to do RealTimeX integration QA by hand, and during #299/#300
two independent agents were handed it and both built their own throwaway harness instead. The
documented path cost more than rebuilding it. See #301.

So the bar here is not "more automation" — it is **cheaper than rebuilding it ad hoc**. Anything
added should pay for itself the first time it is used.

## Directory model

- `flows/` — reusable verbs, one clear responsibility. **Side-effect free on import**: export
  functions, never run on load. (`node --test` executes files as subprocesses, so a self-invoking
  CLI in a flow turns into a spurious test failure.)
- `scenarios/` — user journeys composed from flows.
- `scripts/` — small manual helpers and probes. Never called from CI. A helper may be *promoted*
  to a package script once it earns it — `automation:check-target` is the one promotion so far, and
  new helpers should not assume the same.

If it can be named as a single verb, it is a flow. If it is a story made of several verbs, it is a
scenario.

## Running

```bash
npm run automation:check-target   # is Signals reachable in the Dev app right now?
npm run automation:test           # unit-test the flows (no Dev app required)
```

## The failure this is built around

A CDP page target keeps advertising its intended URL after the Local App stops. The target looks
correct while the document is actually `chrome-error://chromewebdata/`. An automation that matched
on `target.url` alone would evaluate against an error page, observe an empty UI, and report the
feature broken.

`flows/resolve-signals-target.mjs` exists to turn that into a specific diagnosis:

| code | meaning |
|---|---|
| `dev_app_unreachable` | Dev app not running — start it with `yarn dev:all` |
| `signals_not_open` | Dev app is up, but no Signals Local App page is open |
| `local_app_stopped` | target advertises a URL but the document did not load |
| `server_unhealthy` | page loaded, but `/api/health` is not answering |
| `not_signals` | something else is serving this port — `app` is not `signals` |
| `ready` | safe to assert against |

Resolve the target before asserting anything. A scenario that skips this step cannot distinguish "the
feature is broken" from "the app is not running", which is the misdiagnosis that makes automation
cost more than it saves.

## Not yet built

Gallery deploy lifecycle and the deploy-refusal journey — both specified by QA's #300 report. They
build on `resolve-signals-target`. #301's non-goal stands: no broad harness before one journey runs
green.
