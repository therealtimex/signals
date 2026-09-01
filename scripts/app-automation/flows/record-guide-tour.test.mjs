import assert from "node:assert/strict";
import test from "node:test";
import {
  CAPTION_ELEMENT_ID,
  DEFAULT_DWELL_MS,
  GUIDE_JOURNEYS,
  RECORD_GUIDE_TOUR_FLOW_NAME,
  STEP_ACTIONS,
  captionStyles,
  createHelpText,
  journeyById,
  parseArgs,
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
            contexts.push({ options, page });
            return { newPage: async () => page, close: async () => {} };
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
  assert.deepEqual(moved, [["/tmp/raw-video.webm", "guide/video/product-tour.webm"]]);
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
