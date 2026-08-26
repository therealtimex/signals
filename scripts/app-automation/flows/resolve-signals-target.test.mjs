import assert from "node:assert/strict";
import test from "node:test";
import {
  classifySignalsTarget,
  isLoadedDocument,
  originOf,
} from "./resolve-signals-target.mjs";

const TARGET = {
  url: "http://localhost:3010/dashboard/workflows",
  webSocketDebuggerUrl: "ws://127.0.0.1:9888/devtools/page/abc",
};

test("reports the Dev app being down before anything else", () => {
  const verdict = classifySignalsTarget({ cdpReachable: false });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.code, "dev_app_unreachable");
  assert.match(verdict.message, /yarn dev:all/);
});

test("distinguishes 'not open' from 'stopped'", () => {
  const notOpen = classifySignalsTarget({ cdpReachable: true, target: null });
  assert.equal(notOpen.code, "signals_not_open");

  // The expensive case: the target still advertises the right URL after the
  // Local App stops, so matching on target.url alone would look like success.
  const stopped = classifySignalsTarget({
    cdpReachable: true,
    target: TARGET,
    documentHref: "chrome-error://chromewebdata/",
  });
  assert.equal(stopped.code, "local_app_stopped");
  assert.match(stopped.message, /did not load/);
  assert.match(stopped.message, /Do not assert against this target/);
});

test("treats about:blank as not loaded", () => {
  const verdict = classifySignalsTarget({
    cdpReachable: true,
    target: TARGET,
    documentHref: "about:blank",
  });
  assert.equal(verdict.code, "local_app_stopped");
});

test("flags a loaded page whose server is not answering", () => {
  const verdict = classifySignalsTarget({
    cdpReachable: true,
    target: TARGET,
    documentHref: "http://localhost:3010/dashboard/workflows",
    healthStatus: 503,
  });
  assert.equal(verdict.code, "server_unhealthy");

  const noResponse = classifySignalsTarget({
    cdpReachable: true,
    target: TARGET,
    documentHref: "http://localhost:3010/dashboard/workflows",
    healthStatus: null,
  });
  assert.equal(noResponse.code, "server_unhealthy");
});

test("a 200 from something that is not Signals is not ready", () => {
  // Local App ports get reassigned, so 200 only proves *something* is listening.
  const verdict = classifySignalsTarget({
    cdpReachable: true,
    target: TARGET,
    documentHref: "http://localhost:3010/dashboard/workflows",
    healthStatus: 200,
    healthApp: "some-other-app",
    healthState: "ok",
  });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.code, "not_signals");

});

test("a degraded Signals is unhealthy, not a wrong-port problem", () => {
  // Reporting not_signals here would send the operator to re-resolve the port
  // when the right app is answering and simply unwell.
  const verdict = classifySignalsTarget({
    cdpReachable: true,
    target: TARGET,
    documentHref: "http://localhost:3010/dashboard/workflows",
    healthStatus: 200,
    healthApp: "signals",
    healthState: "degraded",
  });
  assert.equal(verdict.code, "server_unhealthy");
  assert.match(verdict.message, /unhealthy/);
  assert.doesNotMatch(verdict.message, /re-resolve/);
});

test("only reports ready when Signals itself confirms it is ok", () => {
  const verdict = classifySignalsTarget({
    cdpReachable: true,
    target: TARGET,
    documentHref: "http://localhost:3010/dashboard/workflows",
    healthStatus: 200,
    healthApp: "signals",
    healthState: "ok",
  });
  assert.equal(verdict.ok, true);
  assert.equal(verdict.code, "ready");
});

test("isLoadedDocument rejects error and blank documents", () => {
  assert.equal(isLoadedDocument("http://localhost:3010/dashboard"), true);
  assert.equal(isLoadedDocument("chrome-error://chromewebdata/"), false);
  assert.equal(isLoadedDocument("about:blank"), false);
  assert.equal(isLoadedDocument(""), false);
  assert.equal(isLoadedDocument(null), false);
});

test("originOf survives a malformed target url", () => {
  assert.equal(originOf("http://localhost:3010/dashboard"), "http://localhost:3010");
  assert.equal(originOf("not a url"), null);
});
