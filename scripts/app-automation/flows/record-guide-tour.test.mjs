import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import {
  CAPTION_ELEMENT_ID,
  DEFAULT_DWELL_MS,
  GUIDE_JOURNEYS,
  DEFAULT_VIDEO_DIR,
  RECORD_GUIDE_TOUR_FLOW_NAME,
  STEP_ACTIONS,
  captionStyles,
  createHelpText,
  journeyById,
  parseArgs,
  smoothScrollToBottom,
  recordJourney,
  requiredIdKindsForJourneys,
  runRecordGuideTourFlow,
  selectJourneys,
  stepPath,
  videoFileName,
  warmRoutes,
} from "./record-guide-tour.mjs";
import { ID_SOURCES } from "./capture-guide-assets.mjs";

const ORIGIN = "http://127.0.0.1:3010";

test("journey ids are unique and every journey has steps", () => {
  assert.equal(new Set(GUIDE_JOURNEYS.map((j) => j.id)).size, GUIDE_JOURNEYS.length);
  for (const journey of GUIDE_JOURNEYS) {
    assert.ok(journey.steps.length > 0, `${journey.id} has no steps`);
    assert.ok(journey.title, `${journey.id} has no title`);
  }
});

test("every step has a caption, so no silent stretch of video", () => {
  for (const journey of GUIDE_JOURNEYS) {
    for (const [index, step] of journey.steps.entries()) {
      assert.ok(step.caption, `${journey.id} step ${index} has no caption`);
    }
  }
});

test("every step action named in a journey is registered", () => {
  for (const journey of GUIDE_JOURNEYS) {
    for (const step of journey.steps.filter((s) => s.act)) {
      assert.ok(STEP_ACTIONS[step.act], `unregistered action: ${step.act}`);
    }
  }
});

test("every detail step names an id source that exists", () => {
  for (const journey of GUIDE_JOURNEYS) {
    for (const step of journey.steps.filter((s) => s.needs)) {
      assert.ok(ID_SOURCES[step.needs], `${journey.id} needs unregistered kind ${step.needs}`);
      assert.equal(typeof step.path, "function", "a detail step must build its path from an id");
    }
  }
});

test("stepPath interpolates ids and passes through literals", () => {
  assert.equal(stepPath({ path: "/dashboard" }), "/dashboard");
  assert.equal(stepPath({ path: (ids) => `/c/${ids.contact}` }, { contact: "c1" }), "/c/c1");
});

test("an unknown journey is an error, not an empty run", () => {
  // `--only produkt-tour` must not exit 0 having recorded nothing.
  assert.throws(() => journeyById("nope"), /Unknown journey/);
  assert.throws(() => selectJourneys(["nope"]), /Unknown journey/);
  assert.equal(selectJourneys([]).length, GUIDE_JOURNEYS.length);
  assert.deepEqual(selectJourneys(["product-tour"]).map((j) => j.id), ["product-tour"]);
});

test("requiredIdKindsForJourneys dedupes across steps and journeys", () => {
  // contact-deep-dive needs a contact twice; it must be fetched once.
  assert.deepEqual(requiredIdKindsForJourneys(selectJourneys(["contact-deep-dive"])), ["contact"]);
  assert.deepEqual(requiredIdKindsForJourneys([{ steps: [{}, {}] }]), []);
});

test("parseArgs reads both --opt value and --opt=value", () => {
  const spaced = parseArgs(["--only", "product-tour", "--dwell-ms", "1200"], {});
  assert.deepEqual(spaced.only, ["product-tour"]);
  assert.equal(spaced.dwellMs, 1200);
  const equals = parseArgs(["--only=product-tour", "--dwell-ms=1200"], {});
  assert.deepEqual(equals.only, ["product-tour"]);
  assert.equal(equals.dwellMs, 1200);
  assert.equal(parseArgs([], {}).dwellMs, DEFAULT_DWELL_MS);
});

test("parseArgs rejects a nonsense dwell rather than recording a still", () => {
  assert.throws(() => parseArgs(["--dwell-ms", "soon"], {}), /must be a number/);
  assert.throws(() => parseArgs(["--dwell-ms", "-5"], {}), /must be a number/);
  assert.throws(() => parseArgs(["--nope"], {}), /Unknown option/);
});

test("help lists every journey", () => {
  const help = createHelpText();
  for (const journey of GUIDE_JOURNEYS) assert.match(help, new RegExp(journey.id));
});

test("videos are named for their journey, not Playwright's internal id", () => {
  assert.equal(videoFileName("product-tour"), "product-tour.webm");
});

test("the caption is pointer-transparent and above everything", () => {
  // It sits over the UI while steps click through it; if it swallowed clicks the
  // compose step would fail, and a low z-index would put it under a dialog.
  const css = captionStyles();
  assert.match(css, /pointer-events:none/);
  assert.match(css, /z-index:2147483647/);
  assert.match(css, new RegExp(CAPTION_ELEMENT_ID));
});

function stubPage() {
  const gotos = [];
  return {
    gotos,
    async goto(url) {
      gotos.push(url);
      return { status: () => 200 };
    },
    async waitForSelector() {},
    async evaluate() {
      return "settled";
    },
    async addStyleTag() {},
    getByRole: () => ({ first: () => ({ click: async () => {} }) }),
    video: () => ({ path: async () => "/tmp/raw-video.webm" }),
  };
}

function stubChromium() {
  const contexts = [];
  return {
    contexts,
    chromium: {
      async launch() {
        return {
          async newContext(options) {
            const page = stubPage();
            const record = { options, page, closed: 0 };
            contexts.push(record);
            return {
              newPage: async () => page,
              close: async () => {
                record.closed += 1;
              },
            };
          },
          close: async () => {},
        };
      },
    },
  };
}

function stubFetch(routes) {
  return async (url) => {
    const path = String(url).slice(ORIGIN.length);
    const entry = routes[path];
    if (!entry) throw new Error(`unstubbed ${url}`);
    return { ok: true, status: 200, json: async () => entry };
  };
}

const READY = { ok: true, code: "ready", origin: ORIGIN, source: "base-url" };

test("the flow refuses before launching a browser when the app is not ready", async () => {
  const result = await runRecordGuideTourFlow(parseArgs([], {}), {
    chromium: { launch: () => assert.fail("must not launch a browser") },
    fetchImpl: async () => {
      throw new Error("down");
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "dev_app_unreachable");
});

test("the flow names missing seed data instead of filming empty pages", async () => {
  const result = await runRecordGuideTourFlow(
    parseArgs(["--only", "contact-deep-dive", "--base-url", ORIGIN], {}),
    {
      chromium: { launch: () => assert.fail("must not launch a browser") },
      fetchImpl: stubFetch({
        "/api/health": { app: "signals", status: "ok" },
        "/api/contacts?pageSize=25": { data: [], total: 0 },
      }),
    },
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, "missing_seed_data");
  assert.deepEqual(result.missing, ["contact"]);
  assert.match(result.message, /seed:demo/);
});

test("routes are warmed in a throwaway context before the take", async () => {
  // Warming inside the recording context would put seconds of skeletons in the
  // video — the thing warming exists to remove.
  const { chromium, contexts } = stubChromium();
  const moved = [];
  const result = await runRecordGuideTourFlow(
    parseArgs(["--only", "product-tour", "--base-url", ORIGIN, "--dwell-ms", "0"], {}),
    {
      chromium,
      fetchImpl: stubFetch({
        "/api/health": { app: "signals", status: "ok" },
        "/api/contacts?pageSize=25": { data: [{ id: "c1", enrichmentScore: 98 }], total: 1 },
      }),
      ensureDir: () => {},
      move: (from, to) => moved.push([from, to]),
      sleep: async () => {},
    },
  );

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(contexts.length, 2, "one warmup context, one recording context");
  assert.equal(contexts[0].options.recordVideo, undefined, "warmup must not record");
  assert.ok(contexts[1].options.recordVideo, "the take must record");
  assert.deepEqual(contexts[1].options.recordVideo.size, { width: 1440, height: 900 });
  // Built the way the flow builds it: a literal would fail on Windows, where
  // join() yields a backslash, even though the flow is correct.
  assert.deepEqual(moved, [
    ["/tmp/raw-video.webm", join(DEFAULT_VIDEO_DIR, videoFileName("product-tour"))],
  ]);
});

test("warmRoutes visits each path once and survives a route that fails", async () => {
  const page = stubPage();
  const browser = {
    async newContext() {
      return { newPage: async () => page, close: async () => {} };
    },
  };
  page.goto = async (url) => {
    if (url.endsWith("/boom")) throw new Error("compile error");
    page.gotos.push(url);
  };
  await warmRoutes({ browser, origin: ORIGIN, paths: ["/a", "/boom", "/b"] });
  assert.deepEqual(page.gotos, [`${ORIGIN}/a`, `${ORIGIN}/b`]);
});

test("the flow reports its own name", () => {
  assert.equal(RECORD_GUIDE_TOUR_FLOW_NAME, "record-guide-tour");
});

/** Runs the function smoothScrollToBottom hands to page.evaluate, against a fake DOM. */
async function runScrollIn(dom) {
  let captured;
  const page = { evaluate: async (fn, arg) => { captured = [fn, arg]; return undefined; } };
  await smoothScrollToBottom(page, { steps: 4, pauseMs: 0 });
  const previous = globalThis.document;
  globalThis.document = dom;
  try {
    return await captured[0](captured[1]);
  } finally {
    globalThis.document = previous;
  }
}

function scrollNode(scrollHeight, clientHeight) {
  return { scrollHeight, clientHeight, scrollTop: 0 };
}

test("scrolling drives the overflow-auto main, not the unmoving document", async () => {
  // src/app/dashboard/layout.tsx renders <main class="flex-1 overflow-auto">, so
  // the document itself never scrolls on any dashboard route.
  const main = scrollNode(3000, 900);
  const root = scrollNode(900, 900);
  const moved = await runScrollIn({
    querySelectorAll: () => [main],
    scrollingElement: root,
    documentElement: root,
  });
  assert.equal(moved, true);
  assert.equal(main.scrollTop, 2100, "main should have been scrolled to its bottom");
  assert.equal(root.scrollTop, 0, "the document should not have been touched");
});

test("scrolling still falls back to the document when that is what scrolls", async () => {
  const root = scrollNode(2000, 900);
  const moved = await runScrollIn({
    querySelectorAll: () => [],
    scrollingElement: root,
    documentElement: root,
  });
  assert.equal(moved, true);
  assert.equal(root.scrollTop, 1100);
});

test("scrolling reports false when nothing can move", async () => {
  const root = scrollNode(900, 900);
  const moved = await runScrollIn({
    querySelectorAll: () => [scrollNode(900, 900)],
    scrollingElement: root,
    documentElement: root,
  });
  assert.equal(moved, false);
});

test("a scroll step that cannot scroll fails rather than filming a still frame", async () => {
  const page = stubPage();
  // The settle check returns a fingerprint; only the scroll call returns false.
  page.evaluate = async (fn) => (String(fn).includes("scrollTop") ? false : "settled");
  const journey = {
    id: "j",
    title: "t",
    steps: [{ path: "/dashboard/analytics", caption: "c", scroll: true }],
  };
  await assert.rejects(
    () => recordJourney({
      context: { close: async () => {} },
      page,
      journey,
      origin: ORIGIN,
      ids: {},
      dwellMs: 0,
      sleep: async () => {},
    }),
    /nothing to scroll/,
  );
});

test("a route that 404s fails the journey instead of recording the error page", async () => {
  const page = stubPage();
  page.goto = async () => ({ status: () => 404 });
  const journey = { id: "j", title: "t", steps: [{ path: "/dashboard/gone", caption: "c" }] };
  await assert.rejects(
    () => recordJourney({
      context: { close: async () => {} },
      page,
      journey,
      origin: ORIGIN,
      ids: {},
      dwellMs: 0,
      sleep: async () => {},
    }),
    /returned HTTP 404/,
  );
});

test("a 500 fails too, since the generic h1 check passes on an error page", async () => {
  const page = stubPage();
  page.goto = async () => ({ status: () => 500 });
  const journey = { id: "j", title: "t", steps: [{ path: "/dashboard", caption: "c" }] };
  await assert.rejects(
    () => recordJourney({
      context: { close: async () => {} },
      page,
      journey,
      origin: ORIGIN,
      ids: {},
      dwellMs: 0,
      sleep: async () => {},
    }),
    /returned HTTP 500/,
  );
});

test("a journey that fails still closes its context and discards the take", async () => {
  // A step guard throwing used to skip recordJourney's only close(), so the
  // next journey ran with a recorder still attached to the dead one.
  const { chromium, contexts } = stubChromium();
  const discarded = [];
  const moved = [];
  const launch = chromium.launch;
  chromium.launch = async () => {
    const browser = await launch();
    const newContext = browser.newContext;
    browser.newContext = async (options) => {
      const context = await newContext.call(browser, options);
      // contexts[0] is the warmup; contexts[1] is the first journey's take.
      if (contexts.length === 2) contexts[1].page.goto = async () => ({ status: () => 500 });
      return context;
    };
    return browser;
  };

  const result = await runRecordGuideTourFlow(
    parseArgs(["--base-url", ORIGIN, "--dwell-ms", "0"], {}),
    {
      chromium,
      fetchImpl: stubFetch({
        "/api/health": { app: "signals", status: "ok" },
        "/api/contacts?pageSize=25": { data: [{ id: "c1", enrichmentScore: 98 }], total: 1 },
      }),
      ensureDir: () => {},
      move: (from, to) => moved.push([from, to]),
      discardRaw: (file) => discarded.push(file),
      sleep: async () => {},
    },
  );

  assert.equal(result.ok, false);
  assert.equal(result.failures.length, 1);
  assert.match(result.failures[0].error, /HTTP 500/);
  // Every context opened was closed exactly once, including the failed one.
  for (const [index, context] of contexts.entries()) {
    assert.equal(context.closed, 1, `context ${index} closed ${context.closed} times`);
  }
  // The abandoned take is deleted rather than left for convert-guide-video to
  // publish under a Playwright id.
  assert.deepEqual(discarded, ["/tmp/raw-video.webm"]);
  // The surviving journey still produced its video.
  assert.equal(moved.length, 1);
});

test("a failed promotion is a partial result, not an aborted run", async () => {
  // move() sat outside the per-journey catch, so a rename failure escaped the
  // loop and skipped every remaining tour instead of failing just this one.
  const { chromium } = stubChromium();
  const discarded = [];
  let attempts = 0;
  const result = await runRecordGuideTourFlow(
    parseArgs(["--base-url", ORIGIN, "--dwell-ms", "0"], {}),
    {
      chromium,
      fetchImpl: stubFetch({
        "/api/health": { app: "signals", status: "ok" },
        "/api/contacts?pageSize=25": { data: [{ id: "c1", enrichmentScore: 98 }], total: 1 },
      }),
      ensureDir: () => {},
      move: () => {
        if (++attempts === 1) throw new Error("EXDEV: cross-device link not permitted");
      },
      discardRaw: (file) => discarded.push(file),
      sleep: async () => {},
    },
  );

  assert.equal(result.ok, false);
  assert.equal(result.code, "partial");
  assert.match(result.failures[0].error, /EXDEV/);
  // The second journey still ran and still succeeded.
  assert.equal(result.recorded.length, GUIDE_JOURNEYS.length - 1);
  assert.equal(attempts, GUIDE_JOURNEYS.length, "every journey attempted promotion");
  // The take that could not be promoted was cleaned up.
  assert.deepEqual(discarded, ["/tmp/raw-video.webm"]);
});

test("a context that fails to open does not abort the remaining tours", async () => {
  const { chromium } = stubChromium();
  const launch = chromium.launch;
  let opened = 0;
  chromium.launch = async () => {
    const browser = await launch();
    const newContext = browser.newContext;
    browser.newContext = async (options) => {
      // Index 0 is the warmup; fail the first journey's recording context.
      if (++opened === 2) throw new Error("Target page, context or browser has been closed");
      return newContext.call(browser, options);
    };
    return browser;
  };

  const result = await runRecordGuideTourFlow(
    parseArgs(["--base-url", ORIGIN, "--dwell-ms", "0"], {}),
    {
      chromium,
      fetchImpl: stubFetch({
        "/api/health": { app: "signals", status: "ok" },
        "/api/contacts?pageSize=25": { data: [{ id: "c1", enrichmentScore: 98 }], total: 1 },
      }),
      ensureDir: () => {},
      move: () => {},
      discardRaw: () => {},
      sleep: async () => {},
    },
  );

  assert.equal(result.code, "partial");
  assert.equal(result.failures.length, 1);
  assert.equal(result.recorded.length, GUIDE_JOURNEYS.length - 1);
});

test("every journey has a committed mp4, and guide/video holds nothing else", async () => {
  // The mp4 ships now, so it can drift exactly the way the hand-captured
  // screenshots did: add a journey and forget to record it, or rename one and
  // leave the old file behind, and nothing fails.
  const { readdir } = await import("node:fs/promises");
  const videoDir = new URL("../../../guide/video/", import.meta.url).pathname;
  const onDisk = (await readdir(videoDir)).filter((name) => name.endsWith(".mp4")).sort();
  const expected = GUIDE_JOURNEYS.map((journey) => `${journey.id}.mp4`).sort();

  assert.deepEqual(
    onDisk.filter((name) => !expected.includes(name)),
    [],
    "guide/video has an mp4 that no journey produces — a renamed or removed journey",
  );
  assert.deepEqual(
    expected.filter((name) => !onDisk.includes(name)),
    [],
    "a journey has no committed mp4 — run automation:record-guide-tour then automation:convert-guide-video",
  );
});
