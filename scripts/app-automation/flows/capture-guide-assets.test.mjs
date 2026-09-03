import assert from "node:assert/strict";
import test from "node:test";
import {
  CAPTURE_GUIDE_ASSETS_FLOW_NAME,
  GUIDE_VIEWS,
  ID_SOURCES,
  KNOWN_ORPHAN_ASSETS,
  captureView,
  createHelpText,
  capturePasses,
  evidenceFileName,
  parseArgs,
  readySelector,
  requiredIdKinds,
  resolveCaptureOrigin,
  resolveDetailIds,
  runCaptureGuideAssetsFlow,
  selectViews,
  fingerprintExpression,
  verifyGuideAssetCoverage,
  viewPath,
  waitForVisualSettle,
} from "./capture-guide-assets.mjs";

const ORIGIN = "http://127.0.0.1:3010";

/** A fetch that answers from a path->response map and records what was asked. */
function stubFetch(routes) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    const path = String(url).slice(ORIGIN.length);
    const entry = routes[path];
    if (!entry) throw new Error(`unstubbed ${url}`);
    return {
      ok: (entry.status ?? 200) < 400,
      status: entry.status ?? 200,
      json: async () => entry.body,
    };
  };
  return { fetchImpl, calls };
}

const HEALTHY = { "/api/health": { body: { app: "signals", status: "ok" } } };

test("the manifest covers every asset the guide references", () => {
  // The referenced list is asserted against the manifest rather than read from
  // disk so a new guide screenshot fails here instead of silently staying
  // hand-captured.
  const referenced = [
    "dashboard-overview.png", "contacts-list.png", "contact-detail.png",
    "content-library.png", "content-detail.png", "compose-dialog.png",
    "goals-list.png", "goal-detail.png", "automation-dashboard.png",
    "workflow-detail.png", "analytics-dashboard.png", "settings-platforms.png",
    "settings-agents.png", "help-page.png",
  ];
  const coverage = verifyGuideAssetCoverage({ referenced });
  assert.deepEqual(coverage.uncovered, []);
});

test("known orphans are excluded, unknown extra assets are reported", () => {
  const onDisk = [...GUIDE_VIEWS.map((view) => view.asset), ...KNOWN_ORPHAN_ASSETS, "surprise.png"];
  const coverage = verifyGuideAssetCoverage({ onDisk });
  assert.deepEqual(coverage.orphaned, ["surprise.png"]);
  assert.deepEqual(coverage.stale, []);
});

test("view ids and assets are unique", () => {
  assert.equal(new Set(GUIDE_VIEWS.map((v) => v.id)).size, GUIDE_VIEWS.length);
  assert.equal(new Set(GUIDE_VIEWS.map((v) => v.asset)).size, GUIDE_VIEWS.length);
});

test("every detail view names an id source that exists", () => {
  for (const view of GUIDE_VIEWS.filter((v) => v.needs)) {
    assert.ok(ID_SOURCES[view.needs], `${view.id} needs unregistered kind ${view.needs}`);
    assert.equal(typeof view.path, "function", `${view.id} must build its path from an id`);
  }
});

test("content-detail waits on its back link, not a conditional heading", () => {
  // The one route with no PageHeader. Its h2 is conditional on item.title, which
  // most content rows lack — waiting on it timed out against real data. If this
  // route ever gains an h1 the override should go, not be quietly left behind.
  assert.equal(
    readySelector(GUIDE_VIEWS.find((v) => v.id === "content-detail")),
    'a[href="/dashboard/content"]',
  );
  assert.equal(readySelector(GUIDE_VIEWS.find((v) => v.id === "contacts-list")), "h1");
});

test("the contact id source prefers the best-enriched row", () => {
  // The list is recency-ordered, so the first row captured a contact scoring
  // 31/100 whose detail page reads "This profile is still thin".
  const { pick } = ID_SOURCES.contact;
  assert.equal(
    pick({ data: [{ id: "thin", enrichmentScore: 31 }, { id: "rich", enrichmentScore: 98 }] }),
    "rich",
  );
  assert.equal(pick({ data: [{ id: "a" }, { id: "b" }] }), "a", "falls back to the first row");
  assert.equal(pick({ data: [] }), null);
  assert.equal(pick(null), null);
});

test("the content id source prefers a titled item but tolerates none", () => {
  const { pick } = ID_SOURCES.content;
  assert.equal(pick({ items: [{ id: "a" }, { id: "b", title: "Reply" }] }), "b");
  assert.equal(pick({ items: [{ id: "a" }, { id: "b" }] }), "a", "falls back to the first row");
  assert.equal(pick({ items: [] }), null);
  assert.equal(pick(null), null);
});

test("the nurture run id source matches the gate, not a template name", () => {
  // A user can rename the template; only the server stamps `approvalGate` on the
  // run config, so that is what identifies a gated nurture run.
  const { pick } = ID_SOURCES.nurtureRun;
  const gated = JSON.stringify({ approvalGate: { mode: "locked_explicit" } });
  assert.equal(
    pick({
      data: [
        { id: "plain", status: "completed", config: "{}" },
        { id: "gated", status: "completed", config: gated },
      ],
    }),
    "gated",
  );
  assert.equal(
    pick({
      data: [
        { id: "running", status: "running", config: gated },
        { id: "done", status: "completed", config: gated },
      ],
    }),
    "done",
    "a completed run reads as the finished journey",
  );
  assert.equal(
    pick({ data: [{ id: "only", status: "running", config: { approvalGate: {} } }] }),
    "only",
    "an already-parsed config still matches",
  );
  assert.equal(pick({ data: [{ id: "broken", config: "{not json" }] }), null);
  assert.equal(pick({ data: [] }), null);
  assert.equal(pick(null), null);
});

test("viewPath interpolates ids for detail routes", () => {
  const detail = GUIDE_VIEWS.find((v) => v.id === "goal-detail");
  assert.equal(viewPath(detail, "g1"), "/dashboard/goals/g1");
  assert.equal(viewPath(GUIDE_VIEWS.find((v) => v.id === "goals-list")), "/dashboard/goals");
});

test("evidence naming matches the convention #320 established", () => {
  assert.equal(evidenceFileName("settings-agents", "mobile", "dark"), "after_settings-agents_mobile_dark.png");
});

test("the guide pass is a 1440x900 viewport shot, not a full-page evidence cell", () => {
  // The committed guide assets are all 1440x900 viewport captures. Publishing
  // the desktop+light evidence cell instead produced 1280x3442 full-page images.
  const guide = capturePasses().find((pass) => pass.kind === "guide");
  assert.deepEqual(guide.viewport, { width: 1440, height: 900 });
  assert.equal(guide.colorScheme, "light");
  assert.equal(guide.fullPage, false);
  assert.equal(guide.fileFor(GUIDE_VIEWS[0]), GUIDE_VIEWS[0].asset);
});

test("evidence passes cover the matrix and stay full-page", () => {
  const evidence = capturePasses().filter((pass) => pass.kind === "evidence");
  assert.equal(evidence.length, 4);
  assert.ok(evidence.every((pass) => pass.fullPage));
  assert.deepEqual(
    evidence.map((pass) => pass.label),
    ["light/desktop", "light/mobile", "dark/desktop", "dark/mobile"],
  );
  assert.equal(
    evidence[0].fileFor({ id: "help-page" }),
    "after_help-page_desktop_light.png",
  );
});

test("capturePasses honours --no-evidence / --no-guide", () => {
  assert.deepEqual(capturePasses({ evidence: false }).map((p) => p.kind), ["guide"]);
  assert.equal(capturePasses({ guide: false }).length, 4);
});

test("selectViews rejects an unknown id instead of capturing nothing", () => {
  assert.equal(selectViews([]).length, GUIDE_VIEWS.length);
  assert.deepEqual(selectViews(["help-page"]).map((v) => v.id), ["help-page"]);
  // A typo that silently exits 0 is the failure this guards.
  assert.throws(() => selectViews(["contacts-lst"]), /Unknown view id/);
});

test("selectViews keeps manifest order regardless of --only order", () => {
  assert.deepEqual(
    selectViews(["help-page", "dashboard-overview"]).map((v) => v.id),
    ["dashboard-overview", "help-page"],
  );
});

test("requiredIdKinds dedupes and skips views that need nothing", () => {
  assert.deepEqual(requiredIdKinds(selectViews(["goals-list", "help-page"])), []);
  assert.deepEqual(requiredIdKinds(selectViews(["goal-detail", "contact-detail"])), ["contact", "goal"]);
});

test("parseArgs reads both --opt value and --opt=value", () => {
  const spaced = parseArgs(["--only", "help-page,goals-list", "--base-url", ORIGIN], {});
  assert.deepEqual(spaced.only, ["help-page", "goals-list"]);
  assert.equal(spaced.baseUrl, ORIGIN);

  const equals = parseArgs(["--only=help-page", `--base-url=${ORIGIN}`], {});
  assert.deepEqual(equals.only, ["help-page"]);
  assert.equal(equals.baseUrl, ORIGIN);
});

test("parseArgs honours SIGNALS_BASE_URL but lets the flag win", () => {
  assert.equal(parseArgs([], { SIGNALS_BASE_URL: ORIGIN }).baseUrl, ORIGIN);
  assert.equal(
    parseArgs(["--base-url", "http://localhost:3000"], { SIGNALS_BASE_URL: ORIGIN }).baseUrl,
    "http://localhost:3000",
  );
});

test("parseArgs refuses a run that would write nothing", () => {
  assert.throws(() => parseArgs(["--no-evidence", "--no-guide"], {}), /capture nothing/);
  assert.throws(() => parseArgs(["--nope"], {}), /Unknown option/);
});

test("help text lists every view", () => {
  const help = createHelpText();
  for (const view of GUIDE_VIEWS) assert.match(help, new RegExp(view.id));
});

test("resolveCaptureOrigin delegates to the Dev app when no base url is given", async () => {
  const resolved = await resolveCaptureOrigin({
    resolveTarget: async () => ({ ok: true, code: "ready", origin: ORIGIN }),
  });
  assert.equal(resolved.origin, ORIGIN);
  assert.equal(resolved.source, "dev-app");
});

test("a stopped Local App is refused, not screenshotted", async () => {
  const resolved = await resolveCaptureOrigin({
    resolveTarget: async () => ({ ok: false, code: "local_app_stopped", message: "stopped", origin: ORIGIN }),
  });
  assert.equal(resolved.ok, false);
  assert.equal(resolved.code, "local_app_stopped");
});

test("--base-url is health-checked through the same classifier", async () => {
  const { fetchImpl } = stubFetch(HEALTHY);
  const ok = await resolveCaptureOrigin({ baseUrl: `${ORIGIN}/dashboard`, fetchImpl });
  assert.equal(ok.ok, true);
  assert.equal(ok.origin, ORIGIN, "should normalise to the origin");
  assert.equal(ok.source, "base-url");
});

test("--base-url pointing at another app reports not_signals", async () => {
  // The port-drift case: something is listening and answers 200, but it is not
  // Signals. Hardcoding :3010 is how the old script could have captured it.
  const { fetchImpl } = stubFetch({ "/api/health": { body: { app: "realtimex", status: "ok" } } });
  const verdict = await resolveCaptureOrigin({ baseUrl: ORIGIN, fetchImpl });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.code, "not_signals");
});

test("--base-url that is not a URL fails before any network call", async () => {
  const verdict = await resolveCaptureOrigin({
    baseUrl: "not-a-url",
    fetchImpl: () => assert.fail("should not fetch"),
  });
  assert.equal(verdict.code, "invalid_base_url");
});

test("resolveDetailIds reads each endpoint's own envelope", async () => {
  // /api/content answers `items`; the others answer `data`. Getting this wrong
  // would look exactly like empty seed data.
  const { fetchImpl } = stubFetch({
    "/api/contacts?pageSize=25": { body: { data: [{ id: "c1", enrichmentScore: 90 }], total: 1 } },
    "/api/content?pageSize=25": { body: { items: [{ id: "n1" }], total: 1 } },
    "/api/goals?pageSize=1": { body: { data: [{ id: "g1" }], total: 1 } },
    "/api/workflows?pageSize=1": { body: { data: [{ id: "w1" }], total: 1 } },
  });
  const { ids, missing } = await resolveDetailIds({
    origin: ORIGIN,
    kinds: ["contact", "content", "goal", "workflow"],
    fetchImpl,
  });
  assert.deepEqual(missing, []);
  assert.deepEqual(ids, { contact: "c1", content: "n1", goal: "g1", workflow: "w1" });
});

test("resolveDetailIds names the empty kind rather than returning nothing", async () => {
  const { fetchImpl } = stubFetch({
    "/api/contacts?pageSize=25": { body: { data: [], total: 0 } },
    "/api/goals?pageSize=1": { body: { data: [{ id: "g1" }], total: 1 } },
  });
  const { ids, missing } = await resolveDetailIds({
    origin: ORIGIN,
    kinds: ["contact", "goal"],
    fetchImpl,
  });
  assert.deepEqual(missing, ["contact"]);
  assert.deepEqual(ids, { goal: "g1" });
});

test("resolveDetailIds treats a failed request as missing, not as a crash", async () => {
  const { ids, missing } = await resolveDetailIds({
    origin: ORIGIN,
    kinds: ["contact"],
    fetchImpl: async () => {
      throw new Error("ECONNREFUSED");
    },
  });
  assert.deepEqual(missing, ["contact"]);
  assert.deepEqual(ids, {});
});

/** Minimal Playwright stand-in: records navigation and screenshots. */
function stubPage({ status = 200, heading = "Contacts" } = {}) {
  const shots = [];
  const gotos = [];
  const fullPageFlags = [];
  return {
    shots,
    gotos,
    fullPageFlags,
    async goto(url) {
      gotos.push(url);
      return { status: () => status };
    },
    async waitForSelector() {},
    // Constant text, so waitForVisualSettle settles on its second read.
    async evaluate() {
      return "settled";
    },
    locator: () => ({ first: () => ({ innerText: async () => heading }) }),
    getByRole: () => ({ first: () => ({ click: async () => {} }) }),
    async addStyleTag() {},
    async screenshot({ path, fullPage }) {
      shots.push(path);
      fullPageFlags.push(fullPage);
    },
  };
}

test("captureView writes every requested path once the page is confirmed", async () => {
  const page = stubPage();
  const result = await captureView({
    page,
    view: GUIDE_VIEWS.find((v) => v.id === "contacts-list"),
    origin: ORIGIN,
    screenshotPaths: [".evidence/a.png", "guide/assets/b.png"],
  });
  assert.deepEqual(page.gotos, [`${ORIGIN}/dashboard/contacts`]);
  assert.deepEqual(page.shots, [".evidence/a.png", "guide/assets/b.png"]);
  assert.equal(result.view, "contacts-list");
});

test("captureView refuses a 404 instead of publishing a valid PNG of it", async () => {
  // A 404 settles into networkidle and screenshots cleanly. That is the whole
  // reason the status is checked.
  const page = stubPage({ status: 404 });
  await assert.rejects(
    captureView({
      page,
      view: GUIDE_VIEWS.find((v) => v.id === "contacts-list"),
      origin: ORIGIN,
      screenshotPaths: [".evidence/a.png"],
    }),
    /returned HTTP 404/,
  );
  assert.deepEqual(page.shots, [], "nothing should be written");
});

test("captureView refuses a page whose heading does not match the view", async () => {
  const page = stubPage({ heading: "Settings" });
  await assert.rejects(
    captureView({
      page,
      view: GUIDE_VIEWS.find((v) => v.id === "contacts-list"),
      origin: ORIGIN,
      screenshotPaths: [".evidence/a.png"],
    }),
    /Refusing to publish a screenshot of the wrong page/,
  );
  assert.deepEqual(page.shots, []);
});

test("captureView runs the interaction before waiting for the dialog", async () => {
  const order = [];
  const page = stubPage();
  page.getByRole = () => ({ first: () => ({ click: async () => order.push("click") }) });
  page.waitForSelector = async (selector) => order.push(`wait:${selector}`);
  await captureView({
    page,
    view: GUIDE_VIEWS.find((v) => v.id === "compose-dialog"),
    origin: ORIGIN,
    screenshotPaths: [".evidence/compose.png"],
  });
  assert.deepEqual(order, ["click", 'wait:[role="dialog"]']);
});

/** Playwright stand-in at the browser level, recording contexts opened. */
function stubChromium(pageFactory = () => stubPage()) {
  const contexts = [];
  return {
    contexts,
    chromium: {
      async launch() {
        return {
          async newContext(options) {
            const page = pageFactory();
            contexts.push({ options, page });
            return { newPage: async () => page, close: async () => {} };
          },
          close: async () => {},
        };
      },
    },
  };
}

test("the flow stops before launching a browser when the app is not ready", async () => {
  const result = await runCaptureGuideAssetsFlow(parseArgs([], {}), {
    chromium: { launch: () => assert.fail("must not launch a browser") },
    resolveTarget: async () => ({ ok: false, code: "signals_not_open", message: "not open" }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "signals_not_open");
});

test("the flow names missing seed data instead of capturing 404s", async () => {
  const { fetchImpl } = stubFetch({ "/api/goals?pageSize=1": { body: { data: [], total: 0 } } });
  const result = await runCaptureGuideAssetsFlow(parseArgs(["--only", "goal-detail"], {}), {
    chromium: { launch: () => assert.fail("must not launch a browser") },
    fetchImpl,
    resolveTarget: async () => ({ ok: true, code: "ready", origin: ORIGIN }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "missing_seed_data");
  assert.deepEqual(result.missing, ["goal"]);
  assert.match(result.message, /Seed one/);
});

test("a full run opens the four evidence cells plus a separate guide pass", async () => {
  const { chromium, contexts } = stubChromium(() => stubPage({ heading: "Help & Documentation" }));
  const dirs = [];
  const result = await runCaptureGuideAssetsFlow(parseArgs(["--only", "help-page"], {}), {
    chromium,
    resolveTarget: async () => ({ ok: true, code: "ready", origin: ORIGIN }),
    ensureDir: (dir) => dirs.push(dir),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(dirs, [".evidence", "guide/assets"]);
  assert.equal(contexts.length, 5, "4 evidence cells + 1 guide pass");
  assert.deepEqual(
    contexts.map((entry) => `${entry.options.colorScheme}/${entry.options.viewport.width}`),
    ["light/1280", "light/390", "dark/1280", "dark/390", "light/1440"],
  );

  const written = contexts.flatMap((entry) => entry.page.shots);
  assert.equal(
    written.filter((path) => path === "guide/assets/help-page.png").length,
    1,
    "the published asset must be written exactly once",
  );
  assert.equal(written.filter((path) => path.startsWith(".evidence")).length, 4);

  // Evidence is full-page; the published asset is a viewport shot.
  assert.deepEqual(contexts.at(-1).page.fullPageFlags, [false]);
  assert.deepEqual(contexts[0].page.fullPageFlags, [true]);
});

test("--no-evidence runs only the guide pass", async () => {
  const { chromium, contexts } = stubChromium(() => stubPage({ heading: "Help & Documentation" }));
  const result = await runCaptureGuideAssetsFlow(
    parseArgs(["--only", "help-page", "--no-evidence"], {}),
    { chromium, resolveTarget: async () => ({ ok: true, code: "ready", origin: ORIGIN }) },
  );
  assert.equal(result.ok, true);
  assert.equal(contexts.length, 1);
  assert.deepEqual(contexts[0].page.shots, ["guide/assets/help-page.png"]);
  assert.equal(contexts[0].options.viewport.width, 1440);
  assert.equal(result.evidenceDir, null);
});

test("the dev overlay is hidden before a screenshot is taken", async () => {
  // A Next.js issue badge in a published guide asset is a bug the guide would
  // ship. The style must land after navigation, not before.
  const order = [];
  const page = stubPage({ heading: "Help & Documentation" });
  page.addStyleTag = async ({ content }) => order.push(content);
  const original = page.screenshot.bind(page);
  page.screenshot = async (options) => {
    order.push("screenshot");
    return original(options);
  };
  await captureView({
    page,
    view: GUIDE_VIEWS.find((v) => v.id === "help-page"),
    origin: ORIGIN,
    screenshotPaths: ["guide/assets/help-page.png"],
    hideDevOverlay: (target) => target.addStyleTag({ content: "nextjs-portal{display:none!important}" }),
  });
  assert.deepEqual(order, ["nextjs-portal{display:none!important}", "screenshot"]);
});

test("one broken view is reported without abandoning the rest", async () => {
  // The point of partial success: a route that regressed should not cost the
  // other fourteen assets their refresh.
  const { chromium } = stubChromium(() => {
    const page = stubPage({ heading: "Help & Documentation" });
    const goto = page.goto.bind(page);
    page.goto = async (url) => {
      if (url.endsWith("/dashboard/goals")) return { status: () => 500 };
      return goto(url);
    };
    return page;
  });
  const result = await runCaptureGuideAssetsFlow(
    parseArgs(["--only", "goals-list,help-page", "--no-evidence"], {}),
    { chromium, resolveTarget: async () => ({ ok: true, code: "ready", origin: ORIGIN }) },
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, "partial");
  assert.equal(result.captured, 1);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].view, "goals-list");
  assert.equal(result.failures[0].pass, "guide");
  assert.match(result.failures[0].error, /HTTP 500/);
});

test("the flow reports its own name", () => {
  assert.equal(CAPTURE_GUIDE_ASSETS_FLOW_NAME, "capture-guide-assets");
});

/**
 * The checks above assert the manifest against a hand-written list. These two
 * assert it against the repository itself, so adding a screenshot to `guide/`
 * without adding it here fails rather than quietly reverting that asset to
 * hand-captured. Neither needs a browser or a running app, so both are safe to
 * gate on.
 */
test("every asset referenced by guide/ is in the manifest", async () => {
  const { readdir, readFile } = await import("node:fs/promises");
  const { join: joinPath } = await import("node:path");

  const guideDir = new URL("../../../guide/", import.meta.url).pathname;
  const docs = (await readdir(guideDir)).filter((name) => name.endsWith(".md"));
  const referenced = new Set();
  for (const doc of docs) {
    const body = await readFile(joinPath(guideDir, doc), "utf8");
    for (const match of body.matchAll(/\(assets\/([a-z0-9-]+\.png)\)/g)) referenced.add(match[1]);
  }

  assert.ok(referenced.size > 0, "expected guide/ to reference screenshots");
  const coverage = verifyGuideAssetCoverage({ referenced: [...referenced] });
  assert.deepEqual(
    coverage.uncovered,
    [],
    "guide/ references screenshots this flow cannot regenerate — add them to GUIDE_VIEWS",
  );
});

test("guide/assets holds nothing unaccounted for", async () => {
  const { readdir } = await import("node:fs/promises");
  const assetsDir = new URL("../../../guide/assets/", import.meta.url).pathname;
  const onDisk = (await readdir(assetsDir)).filter((name) => name.endsWith(".png"));

  const coverage = verifyGuideAssetCoverage({ onDisk });
  assert.deepEqual(
    coverage.orphaned,
    [],
    "guide/assets has PNGs that are neither in GUIDE_VIEWS nor listed in KNOWN_ORPHAN_ASSETS",
  );
  assert.deepEqual(coverage.stale, [], "GUIDE_VIEWS names an asset that is not on disk");
});


test("waitForVisualSettle waits for two identical reads", async () => {
  // The dashboard counts 0 -> 12 over 800ms. Stopping at the first repeat would
  // still catch a frame mid-count, so identical consecutive reads are required.
  const frames = ["7 contacts", "11 contacts", "12 contacts", "12 contacts"];
  let index = 0;
  const page = { evaluate: async () => frames[Math.min(index++, frames.length - 1)] };
  const slept = [];
  const result = await waitForVisualSettle(page, {
    pollMs: 10,
    sleep: async (ms) => slept.push(ms),
  });
  assert.deepEqual(result, { settled: true });
  assert.equal(index, 4, "should read until two reads match");
  assert.deepEqual(slept, [10, 10, 10]);
});

test("waitForVisualSettle gives up rather than blocking a live-clock page", async () => {
  // A page that never settles must still be captured; refusing would be worse.
  let now = 0;
  const page = { evaluate: async () => `tick ${(now += 1)}` };
  const result = await waitForVisualSettle(page, {
    pollMs: 1,
    timeoutMs: 5,
    sleep: async () => {},
  });
  assert.deepEqual(result, { settled: false });
});

test("captureView settles before it screenshots", async () => {
  const order = [];
  const page = stubPage({ heading: "Help & Documentation" });
  const original = page.screenshot.bind(page);
  page.screenshot = async (options) => {
    order.push("screenshot");
    return original(options);
  };
  await captureView({
    page,
    view: GUIDE_VIEWS.find((v) => v.id === "help-page"),
    origin: ORIGIN,
    screenshotPaths: ["guide/assets/help-page.png"],
    settle: async () => order.push("settle"),
  });
  assert.deepEqual(order, ["settle", "screenshot"]);
});


test("the fingerprint notices a chart animating with no text change", () => {
  // Recharts interpolates path geometry over ~1s while every string on the page
  // stays identical. Text-only comparison called that settled, and published a
  // pie chart a quarter drawn.
  const nodes = [];
  global.document = {
    body: { innerText: "Platform Mix" },
    querySelectorAll: () => nodes,
  };
  const node = (attrs) => ({ getAttribute: (name) => attrs[name] ?? null });

  nodes.push(node({ d: "M0,0 L10,0" }));
  const midAnimation = fingerprintExpression();

  nodes.length = 0;
  nodes.push(node({ d: "M0,0 L40,0" }));
  const settled = fingerprintExpression();

  assert.notEqual(midAnimation, settled, "geometry change must move the fingerprint");
  assert.match(settled, /Platform Mix/, "text is still part of the fingerprint");

  nodes.length = 0;
  nodes.push(node({ cx: "5", cy: "5", r: "3" }));
  assert.match(fingerprintExpression(), /5,5,3/, "circle geometry is included");

  delete global.document;
});
