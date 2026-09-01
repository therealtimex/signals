/**
 * Capture every screenshot the published user guide depends on.
 *
 * `guide/` ships 15 referenced screenshots but only two of them were ever
 * reproducible: `scripts/capture-settings-evidence.mjs` covered the two settings
 * tabs it was written for in #320, and the other thirteen were captured by hand
 * in f033f96. Hand-captured assets drift silently — the UI moves, the guide keeps
 * showing last quarter's screenshot, and nothing fails. This flow makes the whole
 * set regenerable so drift is a diff instead of a discovery.
 *
 * Two things it deliberately does NOT do:
 *
 * 1. It does not hardcode an origin. `capture-settings-evidence.mjs` defaulted to
 *    `http://127.0.0.1:3010`, which is exactly the port-drift failure that
 *    `resolve-signals-target`'s `not_signals` code exists to catch: Local App
 *    ports get reassigned, so a 200 on :3010 only proves *something* is
 *    listening. The origin is resolved and health-checked before any capture.
 * 2. It does not screenshot a page it could not confirm. A 404 detail page or a
 *    `chrome-error://` document still yields a perfectly valid PNG, and a
 *    perfectly valid PNG of the wrong thing is worse than a failure — it lands in
 *    the guide looking deliberate.
 *
 * Capture runs through Playwright's own Chromium rather than the Dev app's CDP
 * target. The guide should show Signals, not Electron's window chrome, and a
 * fresh browser context is what makes viewport and colour scheme controllable.
 * The Dev app is still the source of truth for *where* Signals is.
 *
 * Side-effect free on import (see README): the CLI below is guarded on argv[1].
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { classifySignalsTarget, resolveSignalsTarget } from "./resolve-signals-target.mjs";

export const CAPTURE_GUIDE_ASSETS_FLOW_NAME = "capture-guide-assets";

/**
 * `.evidence/` and `guide/assets/` are different products, not one matrix and a
 * cell of it.
 *
 * Evidence is for PR review: every form factor and theme, `fullPage` so nothing
 * below the fold is hidden. The guide is a published artefact: a single 1440x900
 * viewport shot, matching the fifteen assets already committed. Treating the
 * guide as "the desktop+light evidence cell" produced 1280x3442 full-page images
 * — a 3400px-tall screenshot with the compose dialog as a small box at the top
 * is a valid PNG of the wrong thing.
 */
export const FORM_FACTORS = [
  { label: "desktop", width: 1280, height: 900 },
  { label: "mobile", width: 390, height: 844 },
];
export const THEMES = ["light", "dark"];
export const GUIDE_VIEWPORT = { width: 1440, height: 900 };
export const GUIDE_THEME = "light";

/**
 * Detail routes need a real row. The list endpoints disagree about their envelope
 * (`/api/content` returns `items`, the rest return `data`), so each source states
 * how to read itself rather than the caller guessing.
 */
export const ID_SOURCES = {
  contact: { path: "/api/contacts?pageSize=1", pick: (body) => body?.data?.[0]?.id ?? null },
  // Content is fetched a page at a time so a *titled* item can be preferred:
  // `title` is optional on content (only 6 of the first 25 rows have one), and a
  // detail screenshot of an untitled row is a markedly worse guide illustration.
  // Falls back to the first row so a corpus with no titles still captures.
  content: {
    path: "/api/content?pageSize=25",
    pick: (body) => {
      const items = body?.items ?? [];
      return (items.find((item) => item?.title) ?? items[0])?.id ?? null;
    },
  },
  goal: { path: "/api/goals?pageSize=1", pick: (body) => body?.data?.[0]?.id ?? null },
  workflow: { path: "/api/workflows?pageSize=1", pick: (body) => body?.data?.[0]?.id ?? null },
};

/**
 * Every asset `guide/` actually references, plus `settings-page.png`, which is on
 * disk and trivially reproducible.
 *
 * `ready` defaults to `h1` because the shared `PageHeader` renders one on every
 * dashboard route. `/dashboard/content/[id]` is the one exception — it has no
 * PageHeader at all — and that exception is why `ready` is per-view rather than
 * a constant.
 *
 * `heading` is asserted only where the title is static. Detail routes title
 * themselves from the record, so there is nothing stable to compare against;
 * for those, resolving a real id is what proves we are on the right page.
 */
export const GUIDE_VIEWS = [
  { id: "dashboard-overview", asset: "dashboard-overview.png", path: "/dashboard" },
  { id: "contacts-list", asset: "contacts-list.png", path: "/dashboard/contacts", heading: /Contacts/ },
  { id: "contact-detail", asset: "contact-detail.png", needs: "contact", path: (id) => `/dashboard/contacts/${id}` },
  { id: "content-library", asset: "content-library.png", path: "/dashboard/content", heading: /Content/ },
  {
    id: "content-detail",
    asset: "content-detail.png",
    needs: "content",
    path: (id) => `/dashboard/content/${id}`,
    // The one route with no PageHeader. Its `h2` is conditional on `item.title`,
    // which most content rows lack, so the back link — always rendered — is what
    // actually proves the detail page mounted.
    ready: 'a[href="/dashboard/content"]',
  },
  {
    id: "compose-dialog",
    asset: "compose-dialog.png",
    path: "/dashboard/content",
    ready: '[role="dialog"]',
    // The dialog has no route of its own, so the only way to capture it is to
    // open it the way a user does.
    interact: async (page) => {
      await page.getByRole("button", { name: "Compose" }).first().click();
    },
  },
  { id: "goals-list", asset: "goals-list.png", path: "/dashboard/goals", heading: /Goals/ },
  { id: "goal-detail", asset: "goal-detail.png", needs: "goal", path: (id) => `/dashboard/goals/${id}` },
  { id: "automation-dashboard", asset: "automation-dashboard.png", path: "/dashboard/workflows", heading: /Automation/ },
  { id: "workflow-detail", asset: "workflow-detail.png", needs: "workflow", path: (id) => `/dashboard/workflows/${id}` },
  { id: "analytics-dashboard", asset: "analytics-dashboard.png", path: "/dashboard/analytics", heading: /Analytics/ },
  { id: "settings-page", asset: "settings-page.png", path: "/dashboard/settings", heading: /Settings/ },
  { id: "settings-platforms", asset: "settings-platforms.png", path: "/dashboard/settings?tab=platforms", heading: /Settings/ },
  { id: "settings-agents", asset: "settings-agents.png", path: "/dashboard/settings?tab=agents", heading: /Settings/ },
  { id: "help-page", asset: "help-page.png", path: "/dashboard/help", heading: /Help/ },
];

/**
 * `guide/assets/chat-panel.png` and `ai-assist-panel.png` are on disk, referenced
 * by no guide page, and correspond to no component in `src/`. They are stale
 * output from an earlier guide draft. Named here so the next reader does not
 * re-derive that, and so `verifyGuideAssetCoverage` can tell "orphan" apart from
 * "gap".
 */
export const KNOWN_ORPHAN_ASSETS = ["ai-assist-panel.png", "chat-panel.png"];

export const DEFAULT_EVIDENCE_DIR = ".evidence";
export const DEFAULT_GUIDE_ASSETS_DIR = join("guide", "assets");

export function viewPath(view, id = null) {
  return typeof view.path === "function" ? view.path(id) : view.path;
}

export function readySelector(view) {
  return view.ready ?? "h1";
}

/** `.evidence/after_<view>_<form>_<theme>.png` — the naming #320 established. */
export function evidenceFileName(viewId, formFactor, theme) {
  return `after_${viewId}_${formFactor}_${theme}.png`;
}

/**
 * The browser contexts to open, in order. Each pass states its own viewport,
 * theme and `fullPage` policy so the two artefacts cannot drift into each other.
 */
export function capturePasses({ evidence = true, guide = true } = {}) {
  const passes = [];
  if (evidence) {
    for (const theme of THEMES) {
      for (const formFactor of FORM_FACTORS) {
        passes.push({
          kind: "evidence",
          label: `${theme}/${formFactor.label}`,
          viewport: { width: formFactor.width, height: formFactor.height },
          colorScheme: theme,
          fullPage: true,
          fileFor: (view) => evidenceFileName(view.id, formFactor.label, theme),
        });
      }
    }
  }
  if (guide) {
    passes.push({
      kind: "guide",
      label: "guide",
      viewport: { ...GUIDE_VIEWPORT },
      colorScheme: GUIDE_THEME,
      fullPage: false,
      fileFor: (view) => view.asset,
    });
  }
  return passes;
}

/**
 * Which views to run, in manifest order. An unknown id is an error rather than an
 * empty run: `--only contacts-lst` should not exit 0 having captured nothing.
 */
export function selectViews(only, views = GUIDE_VIEWS) {
  if (!only || only.length === 0) return views;
  const known = new Set(views.map((view) => view.id));
  const unknown = only.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown view id(s): ${unknown.join(", ")}. Known ids: ${views.map((v) => v.id).join(", ")}`,
    );
  }
  const wanted = new Set(only);
  return views.filter((view) => wanted.has(view.id));
}

/** Which id kinds the selected views require, so we fetch each list at most once. */
export function requiredIdKinds(views) {
  return [...new Set(views.filter((view) => view.needs).map((view) => view.needs))];
}

/**
 * Compare the manifest against what `guide/` references and what is on disk, so a
 * newly added guide screenshot cannot quietly stay hand-captured.
 */
export function verifyGuideAssetCoverage({ referenced = [], onDisk = [], views = GUIDE_VIEWS }) {
  const covered = new Set(views.map((view) => view.asset));
  const orphans = new Set(KNOWN_ORPHAN_ASSETS);
  return {
    uncovered: referenced.filter((asset) => !covered.has(asset)),
    orphaned: onDisk.filter((asset) => !covered.has(asset) && !orphans.has(asset)),
    stale: [...covered].filter((asset) => onDisk.length > 0 && !onDisk.includes(asset)),
  };
}

/**
 * Resolve where to point the browser.
 *
 * `--base-url` exists because the guide can legitimately be captured against a
 * plain `npm run dev`, with no RealTimeX Dev app in the picture at all. That path
 * still gets health-checked through the same classifier, so "wrong app on this
 * port" reads identically however the origin was supplied.
 */
export async function resolveCaptureOrigin({
  baseUrl = null,
  fetchImpl = fetch,
  resolveTarget = resolveSignalsTarget,
} = {}) {
  if (!baseUrl) {
    const resolved = await resolveTarget({ fetchImpl });
    return { ...resolved, origin: resolved.origin ?? null, source: "dev-app" };
  }

  let origin;
  try {
    origin = new URL(baseUrl).origin;
  } catch {
    return {
      ok: false,
      code: "invalid_base_url",
      message: `--base-url is not a URL: ${baseUrl}`,
      origin: null,
      source: "base-url",
    };
  }

  let healthStatus = null;
  let healthApp = null;
  let healthState = null;
  try {
    const health = await fetchImpl(`${origin}/api/health`, { signal: AbortSignal.timeout(5_000) });
    healthStatus = health.status;
    if (health.ok) {
      const body = await health.json().catch(() => null);
      healthApp = body?.app ?? null;
      healthState = body?.status ?? null;
    }
  } catch {
    healthStatus = null;
  }

  // Reuse the Dev-app classifier: an explicitly supplied origin is by definition
  // reachable and loaded, so only the health verdicts can differ.
  const verdict = classifySignalsTarget({
    cdpReachable: true,
    target: { url: origin },
    documentHref: origin,
    healthStatus,
    healthApp,
    healthState,
  });
  return { ...verdict, origin, healthApp, source: "base-url" };
}

/** Fetch one id per required kind, or say precisely which seed data is missing. */
export async function resolveDetailIds({ origin, kinds, fetchImpl = fetch }) {
  const ids = {};
  const missing = [];
  for (const kind of kinds) {
    const source = ID_SOURCES[kind];
    if (!source) throw new Error(`No id source registered for "${kind}"`);
    let id = null;
    try {
      const response = await fetchImpl(`${origin}${source.path}`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (response.ok) id = source.pick(await response.json().catch(() => null));
    } catch {
      id = null;
    }
    if (id == null) missing.push(kind);
    else ids[kind] = id;
  }
  return { ids, missing };
}

export function parseArgs(argv = [], env = process.env) {
  const args = {
    only: [],
    baseUrl: env.SIGNALS_BASE_URL || null,
    evidence: true,
    guide: true,
    evidenceDir: DEFAULT_EVIDENCE_DIR,
    guideAssetsDir: DEFAULT_GUIDE_ASSETS_DIR,
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
      case "--no-evidence":
        args.evidence = false;
        break;
      case "--no-guide":
        args.guide = false;
        break;
      case "--only":
        args.only.push(
          ...readValue(index, rawArg)
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
        );
        if (!rawArg.includes("=")) index += 1;
        break;
      case "--base-url":
        args.baseUrl = readValue(index, rawArg);
        if (!rawArg.includes("=")) index += 1;
        break;
      case "--evidence-dir":
        args.evidenceDir = readValue(index, rawArg);
        if (!rawArg.includes("=")) index += 1;
        break;
      case "--guide-assets-dir":
        args.guideAssetsDir = readValue(index, rawArg);
        if (!rawArg.includes("=")) index += 1;
        break;
      default:
        throw new Error(`Unknown option: ${rawArg}`);
    }
  }

  if (!args.evidence && !args.guide) {
    throw new Error("--no-evidence and --no-guide together would capture nothing.");
  }
  return args;
}

export function createHelpText() {
  return [
    `Usage: node scripts/app-automation/flows/${CAPTURE_GUIDE_ASSETS_FLOW_NAME}.mjs [options]`,
    "",
    "Regenerate every screenshot the user guide references.",
    "",
    "Options:",
    "  --only <ids>             Comma-separated view ids. Default: all.",
    "  --base-url <url>         Capture against this origin instead of the Dev app's Local App.",
    "  --no-evidence            Skip the .evidence/ light+dark x desktop+mobile matrix.",
    "  --no-guide               Skip writing guide/assets/*.png.",
    "  --evidence-dir <dir>     Default: .evidence",
    "  --guide-assets-dir <dir> Default: guide/assets",
    "  --json                   Emit the result as JSON on stdout.",
    "  --quiet                  Suppress progress on stderr.",
    "  -h, --help               Show this help.",
    "",
    "Views:",
    ...GUIDE_VIEWS.map((view) => `  ${view.id.padEnd(22)} ${view.asset}`),
  ].join("\n");
}

/**
 * Capture one view into an already-configured page.
 *
 * Waiting on `networkidle` alone is not enough to prove the right page rendered:
 * a 404 settles into networkidle just as happily as the real route. The ready
 * selector, and the heading check where there is a stable heading, are what make
 * a wrong page a failure rather than a plausible-looking PNG.
 */
/**
 * Next.js dev builds render an issue-count badge into a `nextjs-portal` element.
 * It is real, it is useful, and it must not appear in a published guide asset —
 * the guide is routinely captured against a dev server because that is where the
 * seed data lives.
 */
export async function hideDevOverlay(page) {
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
}

export const DEFAULT_SETTLE_POLL_MS = 150;
export const DEFAULT_SETTLE_TIMEOUT_MS = 5_000;

/**
 * Wait until the rendered text stops changing.
 *
 * `networkidle` and the ready selector both pass while the UI is still moving.
 * The dashboard's stat cards animate their values with `requestAnimationFrame`
 * over 800ms (`src/components/animated-stat.tsx`), and a capture taken during
 * that ease-out publishes a number that was never real: the first run of this
 * flow against a 12-contact database produced a hero screenshot reading 11,
 * beside a funnel that correctly summed to 12.
 *
 * Comparing whole-document text rather than watching a specific element keeps
 * this honest about what it covers — any count-up, skeleton swap or late
 * hydration settles it, not just the component that exposed the problem.
 *
 * Text alone is not enough, though. Recharts animates its series in over ~1s by
 * interpolating SVG path geometry, which changes no text at all: the first
 * analytics capture published a Platform Mix pie frozen as a thin wedge, a
 * quarter drawn. The fingerprint therefore includes every `path`/`circle`
 * geometry attribute alongside the text.
 */
export async function waitForVisualSettle(
  page,
  { pollMs = DEFAULT_SETTLE_POLL_MS, timeoutMs = DEFAULT_SETTLE_TIMEOUT_MS, sleep = defaultSleep } = {},
) {
  const deadline = Date.now() + timeoutMs;
  let previous = null;
  while (Date.now() < deadline) {
    const current = await page.evaluate(fingerprintExpression);
    // Two identical reads a poll apart. One is not enough: an animation frame
    // can land between the read and the screenshot.
    if (previous !== null && current === previous) return { settled: true };
    previous = current;
    await sleep(pollMs);
  }
  // Not fatal. A page with a live clock never settles, and refusing to capture
  // it would be worse than capturing it.
  return { settled: false };
}

/**
 * Runs in the page. Text catches count-ups and late hydration; the SVG geometry
 * catches chart entrance animations, which change no text.
 */
export function fingerprintExpression() {
  const shapes = Array.from(document.querySelectorAll("svg path, svg circle"))
    .map((node) =>
      [
        node.getAttribute("d"),
        node.getAttribute("cx"),
        node.getAttribute("cy"),
        node.getAttribute("r"),
      ].join(","),
    )
    .join("|");
  return `${document.body.innerText}\u0000${shapes}`;
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function captureView({
  page,
  view,
  origin,
  id = null,
  screenshotPaths,
  fullPage = true,
  hideDevOverlay: hide = null,
  settle = null,
}) {
  const path = viewPath(view, id);
  const response = await page.goto(`${origin}${path}`, { waitUntil: "networkidle" });

  const status = response?.status?.() ?? null;
  if (status != null && status >= 400) {
    throw new Error(`${view.id}: ${path} returned HTTP ${status}`);
  }

  if (view.interact) await view.interact(page);

  await page.waitForSelector(readySelector(view), { state: "visible", timeout: 15_000 });

  // After the wait, so the style survives the navigation it would otherwise
  // have been attached before.
  if (hide) await hide(page);

  if (settle) await settle(page);

  if (view.heading) {
    const heading = (await page.locator(readySelector(view)).first().innerText()).trim();
    if (!view.heading.test(heading)) {
      throw new Error(
        `${view.id}: expected a heading matching ${view.heading} at ${path}, found "${heading}". ` +
          "Refusing to publish a screenshot of the wrong page.",
      );
    }
  }

  for (const screenshotPath of screenshotPaths) {
    await page.screenshot({ path: screenshotPath, fullPage });
  }
  return { view: view.id, path, screenshots: screenshotPaths };
}

export async function runCaptureGuideAssetsFlow(args, dependencies = {}) {
  const {
    chromium,
    fetchImpl = fetch,
    resolveTarget = resolveSignalsTarget,
    ensureDir = (dir) => mkdirSync(dir, { recursive: true }),
    log = () => {},
  } = dependencies;

  const views = selectViews(args.only);

  const target = await resolveCaptureOrigin({
    baseUrl: args.baseUrl,
    fetchImpl,
    resolveTarget,
  });
  if (!target.ok || !target.origin) {
    return {
      ok: false,
      flow: CAPTURE_GUIDE_ASSETS_FLOW_NAME,
      code: target.code,
      message: target.message,
      origin: target.origin ?? null,
    };
  }
  log(`origin: ${target.origin} (${target.source})`);

  const kinds = requiredIdKinds(views);
  const { ids, missing } = await resolveDetailIds({ origin: target.origin, kinds, fetchImpl });
  if (missing.length > 0) {
    // A detail route with no record renders a 404, which screenshots fine. Naming
    // the missing kind is the difference between "seed a contact" and an hour
    // spent wondering why contact-detail.png looks empty.
    return {
      ok: false,
      flow: CAPTURE_GUIDE_ASSETS_FLOW_NAME,
      code: "missing_seed_data",
      message:
        `Signals has no ${missing.join(", ")} record, so the matching detail view has nothing to show. ` +
        `Seed one, or narrow the run with --only.`,
      origin: target.origin,
      missing,
    };
  }

  if (args.evidence) ensureDir(args.evidenceDir);
  if (args.guide) ensureDir(args.guideAssetsDir);

  const browser = await chromium.launch();
  const captures = [];
  const failures = [];
  try {
    for (const pass of capturePasses({ evidence: args.evidence, guide: args.guide })) {
      const outDir = pass.kind === "guide" ? args.guideAssetsDir : args.evidenceDir;
      const context = await browser.newContext({
        viewport: pass.viewport,
        colorScheme: pass.colorScheme,
      });
      const page = await context.newPage();
      try {
        for (const view of views) {
          const screenshotPath = join(outDir, pass.fileFor(view));
          log(`${pass.label}: ${view.id}`);
          try {
            captures.push(
              await captureView({
                page,
                view,
                origin: target.origin,
                id: view.needs ? ids[view.needs] : null,
                screenshotPaths: [screenshotPath],
                fullPage: pass.fullPage,
                hideDevOverlay,
                settle: waitForVisualSettle,
              }),
            );
          } catch (error) {
            // Keep going: one broken route should still leave the other
            // fourteen assets refreshed, with the failure named in the result.
            failures.push({ view: view.id, pass: pass.label, error: error.message });
          }
        }
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }

  return {
    ok: failures.length === 0,
    flow: CAPTURE_GUIDE_ASSETS_FLOW_NAME,
    code: failures.length === 0 ? "captured" : "partial",
    origin: target.origin,
    views: views.map((view) => view.id),
    captured: captures.length,
    guideAssetsDir: args.guide ? args.guideAssetsDir : null,
    evidenceDir: args.evidence ? args.evidenceDir : null,
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
    result = await runCaptureGuideAssetsFlow(args, {
      chromium,
      log: args.quiet ? () => {} : (line) => process.stderr.write(`${line}\n`),
    });
  } catch (error) {
    // A bad --only, or a browser that would not launch. Both are operator errors
    // with a useful message; a raw stack trace buries it.
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
    return;
  }

  if (args.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) {
    if (result.message) process.stderr.write(`\n${result.message}\n`);
    for (const failure of result.failures ?? []) {
      process.stderr.write(`${failure.view} (${failure.theme}/${failure.formFactor}): ${failure.error}\n`);
    }
    process.exitCode = 1;
  }
}

// Guarded so `node --test`, which imports this file from the test subprocess,
// never triggers a real browser launch.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv.slice(2));
}
