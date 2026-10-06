#!/usr/bin/env node
/**
 * Tests for .claude/skills/realtimex-signals/scripts/resolve-base-url.sh (#541, ADR-541-11).
 *
 * Drives the real script with bash against fake /api/health servers on ephemeral loopback ports.
 * Nothing here reaches a real Signals port: every run replaces the fixed fallback port list with
 * SIGNALS_RESOLVER_TEST_FALLBACK_PORTS, and `curl` on PATH is a recording shim. The shim forwards
 * to the real curl only for runs that opt in, so the default-port case (3010, never 3000) makes no
 * network request at all, and every other case asserts exactly which URLs were probed. The sibling
 * helpers are driven the same way to show they inherit the rule and stop when the resolver does.
 */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const skillScripts = join(root, ".claude/skills/realtimex-signals/scripts");
const resolver = join(skillScripts, "resolve-base-url.sh");
const RUN_TIMEOUT_MS = 20_000;

// /api/health from the deployed canonical (0.2.20), captured from the live app: no `instance`.
const legacyCanonical = {
  status: "ok",
  app: "signals",
  cliPackage: "@realtimex/signals-pp-cli",
  cliVersion: "0.2.20",
  rtx: {
    mode: "embedded",
    appId: "47e45f71-3279-42f5-8e95-731de01b6eae",
    registered: true,
    pingOk: true,
    manifest: "signals",
  },
};
const withInstance = (kind) => ({
  ...legacyCanonical,
  cliVersion: "0.2.22",
  rtx: { ...legacyCanonical.rtx, appId: `app-${kind}` },
  instance: {
    kind,
    externalEffects: kind === "dev" ? "denied" : "allowed",
    scheduler: kind === "dev" ? "disabled" : "enabled",
    dataDir: kind === "dev" ? "/Users/someone/.signals-dev/slot-a" : "/Users/someone/.signals",
  },
});
const devApp = withInstance("dev");
const canonicalWithInstance = withInstance("canonical");
const unknownKind = withInstance("preview");
const standalone = { ...legacyCanonical, rtx: { ...legacyCanonical.rtx, mode: "standalone", appId: null } };
const notSignals = { status: "ok", app: "something-else", rtx: { mode: "embedded" } };

const workDir = mkdtempSync(join(tmpdir(), "signals-skill-resolver-"));
const servers = [];

const realCurl = execFileSync("/bin/sh", ["-c", "command -v curl"], { encoding: "utf8" }).trim();
assert.ok(realCurl, "curl must be installed to run the resolver");

// Records every URL the resolver hands to curl; forwards to the real curl only when the run sets
// RESOLVER_TEST_REAL_CURL, otherwise answers like a refused connection.
const curlShimDir = join(workDir, "curl-shim");
writeExecutable(
  join(curlShimDir, "curl"),
  `#!/bin/sh
for arg in "$@"; do
  case "$arg" in
    http://*|https://*) printf '%s\\n' "$arg" >> "$RESOLVER_TEST_CURL_LOG" ;;
  esac
done
if [ -n "$RESOLVER_TEST_REAL_CURL" ]; then
  exec "$RESOLVER_TEST_REAL_CURL" "$@"
fi
exit 7
`
);
// A `node` that cannot run, like the RealTimeX shim when its managed runtime is not configured.
const brokenNodeDir = join(workDir, "broken-node");
writeExecutable(join(brokenNodeDir, "node"), "#!/bin/sh\nexit 127\n");

function writeExecutable(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  chmodSync(path, 0o755);
}

async function fakeHealth(body) {
  const requests = [];
  const server = createServer((req, res) => {
    requests.push(`${req.method} ${req.url}`);
    if (req.url !== "/api/health") {
      res.writeHead(200, { "content-type": "application/json" }).end('{"success":true}');
      return;
    }
    res.writeHead(200, { "content-type": typeof body === "string" ? "text/html" : "application/json" });
    res.end(typeof body === "string" ? body : JSON.stringify(body));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  servers.push(server);
  return { port: server.address().port, requests };
}

// A port nothing listens on: bind, read the port, close.
async function closedPort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

let runCount = 0;
async function runScript(script, args, env, { realCurl: forward = true, node = "real" } = {}) {
  runCount += 1;
  const curlLog = join(workDir, `curl-${runCount}.log`);
  writeFileSync(curlLog, "");
  const pathDirs = [curlShimDir, node === "broken" ? brokenNodeDir : dirname(process.execPath), "/usr/bin", "/bin"];
  const child = spawn("bash", [script, ...args], {
    // Built from scratch: SIGNALS_BASE_URL, RTX_PORT, PORT and proxy variables from the terminal
    // that runs the test never reach the script.
    env: {
      PATH: pathDirs.join(delimiter),
      HOME: workDir,
      RESOLVER_TEST_CURL_LOG: curlLog,
      ...(forward ? { RESOLVER_TEST_REAL_CURL: realCurl } : {}),
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => (stdout += chunk));
  child.stderr.on("data", (chunk) => (stderr += chunk));
  const timer = setTimeout(() => child.kill("SIGKILL"), RUN_TIMEOUT_MS);
  const status = await new Promise((resolve) => child.on("close", (code) => resolve(code)));
  clearTimeout(timer);
  const probed = readFileSync(curlLog, "utf8").split("\n").filter(Boolean);
  return { status, stdout, stderr, probed };
}
const runResolver = (env, options) => runScript(resolver, [], env, options);

const health = (host, port) => `http://${host}:${port}/api/health`;

try {
  // (a) A Dev app on the fallback port and nothing else: exit 1, naming the URL and the override.
  {
    const dev = await fakeHealth(devApp);
    const result = await runResolver({ SIGNALS_RESOLVER_TEST_FALLBACK_PORTS: String(dev.port) });
    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.stdout, "", "nothing on stdout when no instance qualifies");
    assert.match(
      result.stderr,
      new RegExp(`Skipping http://localhost:${dev.port}: it is a Signals Dev app \\(instance\\.kind=dev\\)`)
    );
    assert.match(result.stderr, new RegExp(`set SIGNALS_BASE_URL=http://localhost:${dev.port}`));
    assert.match(result.stderr, /Could not find a running Signals instance/);
    assert.deepEqual(result.probed, [health("localhost", dev.port), health("127.0.0.1", dev.port)]);
    assert.ok(dev.requests.every((request) => request === "GET /api/health"), dev.requests.join(", "));
  }

  // (b) A Dev app on RTX_PORT and the legacy canonical (no `instance`) on the fallback: canonical.
  {
    const dev = await fakeHealth(devApp);
    const canonical = await fakeHealth(legacyCanonical);
    const result = await runResolver({
      RTX_PORT: String(dev.port),
      SIGNALS_RESOLVER_TEST_FALLBACK_PORTS: String(canonical.port),
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, `http://localhost:${canonical.port}\n`);
    assert.match(result.stderr, new RegExp(`Skipping http://localhost:${dev.port}: it is a Signals Dev app`));
    assert.deepEqual(result.probed, [
      health("localhost", dev.port),
      health("127.0.0.1", dev.port),
      health("localhost", canonical.port),
    ]);
  }

  // (b') Same, Dev app on PORT and canonical on RTX_PORT: RTX_PORT is probed first and wins.
  {
    const dev = await fakeHealth(devApp);
    const canonical = await fakeHealth(legacyCanonical);
    const unused = await closedPort();
    const result = await runResolver({
      RTX_PORT: String(canonical.port),
      PORT: String(dev.port),
      SIGNALS_RESOLVER_TEST_FALLBACK_PORTS: String(unused),
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, `http://localhost:${canonical.port}\n`);
    assert.equal(result.stderr, "");
    assert.deepEqual(result.probed, [health("localhost", canonical.port)]);
    assert.deepEqual(dev.requests, [], "candidates after the accepted one are not probed");
  }

  // (c) Embedded canonical reporting instance.kind=canonical: chosen, here via PORT after an
  // unreachable RTX_PORT and a non-Signals body.
  {
    const other = await fakeHealth(notSignals);
    const canonical = await fakeHealth(canonicalWithInstance);
    const unreachable = await closedPort();
    const result = await runResolver({
      RTX_PORT: String(unreachable),
      PORT: String(other.port),
      SIGNALS_RESOLVER_TEST_FALLBACK_PORTS: `${canonical.port},${other.port}`,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, `http://localhost:${canonical.port}\n`);
    assert.equal(result.stderr, "", "unreachable and non-Signals candidates are skipped quietly");
    assert.deepEqual(result.probed, [
      health("localhost", unreachable),
      health("127.0.0.1", unreachable),
      health("localhost", other.port),
      health("127.0.0.1", other.port),
      health("localhost", canonical.port),
    ]);
  }

  // (d) Standalone Signals on the only candidate: rejected.
  {
    const solo = await fakeHealth(standalone);
    const result = await runResolver({ SIGNALS_RESOLVER_TEST_FALLBACK_PORTS: String(solo.port) });
    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.stdout, "");
    assert.match(
      result.stderr,
      new RegExp(`Skipping http://localhost:${solo.port}: Signals is not running as the embedded Local App \\(rtx\\.mode=standalone\\)`)
    );
  }

  // (e) Explicit SIGNALS_BASE_URL to a Dev app: chosen (the only way to reach a Dev app).
  {
    const dev = await fakeHealth(devApp);
    const result = await runResolver({
      SIGNALS_BASE_URL: `http://127.0.0.1:${dev.port}/`,
      SIGNALS_RESOLVER_TEST_FALLBACK_PORTS: String(await closedPort()),
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, `http://127.0.0.1:${dev.port}\n`, "trailing slash trimmed");
    assert.equal(result.stderr, "");
    assert.deepEqual(result.probed, [health("127.0.0.1", dev.port)], "explicit URL skips the probe");
  }

  // (e') Explicit SIGNALS_BASE_URL to a standalone Signals is accepted too.
  {
    const solo = await fakeHealth(standalone);
    const result = await runResolver({ SIGNALS_BASE_URL: `http://127.0.0.1:${solo.port}` });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, `http://127.0.0.1:${solo.port}\n`);
  }

  // (f) Explicit SIGNALS_BASE_URL to a non-Signals body, or to nothing: exit 1, no fallback probe.
  for (const body of [notSignals, "<html>not json</html>", null]) {
    const port = body === null ? await closedPort() : (await fakeHealth(body)).port;
    const canonical = await fakeHealth(legacyCanonical);
    const result = await runResolver({
      SIGNALS_BASE_URL: `http://127.0.0.1:${port}`,
      SIGNALS_RESOLVER_TEST_FALLBACK_PORTS: String(canonical.port),
    });
    assert.equal(result.status, 1, `explicit URL with body ${JSON.stringify(body)}`);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, new RegExp(`SIGNALS_BASE_URL is set but /api/health did not return app=signals: http://127.0.0.1:${port}`));
    assert.deepEqual(canonical.requests, [], "an explicit URL never falls back to probing");
  }

  // (g) 3000 is never probed. Default fallback list, no RTX_PORT/PORT, and a curl shim that makes
  // no connection: the script asks for 3010 on both loopback names and nothing else.
  {
    const result = await runResolver({}, { realCurl: false });
    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.stdout, "");
    assert.deepEqual(result.probed, [health("localhost", 3010), health("127.0.0.1", 3010)]);
    assert.ok(!result.probed.some((url) => /:3000\b/.test(url)), result.probed.join(", "));
    assert.match(result.stderr, /on ports: 3010\./);
  }

  // (g') Invalid and duplicate ports are dropped before probing.
  {
    const result = await runResolver(
      {
        RTX_PORT: "3010",
        PORT: "http://evil:1",
        SIGNALS_RESOLVER_TEST_FALLBACK_PORTS: "3010, 4321 ,abc",
      },
      { realCurl: false }
    );
    assert.equal(result.status, 1);
    assert.deepEqual(result.probed, [
      health("localhost", 3010),
      health("127.0.0.1", 3010),
      health("localhost", 4321),
      health("127.0.0.1", 4321),
    ]);
  }

  // (h) An `instance` with a kind other than dev/canonical is not trusted as canonical, and a
  // non-JSON body is skipped; the canonical behind them is still found.
  {
    const odd = await fakeHealth(unknownKind);
    const html = await fakeHealth("<html>signals</html>");
    const canonical = await fakeHealth(legacyCanonical);
    const result = await runResolver({
      RTX_PORT: String(odd.port),
      PORT: String(html.port),
      SIGNALS_RESOLVER_TEST_FALLBACK_PORTS: String(canonical.port),
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, `http://localhost:${canonical.port}\n`);
    assert.match(result.stderr, new RegExp(`Skipping http://localhost:${odd.port}: /api/health reports an instance kind other than canonical`));
  }

  // (i) Without a working node the fallback cannot tell a Dev app from the canonical one, so it
  // accepts nothing; an explicit SIGNALS_BASE_URL still works on the text match.
  {
    const canonical = await fakeHealth(legacyCanonical);
    const fallback = await runResolver(
      { SIGNALS_RESOLVER_TEST_FALLBACK_PORTS: String(canonical.port) },
      { node: "broken" }
    );
    assert.equal(fallback.status, 1, fallback.stderr);
    assert.equal(fallback.stdout, "");
    assert.match(fallback.stderr, /cannot read \/api\/health without node/);

    const explicit = await runResolver(
      { SIGNALS_BASE_URL: `http://127.0.0.1:${canonical.port}` },
      { node: "broken" }
    );
    assert.equal(explicit.status, 0, explicit.stderr);
    assert.equal(explicit.stdout, `http://127.0.0.1:${canonical.port}\n`);

    const other = await fakeHealth(notSignals);
    const explicitOther = await runResolver(
      { SIGNALS_BASE_URL: `http://127.0.0.1:${other.port}` },
      { node: "broken" }
    );
    assert.equal(explicitOther.status, 1, "text match still requires app=signals");
  }

  // (j) The sibling helpers inherit the rule: with a Dev app on RTX_PORT and the canonical on the
  // fallback, their calls land on the canonical and the Dev app only ever sees the health probe.
  {
    const dev = await fakeHealth(devApp);
    const canonical = await fakeHealth(legacyCanonical);
    const env = { RTX_PORT: String(dev.port), SIGNALS_RESOLVER_TEST_FALLBACK_PORTS: String(canonical.port) };
    const invoke = await runScript(join(skillScripts, "invoke-tool.sh"), ["query_contacts", "{}"], env);
    assert.equal(invoke.status, 0, invoke.stderr);
    const list = await runScript(join(skillScripts, "list-tools.sh"), [], env);
    assert.equal(list.status, 0, list.stderr);
    assert.ok(canonical.requests.includes("POST /api/agent-tools/invoke"), canonical.requests.join(", "));
    assert.ok(canonical.requests.includes("GET /api/agent-tools"), canonical.requests.join(", "));
    assert.ok(dev.requests.every((request) => request === "GET /api/health"), dev.requests.join(", "));
  }

  // (k) When the resolver finds nothing, no helper calls anything but /api/health. invoke-tool.sh
  // used to `export` the resolver's output, which hid its failure from `set -e` and let the repo
  // helper fall back to its own default URL. The curl shim makes no connection here.
  {
    const unused = await closedPort();
    const helpers = [
      ["invoke-tool.sh", ["query_contacts", "{}"]],
      ["list-tools.sh", []],
      ["run-signals-pp-cli.sh", ["health"]],
      ["upload-avatar.sh", ["contact-1", join(workDir, "missing.png")]],
    ];
    for (const [helper, args] of helpers) {
      const result = await runScript(
        join(skillScripts, helper),
        args,
        { SIGNALS_RESOLVER_TEST_FALLBACK_PORTS: String(unused) },
        { realCurl: false }
      );
      assert.notEqual(result.status, 0, `${helper} must stop when the resolver fails`);
      assert.match(result.stderr, /Could not find a running Signals instance/, helper);
      assert.deepEqual(
        result.probed.filter((url) => !url.endsWith("/api/health")),
        [],
        `${helper} must not call Signals without a resolved URL`
      );
    }
  }

  // The shipped default list is 3010 alone.
  assert.match(readFileSync(resolver, "utf8"), /^DEFAULT_FALLBACK_PORTS="3010"$/m);

  console.log(`signals skill resolver: OK (${runCount} runs)`);
} finally {
  await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
  rmSync(workDir, { recursive: true, force: true });
}
