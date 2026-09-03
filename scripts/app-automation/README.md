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

#### Opt-in journeys

A journey marked `optIn` is recorded only when it is named with `--only`. It needs data
`seed:demo` cannot create, so including it in a default run would fail every ordinary recording
with `missing_seed_data` instead of recording the tours that *can* run.

`nurture-approval` is the first of them: it shows the #413 approval gate, the run-page proposal
inbox, and an approval turning into an export-only draft. Its data comes from the same fixture the
Experience Contracts use, which needs a bound Personality and a represented acting target — so
record it against an instance prepared the way `## Experience Contracts` describes:

```bash
npm run seed:fixture -- --fixture nurture-proposals --json
npm run automation:record-guide-tour -- --only nurture-approval --base-url http://127.0.0.1:3033
npm run automation:convert-guide-video -- --only nurture-approval
```

Re-seed the fixture before re-recording: the last step approves a proposal, so a second take
against the same run would open on a partly decided inbox.

Routes are warmed in a throwaway context first. A dev server compiles on demand, so without warming
the first visit to each page spends seconds on a skeleton: the first take ran 50s to show ~25s of
content, and 41s after warming.

Output is `.webm` at 1440x900, matching the guide screenshots. The webm is **not committed** — it is
an intermediate, regenerated wholesale on every run. The converted `.mp4` **is** committed, because
`guide/` is a published artifact and the mp4 is the form that actually uploads; a reader of the
guide should not have to run a dev server and a browser to see the product move.

### Converting for upload

X and LinkedIn do not accept webm, so `automation:convert-guide-video` re-encodes to H.264 mp4.

```bash
npm run automation:convert-guide-video                    # every recording in guide/video
npm run automation:convert-guide-video -- --only product-tour --crf 18
```

**This is the only part of app-automation that needs ffmpeg**, and it is deliberately the only part.
Recording stays dependency-free so it runs headless anywhere; ffmpeg lives at the publish boundary,
where the alternative is not publishing at all. Anyone can record — only whoever uploads needs
`brew install ffmpeg` (or `apt-get install ffmpeg`, or `SIGNALS_FFMPEG` pointing at a binary —
`ffprobe` is taken from beside it, overridable with `SIGNALS_FFPROBE`). Both binaries are checked
up front and reported by name with the install command, not as a spawn `ENOENT` partway through.

Two encode settings decide whether an upload is *accepted* rather than merely produced, and both are
pinned by a test: `yuv420p`, because x264 can otherwise emit 4:4:4 from VP8 that Safari and
QuickTime refuse to decode; and `+faststart`, which moves the moov atom ahead of the media so a
player shows a frame before fetching the whole file. A silent AAC track is added by default
(`--no-silent-audio` to skip) — tours have no audio, and some upload pipelines mishandle a video
with no audio stream at all.

### Music

The mp4s carry a silent AAC track by default. Point `--music` at an audio file and it becomes a bed
instead:

```bash
npm run automation:convert-guide-video -- --music guide/video/audio/tour-bed.mp3
npm run automation:convert-guide-video -- --no-music          # back to silence
```

The bed is **looped, trimmed to the take, and faded out**, all from the source's probed duration.
That is not incidental: tours are 40.6s and 15.9s and both shift by a few tenths on every re-record,
so a fixed-length file dropped in would hard-cut mid-phrase. `asetpts` restamps after the trim so the
fade is measured from the start of the clip rather than from wherever the loop happened to be.

`guide/video/audio/tour-bed.mp3` ships with the repo and is picked up automatically, so
`automation:convert-guide-video` with no arguments produces the published videos.

Gain defaults to `0.22`, which measures about -26 dB in the mix. The first pass used `0.12` on the
reasoning that the bed should sit under the captions — but captions are *visual*, and these tours
have no narration, so nothing competes with the music acoustically. `0.12` landed at -32 dB, close
to inaudible on laptop speakers.

**Trim a new bed past its intro.** Suno wrote a ~20s ramp into every candidate despite being asked
for steady dynamics, and an untrimmed bed makes the opening steps near-silent and the closing ones
loud. Measured over the first 40s the candidates spread 4.7-9.8 dB; measured past the intro, 0.6-1.9
dB. The committed bed is a 50s slice of that plateau — longer than either tour, so it does not even
loop.

An absent bed is a silent track, not an error, so a fresh clone converts without fetching the asset.
The output is probed for an `aac` stream whenever a bed was requested: a filter graph that drops the
music still produces a valid, watchable mp4, which is the failure that looks like success.

Worth knowing before investing in this: **X and LinkedIn autoplay muted**, so most feed viewers never
hear it. Music earns its keep in the guide embed, a demo, or a deck — not in a feed scroll. The
captions carry the message on their own, by design.

Each encode lands on a hidden partial file and is promoted to its real name only after `ffprobe`
confirms h264/yuv420p with a non-zero duration. ffmpeg exits 0 having written a zero-frame file if
its input was truncated, so an mp4 that exists is not an mp4 that plays — and re-converting in place
would destroy the last good upload artifact the moment ffmpeg started writing.

`automation:test` runs in the `check` gate. It needs no browser, no Dev app, and no second
checkout, so it is the one part of this directory that CI can hold.

## Experience Contracts

An Experience Contract is the executable statement of what a feature promises at the UI and
persisted-state boundary. Contracts live beside their scenarios as
`scenarios/<id>.contract.mjs` + `scenarios/<id>.mjs`; a contract without a runnable sibling is a
test failure. This keeps the #301 bar intact: do not add a general framework or a prose contract
that is more expensive than rebuilding one journey ad hoc.

Run one contract against a healthy Signals origin:

```bash
npm run automation:contract -- issue-413-review-path \
  --base-url http://127.0.0.1:3010 \
  --data-dir /private/tmp/signals-qa-issue-413 \
  --json
```

The contract's checkpoint IDs are the durable UX contract. Every checkpoint has an assertion that
can compare UI observations with authoritative API/data observations. The ledger fails on an
undeclared or duplicate record, a declared-but-missing record, an assertion failure, or a missing
required capture. A deliberately unreachable journey is not skipped: its guard records every
checkpoint as `blocked`, and the manifest result is `blocked` with exit code 2.

Evidence profiles are intentionally separate:

- `assertions` is the default for behavior with no material visual claim.
- `visual` is required for approval, autonomy, publish/materialize, hidden-state, and explicit UX
  claims. It produces clean QA screenshots; `--promote-evidence` derives the committed
  desktop/mobile × light/dark `before_` or `after_` stills.
- GTM editing is a downstream, opt-in consumer of clean QA capture. Captions, music, and encoding
  do not belong in a feature's diagnostic scenario.

Raw output is written to `.evidence/experience/<contractId>/<stamp>/` (or under
`RTXTEST_ARTIFACTS_DIR` when `rtxtest` supplies one) and is gitignored. Its `manifest.json` pins:

```text
schemaVersion · contract id/path/hash · issue/kind · commit SHA/dirty flag
target origin/source/health app · evidence profile · fixture ids
started/finished timestamps · result · checkpoint assertions/evidence · failures
```

PRs link the raw manifest path and paste its checkpoint table; they commit only the promoted
`before_`/`after_` stills required for review. `npm run automation:test` validates every contract,
requires a sibling scenario, and keeps checkpoint IDs globally unique.

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
