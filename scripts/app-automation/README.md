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
npm run automation:check-target          # is Signals reachable in the Dev app right now?
npm run automation:capture-guide-assets  # regenerate every screenshot guide/ references
npm run automation:test                  # unit-test the flows (no Dev app required)
```

`automation:record-guide-tour` records the same demo data being *used*, as video. Stills show what
a screen looks like; they cannot show a flow.

```bash
npm run automation:record-guide-tour -- --base-url http://127.0.0.1:3111 --json
npm run automation:record-guide-tour -- --only product-tour
```

Playwright records the page natively, so this needs no ffmpeg — which matters, because
`realtimex-ai-app`'s `recorder.mjs` shells out to ffmpeg with an avfoundation screen capture and is
macOS-only. Recording the page rather than the screen also means no desktop, no window chrome, no
other window wandering into frame, and it runs headless.

Captions are burned in as DOM rather than added in post, so a tour is reproducible from `main` by
anyone with the demo seed — the same property that made the screenshots worth automating. There is
no audio and no edit step.

Routes are warmed in a throwaway context first. A dev server compiles on demand, so without warming
the first visit to each page spends seconds on a skeleton: the first take ran 50s to show ~25s of
content, and 41s after warming.

Output is `.webm` at 1440x900, matching the guide screenshots. It is **not committed** — see
`.gitignore`. Video regenerates on every run, and binaries that change wholesale each time belong in
a CDN or release, not in git history.

### Converting for upload

X and LinkedIn do not accept webm, so `automation:convert-guide-video` re-encodes to H.264 mp4.

```bash
npm run automation:convert-guide-video                    # every recording in guide/video
npm run automation:convert-guide-video -- --only product-tour --crf 18
```

**This is the only part of app-automation that needs ffmpeg**, and it is deliberately the only part.
Recording stays dependency-free so it runs headless anywhere; ffmpeg lives at the publish boundary,
where the alternative is not publishing at all. Anyone can record — only whoever uploads needs
`brew install ffmpeg` (or `apt-get install ffmpeg`, or `SIGNALS_FFMPEG` pointing at a binary). A
missing ffmpeg is reported by name with the install command, not as a spawn `ENOENT`.

Two encode settings decide whether an upload is *accepted* rather than merely produced, and both are
pinned by a test: `yuv420p`, because x264 can otherwise emit 4:4:4 from VP8 that Safari and
QuickTime refuse to decode; and `+faststart`, which moves the moov atom ahead of the media so a
player shows a frame before fetching the whole file. A silent AAC track is added by default
(`--no-silent-audio` to skip) — tours have no audio, and some upload pipelines mishandle a video
with no audio stream at all.

The output is probed with `ffprobe` and rejected unless it is h264/yuv420p with a non-zero duration.
ffmpeg exits 0 having written a zero-frame file if its input was truncated, so an mp4 that exists is
not an mp4 that plays — the same reason the capture flow settles before it believes a screenshot.

`automation:test` runs in the `check` gate. It needs no browser, no Dev app, and no second
checkout, so it is the one part of this directory that CI can hold.

## Guide assets

`guide/` ships 15 referenced screenshots. Until `capture-guide-assets` they were effectively
unmaintainable: `scripts/capture-settings-evidence.mjs` (written for #320) regenerated two of them,
and the other thirteen were captured by hand in `f033f96`. Hand-captured assets drift silently —
the UI moves, the guide keeps showing the old screenshot, and nothing fails.

```bash
npm run automation:capture-guide-assets -- --json
npm run automation:capture-guide-assets -- --only settings-platforms,settings-agents
npm run automation:capture-guide-assets -- --base-url http://127.0.0.1:3000 --no-evidence
```

Capture against demo data, not a real CRM — this repo is public, and the guide is a published
artefact:

```bash
SIGNALS_DATA_DIR=/tmp/signals-demo npm run seed:demo
SIGNALS_DATA_DIR=/tmp/signals-demo PORT=3111 npm run dev
npm run automation:capture-guide-assets -- --base-url http://127.0.0.1:3111
```

The two outputs are different products, captured in separate passes:

| | viewport | themes | `fullPage` | naming |
|---|---|---|---|---|
| `.evidence/` | 1280x900, 390x844 | light + dark | yes | `after_<view>_<form>_<theme>.png` (#320's convention) |
| `guide/assets/` | 1440x900 | light | **no** | `<view>.png` |

The guide is not "the desktop+light evidence cell". The fifteen committed assets are 1440x900
viewport shots; publishing full-page captures instead produced a 1280x3442 compose-dialog image
with the dialog as a small box at the top. The Next.js dev issue badge (`nextjs-portal`) is hidden
before every capture, because the guide is routinely shot against a dev server — that is where the
seed data lives.

Two rules the flow exists to enforce, both versions of "a valid PNG of the wrong thing is worse
than a failure":

- **The origin is resolved, never assumed.** `capture-settings-evidence.mjs` defaulted to
  `http://127.0.0.1:3010`. Local App ports get reassigned, so a 200 there only proves *something*
  is listening — the `not_signals` case below. Capture goes through `resolve-signals-target` (or
  health-checks an explicit `--base-url` through the same classifier).
- **A page must be confirmed before it is published.** A 404 detail route and a
  `chrome-error://` document both settle into `networkidle` and screenshot beautifully. The flow
  checks the HTTP status, waits on a per-view ready selector, and compares the heading where the
  heading is static.
- **The page must have stopped moving.** `networkidle` and the ready selector both pass while the
  UI is still animating. The dashboard's stat cards count up over 800ms via `requestAnimationFrame`
  (`src/components/animated-stat.tsx`), and the first run of this flow against a 12-contact
  database produced a hero screenshot reading **11** — beside a funnel that correctly summed to 12.
  `waitForVisualSettle` polls the rendered text until two consecutive reads match. It gives up
  after 5s rather than blocking: a page with a live clock never settles, and refusing to capture it
  would be worse.

Detail views (`contact-detail`, `content-detail`, `goal-detail`, `workflow-detail`) need a real
record. The flow resolves one id per kind from the list APIs first and fails with
`missing_seed_data` naming the empty kind, rather than capturing a 404.

Adding a screenshot to `guide/` without adding it to `GUIDE_VIEWS` fails `automation:test`. That
guard is the point: it is what stops the set drifting back to hand-captured one asset at a time.

How far the committed set had already drifted, as of this flow landing: `dashboard-overview.png`
still shows the product branded **OpenVolo**, with a left nav missing Explore, Companies and
Launches. Six months of UI change (the set was captured in `f033f96`, 2026-02-11), invisible
because nothing could re-render it.

`guide/assets/ai-assist-panel.png` and `chat-panel.png` are referenced by no guide page and match
no component in `src/`; they are stale output from an earlier draft, listed in
`KNOWN_ORPHAN_ASSETS` so the next reader does not re-derive that.

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

`specs/company-intelligence.md` still plans its evidence capture as "a copy of
`scripts/capture-settings-evidence.mjs`". Copying the script is the rebuild-it-ad-hoc pattern #301
is about; that capture wants a second manifest in this directory instead.
