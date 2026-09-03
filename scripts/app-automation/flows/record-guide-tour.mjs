/**
 * Record narrated-by-caption product tours as video.
 *
 * The still screenshots in `guide/assets` show what a screen looks like; they
 * cannot show a flow. This records the same demo data being moved through, so
 * the guide and GTM material can show the product working rather than posed.
 *
 * Playwright records video natively into the browser context, so this needs no
 * ffmpeg — which matters, because `realtimex-ai-app`'s recorder shells out to
 * ffmpeg with an avfoundation screen capture and is macOS-only. This records the
 * page, not the screen: no desktop, no window chrome, no other windows wandering
 * into frame, and it runs headless in CI.
 *
 * Captions are burned in as DOM rather than added in post. There is no audio and
 * no edit step, so a tour is reproducible from `main` by anyone with the demo
 * seed — the same property that made the screenshots worth automating.
 *
 * Side-effect free on import (see README): the CLI is guarded on argv[1].
 */
import { mkdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  ID_SOURCES,
  GUIDE_VIEWPORT,
  hideDevOverlay,
  readySelector,
  resolveCaptureOrigin,
  resolveDetailIds,
  waitForVisualSettle,
} from "./capture-guide-assets.mjs";

export const RECORD_GUIDE_TOUR_FLOW_NAME = "record-guide-tour";
export const DEFAULT_VIDEO_DIR = join("guide", "video");

/** Long enough to read the caption and take in the screen, short enough to hold attention. */
export const DEFAULT_DWELL_MS = 2_800;
export const DEFAULT_SCROLL_DWELL_MS = 1_800;

/**
 * Tours as data, in the same spirit as `GUIDE_VIEWS`.
 *
 * `needs` reuses `ID_SOURCES`, so a detail step lands on the same well-enriched
 * record the screenshots use rather than whichever row happens to be newest.
 */
export const GUIDE_JOURNEYS = [
  {
    id: "product-tour",
    title: "Signals in two minutes",
    steps: [
      { path: "/dashboard", caption: "Your CRM at a glance — pipeline, tasks, and content in one view." },
      { path: "/dashboard/contacts", caption: "Every contact, with the relationship goal you set for them." },
      { path: (ids) => `/dashboard/contacts/${ids.contact}`, needs: "contact", caption: "One person: identities, employment, warmth, and what to do next.", scroll: true },
      { path: "/dashboard/content", caption: "Content across every platform, drafted and published." },
      { path: "/dashboard/content", caption: "Compose once — an agent adapts it per platform.", act: "compose", ready: '[role="dialog"]' },
      { path: "/dashboard/goals", caption: "Goals track outcomes, not activity." },
      { path: "/dashboard/workflows", caption: "Automation runs through RealTimeX agents, with full run history." },
      { path: "/dashboard/analytics", caption: "Growth, enrichment, engagement and agent cost — measured.", scroll: true },
    ],
  },
  {
    id: "contact-deep-dive",
    title: "One relationship, end to end",
    steps: [
      { path: "/dashboard/contacts", caption: "Start from the contact list." },
      { path: (ids) => `/dashboard/contacts/${ids.contact}`, needs: "contact", caption: "Open a contact.", scroll: true },
      { path: (ids) => `/dashboard/contacts/${ids.contact}`, needs: "contact", caption: "Identities across platforms, unified into one person.", act: "tab:Identities" },
    ],
  },
  {
    id: "nurture-approval",
    title: "The agent drafts, you approve",
    // Opt-in: `seed:demo` cannot produce this journey's data. Proposals only
    // exist once the `nurture-proposals` fixture has run against a bound
    // Personality and a represented target, so including it by default would
    // fail every ordinary tour run with `missing_seed_data`.
    optIn: true,
    fixture: "nurture-proposals",
    steps: [
      { path: "/dashboard/workflows", caption: "Automation runs through RealTimeX agents — and stops before anything is sent." },
      {
        path: "/dashboard/workflows",
        caption: "Nurture is draft-only on every surface, so approval is not optional.",
        act: "activate:nurture",
        ready: '[data-testid="nurture-approval-gate"]',
      },
      {
        path: (ids) => `/dashboard/workflows/${ids.nurtureRun}`,
        needs: "nurtureRun",
        caption: "The run finishes with proposals awaiting review, not posts.",
        // The section renders before its fetch resolves, so waiting on it holds
        // the caption over "Loading proposals…". Wait for a card instead.
        ready: '[data-testid="workflow-proposal-card"]',
        scroll: true,
      },
      {
        path: (ids) => `/dashboard/workflows/${ids.nurtureRun}`,
        needs: "nurtureRun",
        caption: "Approve one and it becomes an export-only draft — never an automatic post.",
        act: "approve-proposal",
        ready: '[data-testid="proposal-status"]:has-text("Materialized")',
      },
    ],
  },
];

/** Interactions a step can ask for, named so the journey data stays serialisable. */
export const STEP_ACTIONS = {
  compose: async (page) => {
    await page.getByRole("button", { name: "Compose" }).first().click();
  },
  "tab:Identities": async (page) => {
    await page.getByRole("tab", { name: /Identities/ }).first().click();
  },
  // Scoped to the template card rather than the first "Run" on the page: the
  // gallery renders one per template, and the tour is about this one.
  //
  // The dialog opens scrolled to the top, where the approval gate is below the
  // fold — so the caption would promise a locked gate over a frame of sliders.
  // Bringing it into view is part of the action, not a separate step.
  "activate:nurture": async (page) => {
    await page
      .locator('[data-testid="workflow-template-card"]', { hasText: "Contact Relationship Nurture" })
      .first()
      .getByRole("button", { name: "Run" })
      .click();
    await page.getByTestId("nurture-approval-gate").scrollIntoViewIfNeeded();
  },
  "approve-proposal": async (page) => {
    await page
      .locator('[data-testid="workflow-proposal-card"]')
      .first()
      .getByRole("button", { name: "Approve & materialize" })
      .click();
  },
};

export function stepPath(step, ids = {}) {
  return typeof step.path === "function" ? step.path(ids) : step.path;
}

export function journeyById(id, journeys = GUIDE_JOURNEYS) {
  const journey = journeys.find((candidate) => candidate.id === id);
  if (!journey) {
    throw new Error(
      `Unknown journey: ${id}. Known journeys: ${journeys.map((j) => j.id).join(", ")}`,
    );
  }
  return journey;
}

export function selectJourneys(only, journeys = GUIDE_JOURNEYS) {
  // A default run records what the demo seed can show. An `optIn` journey needs
  // fixture data the seed cannot create, so it has to be asked for by id —
  // otherwise every plain `record-guide-tour` would fail on missing seed data
  // instead of recording the tours it can.
  if (!only || only.length === 0) return journeys.filter((journey) => !journey.optIn);
  // Resolve through journeyById so an unknown id is an error rather than an
  // empty run that exits 0 having recorded nothing.
  const wanted = new Set(only.map((id) => journeyById(id, journeys).id));
  return journeys.filter((journey) => wanted.has(journey.id));
}

/** Every id kind the selected journeys need, fetched once each. */
export function requiredIdKindsForJourneys(journeys) {
  return [...new Set(journeys.flatMap((j) => j.steps).filter((s) => s.needs).map((s) => s.needs))];
}

export function videoFileName(journeyId) {
  return `${journeyId}.webm`;
}

/**
 * Caption markup, injected into the page.
 *
 * Burned into the frame rather than added in post so a tour is reproducible
 * without an edit step. `pointer-events: none` keeps it from swallowing the
 * clicks a step may need to make underneath it.
 */
export const CAPTION_ELEMENT_ID = "rtx-tour-caption";

export function captionStyles() {
  return [
    `#${CAPTION_ELEMENT_ID}{`,
    "position:fixed;left:50%;bottom:44px;transform:translateX(-50%);",
    "max-width:80%;padding:14px 26px;border-radius:9999px;",
    "background:rgba(17,20,24,.92);color:#fff;",
    "font:500 17px/1.45 ui-sans-serif,system-ui,-apple-system,sans-serif;",
    "text-align:center;z-index:2147483647;pointer-events:none;",
    "box-shadow:0 8px 30px rgba(0,0,0,.28);",
    "opacity:0;transition:opacity .35s ease;",
    "}",
    `#${CAPTION_ELEMENT_ID}.rtx-visible{opacity:1}`,
  ].join("");
}

export async function showCaption(page, text) {
  await page.evaluate(
    ({ id, css, message }) => {
      let style = document.getElementById(`${id}-style`);
      if (!style) {
        style = document.createElement("style");
        style.id = `${id}-style`;
        style.textContent = css;
        document.head.append(style);
      }
      let node = document.getElementById(id);
      if (!node) {
        node = document.createElement("div");
        node.id = id;
        document.body.append(node);
      }
      node.textContent = message;
      // Next frame, so the transition runs from opacity 0 rather than snapping.
      requestAnimationFrame(() => node.classList.add("rtx-visible"));
    },
    { id: CAPTION_ELEMENT_ID, css: captionStyles(), message: text },
  );
}

export async function hideCaption(page) {
  await page.evaluate((id) => {
    document.getElementById(id)?.classList.remove("rtx-visible");
  }, CAPTION_ELEMENT_ID);
}

/**
 * A slow scroll reads as deliberate; jumping to the bottom reads as a glitch.
 *
 * The dashboard scrolls an `overflow-auto` <main>, not the document, so driving
 * `document.scrollingElement` moves nothing — and moves it silently, burning the
 * dwell time while the frame never changes. So pick whichever candidate actually
 * has somewhere to go, and report back whether anything moved.
 */
export async function smoothScrollToBottom(page, { steps = 24, pauseMs = 28 } = {}) {
  return await page.evaluate(
    async ({ steps: count, pauseMs: pause }) => {
      const candidates = [
        ...document.querySelectorAll("main, [data-scroll-container]"),
        document.scrollingElement ?? document.documentElement,
      ];
      const [best] = candidates
        .map((node) => ({ node, distance: node.scrollHeight - node.clientHeight }))
        .sort((a, b) => b.distance - a.distance);
      if (!best || best.distance <= 0) return false;
      for (let i = 1; i <= count; i += 1) {
        best.node.scrollTop = (best.distance * i) / count;
        await new Promise((resolve) => setTimeout(resolve, pause));
      }
      return true;
    },
    { steps, pauseMs },
  );
}

export function parseArgs(argv = [], env = process.env) {
  const args = {
    only: [],
    baseUrl: env.SIGNALS_BASE_URL || null,
    videoDir: DEFAULT_VIDEO_DIR,
    dwellMs: DEFAULT_DWELL_MS,
    json: false,
    quiet: false,
    help: false,
  };

  const readValue = (index, rawArg) => {
    if (rawArg.includes("=")) return rawArg.split(/=(.*)/s)[1];
    if (index + 1 >= argv.length) throw new Error(`Missing value for ${rawArg}`);
    return argv[index + 1];
  };

  for (let index = 0; index < argv.length; index += 1) {
    const rawArg = argv[index];
    const key = rawArg.includes("=") ? rawArg.split("=")[0] : rawArg;
    switch (key) {
      case "--help":
      case "-h":
        args.help = true;
        break;
      case "--json":
        args.json = true;
        break;
      case "--quiet":
        args.quiet = true;
        break;
      case "--only":
        args.only.push(
          ...readValue(index, rawArg).split(",").map((v) => v.trim()).filter(Boolean),
        );
        if (!rawArg.includes("=")) index += 1;
        break;
      case "--base-url":
        args.baseUrl = readValue(index, rawArg);
        if (!rawArg.includes("=")) index += 1;
        break;
      case "--video-dir":
        args.videoDir = readValue(index, rawArg);
        if (!rawArg.includes("=")) index += 1;
        break;
      case "--dwell-ms": {
        const value = Number(readValue(index, rawArg));
        if (!Number.isFinite(value) || value < 0) throw new Error(`--dwell-ms must be a number: ${rawArg}`);
        args.dwellMs = value;
        if (!rawArg.includes("=")) index += 1;
        break;
      }
      default:
        throw new Error(`Unknown option: ${rawArg}`);
    }
  }
  return args;
}

export function createHelpText() {
  return [
    `Usage: node scripts/app-automation/flows/${RECORD_GUIDE_TOUR_FLOW_NAME}.mjs [options]`,
    "",
    "Record product tours as video against a running Signals instance.",
    "",
    "Options:",
    "  --only <ids>       Comma-separated journey ids. Default: all.",
    "  --base-url <url>   Record against this origin instead of the Dev app's Local App.",
    "  --video-dir <dir>  Default: guide/video",
    `  --dwell-ms <n>     Pause per step. Default: ${DEFAULT_DWELL_MS}`,
    "  --json             Emit the result as JSON on stdout.",
    "  --quiet            Suppress progress on stderr.",
    "  -h, --help         Show this help.",
    "",
    "Journeys:",
    ...GUIDE_JOURNEYS.map(
      (j) =>
        `  ${j.id.padEnd(20)} ${j.steps.length} steps — ${j.title}` +
        (j.optIn ? ` (opt-in; needs the ${j.fixture} fixture)` : ""),
    ),
    "",
    "Opt-in journeys are recorded only when named with --only.",
  ].join("\n");
}

/**
 * Visit every route once before recording starts.
 *
 * A dev server compiles routes on demand, so the first visit to each page spends
 * seconds on a skeleton. Recorded, that is half the video: the first pass took
 * 50s to show ~25s of content. Warming happens in a throwaway context so none of
 * it lands in the take.
 */
export async function warmRoutes({ browser, origin, paths, log = () => {} }) {
  const context = await browser.newContext({ viewport: { ...GUIDE_VIEWPORT } });
  const page = await context.newPage();
  try {
    for (const path of paths) {
      log(`  warming ${path}`);
      await page.goto(`${origin}${path}`, { waitUntil: "networkidle" }).catch(() => {});
    }
  } finally {
    await context.close();
  }
}

export async function recordJourney({
  page,
  journey,
  origin,
  ids,
  dwellMs,
  sleep,
  log = () => {},
}) {
  for (const [index, step] of journey.steps.entries()) {
    const path = stepPath(step, ids);
    log(`  ${index + 1}/${journey.steps.length} ${path}`);
    const response = await page.goto(`${origin}${path}`, { waitUntil: "networkidle" });
    // goto() resolves happily on a 404 or 500, and the generic h1 readiness check
    // passes on an error page — so without this a confident caption gets recorded
    // over Next's error screen. captureView already guards this way.
    const status = response?.status?.() ?? null;
    if (status != null && status >= 400) {
      throw new Error(`${journey.id} step ${index + 1}: ${path} returned HTTP ${status}`);
    }

    if (step.act) {
      const action = STEP_ACTIONS[step.act];
      if (!action) throw new Error(`Unknown step action: ${step.act}`);
      await action(page);
    }

    await page.waitForSelector(step.ready ?? readySelector(step), {
      state: "visible",
      timeout: 15_000,
    });
    await hideDevOverlay(page);
    // Same reason the screenshots settle: a stat card mid-count-up or a chart
    // mid-draw is as wrong in a video frame as in a PNG.
    await waitForVisualSettle(page);

    await showCaption(page, step.caption);
    await sleep(dwellMs);
    if (step.scroll) {
      const scrolled = await smoothScrollToBottom(page);
      // The step asked for scroll because the point of it is below the fold. If
      // nothing moved, the take holds a still frame under a caption promising
      // more — worse than failing, because it looks fine.
      if (!scrolled) {
        throw new Error(
          `${journey.id} step ${index + 1}: ${path} has nothing to scroll, ` +
            "so the step would record a still frame. Drop `scroll` or seed more data.",
        );
      }
      await sleep(DEFAULT_SCROLL_DWELL_MS);
    }
    await hideCaption(page);
    await sleep(350);
  }
}

export async function runRecordGuideTourFlow(args, dependencies = {}) {
  const {
    chromium,
    fetchImpl = fetch,
    ensureDir = (dir) => mkdirSync(dir, { recursive: true }),
    move = (from, to) => renameSync(from, to),
    discardRaw = (file) => rmSync(file, { force: true }),
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    log = () => {},
  } = dependencies;

  const journeys = selectJourneys(args.only);

  const target = await resolveCaptureOrigin({ baseUrl: args.baseUrl, fetchImpl });
  if (!target.ok || !target.origin) {
    return {
      ok: false,
      flow: RECORD_GUIDE_TOUR_FLOW_NAME,
      code: target.code,
      message: target.message,
    };
  }
  log(`origin: ${target.origin} (${target.source})`);

  const kinds = requiredIdKindsForJourneys(journeys);
  const { ids, missing } = await resolveDetailIds({ origin: target.origin, kinds, fetchImpl });
  if (missing.length > 0) {
    return {
      ok: false,
      flow: RECORD_GUIDE_TOUR_FLOW_NAME,
      code: "missing_seed_data",
      message:
        `Signals has no ${missing.join(", ")} record, so a step in this tour has nothing to show. ` +
        "Seed one with `npm run seed:demo`, or narrow the run with --only.",
      missing,
    };
  }

  ensureDir(args.videoDir);
  const browser = await chromium.launch();
  const recorded = [];

  const warmupPaths = [
    ...new Set(journeys.flatMap((j) => j.steps).map((step) => stepPath(step, ids))),
  ];
  log("warming routes");
  await warmRoutes({ browser, origin: target.origin, paths: warmupPaths, log });

  const failures = [];
  try {
    for (const journey of journeys) {
      log(`${journey.id}: ${journey.title}`);
      // One catch around the whole journey, so no step of it — opening the
      // context, recording, or promoting the file — can abort the tours that
      // come after. A journey failing is a `partial` result, not the end.
      let context = null;
      let video = null;
      let promoted = false;
      let failure = null;
      try {
        context = await browser.newContext({
          viewport: { ...GUIDE_VIEWPORT },
          colorScheme: "light",
          recordVideo: { dir: args.videoDir, size: { ...GUIDE_VIEWPORT } },
        });
        const page = await context.newPage();
        // Grabbed before the run: the handle exists immediately, but Playwright
        // only finalises the file on close, so path() must wait until after.
        video = page.video();
        try {
          await recordJourney({
            page,
            journey,
            origin: target.origin,
            ids,
            dwellMs: args.dwellMs,
            sleep,
            log,
          });
        } finally {
          // As soon as recording ends, however it ended: a step guard throwing
          // used to skip the close entirely, leaving a recorder running into
          // the next journey. Closing here is also what resolves path().
          await context.close().catch(() => {});
          context = null;
        }

        const raw = video ? await video.path().catch(() => null) : null;
        if (!raw) throw new Error("Playwright produced no video file");
        // Playwright names videos by an internal id; give them the journey name.
        const named = join(args.videoDir, videoFileName(journey.id));
        move(raw, named);
        promoted = true;
        recorded.push({ journey: journey.id, path: named, steps: journey.steps.length });
      } catch (error) {
        failure = error;
      } finally {
        if (context) await context.close().catch(() => {});
        // Resolved here rather than in the body: a step guard throwing skips
        // the body entirely, and the take still needs discarding. An unpromoted
        // one must not survive — convert-guide-video converts every .webm in
        // this directory, so it would be published under a Playwright id.
        if (!promoted && video) {
          const stray = await video.path().catch(() => null);
          if (stray) {
            try {
              discardRaw(stray);
            } catch {
              // Already failing; a leftover file is the lesser problem.
            }
          }
        }
      }
      if (failure) failures.push({ journey: journey.id, error: failure.message });
    }
  } finally {
    await browser.close();
  }

  return {
    ok: failures.length === 0,
    flow: RECORD_GUIDE_TOUR_FLOW_NAME,
    code: failures.length === 0 ? "recorded" : "partial",
    origin: target.origin,
    videoDir: args.videoDir,
    recorded,
    failures,
  };
}

async function main(argv) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
    return;
  }
  if (args.help) {
    process.stdout.write(`${createHelpText()}\n`);
    return;
  }

  const { chromium } = await import("playwright");
  let result;
  try {
    result = await runRecordGuideTourFlow(args, {
      chromium,
      log: args.quiet ? () => {} : (line) => process.stderr.write(`${line}\n`),
    });
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
    return;
  }

  if (args.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) {
    if (result.message) process.stderr.write(`\n${result.message}\n`);
    for (const failure of result.failures ?? []) {
      process.stderr.write(`${failure.journey}: ${failure.error}\n`);
    }
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv.slice(2));
}
