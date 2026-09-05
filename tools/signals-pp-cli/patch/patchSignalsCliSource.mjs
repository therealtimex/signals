import fs from "node:fs";
import path from "node:path";

const CLI_NAME = "signals-pp-cli";
const OLD_MODULE = "signals-pp-cli-pp-cli";
const NEW_MODULE = "signals-pp-cli";

export function replaceInFile(filePath, pattern, replacement) {
  if (!fs.existsSync(filePath)) return false;
  const contents = fs.readFileSync(filePath, "utf8");
  if (!pattern.test(contents)) return false;
  pattern.lastIndex = 0;
  const next = contents.replace(pattern, replacement);
  if (next !== contents) fs.writeFileSync(filePath, next);
  return true;
}

function requireReplace(filePath, pattern, replacement, label) {
  if (!replaceInFile(filePath, pattern, replacement)) {
    throw new Error(
      `patchSignalsCliSource: ${label} did not match Printing Press output in ${filePath}`
    );
  }
}

/**
 * Append generated-source helpers. Printing Press regenerates the tree on every build, so an
 * appended function has to be re-appended each time rather than committed into `source/`.
 */
function appendToFile(filePath, contents, label) {
  const current = fs.readFileSync(filePath, "utf8");
  if (current.includes(contents.trim().split("\n")[0])) {
    throw new Error(`patchSignalsCliSource: ${label} appears to be applied already in ${filePath}`);
  }
  fs.writeFileSync(filePath, `${current.replace(/\s*$/, "")}\n${contents}`);
}

export function replaceAllInTree(rootDir, replacer) {
  if (!fs.existsSync(rootDir)) return;
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      replaceAllInTree(fullPath, replacer);
      continue;
    }
    if (!entry.name.endsWith(".go") && !entry.name.endsWith(".mod")) continue;
    const contents = fs.readFileSync(fullPath, "utf8");
    const next = replacer(contents, fullPath);
    if (next !== contents) fs.writeFileSync(fullPath, next);
  }
}

/**
 * Patch Printing Press output for Signals artifact distribution (#174).
 */
export function patchSignalsCliSource(sourceDir, version) {
  replaceAllInTree(sourceDir, (contents) =>
    contents
      .replaceAll(OLD_MODULE, NEW_MODULE)
      .replaceAll("signals-pp-cli-pp-cli", CLI_NAME)
      .replaceAll("SIGNALS_PP_CLI_BEARER_AUTH", "SIGNALS_AGENT_TOOL_TOKEN")
      .replaceAll("env:SIGNALS_PP_CLI_BEARER_AUTH", "env:SIGNALS_AGENT_TOOL_TOKEN")
      .replaceAll("SignalsPpCliBearerAuth", "SignalsAgentToolToken")
      .replaceAll("pp_cli_bearer_auth", "agent_tool_token")
  );

  const versionPatched = [
    path.join(sourceDir, "internal", "cli", "version.go"),
    path.join(sourceDir, "internal", "cli", "root.go"),
  ].some((filePath) =>
    replaceInFile(filePath, /var version = ".*?"/, `var version = "${version}"`)
  );
  if (!versionPatched) {
    throw new Error("Generated CLI version variable not found.");
  }

  replaceInFile(
    path.join(sourceDir, "internal", "client", "client.go"),
    /(req\.Header\.Set\("User-Agent",\s*)"[^"]+"/,
    `$1"${CLI_NAME}/${version}"`
  );

  const configPath = path.join(sourceDir, "internal", "config", "config.go");
  requireReplace(
    configPath,
    /if v := os\.Getenv\("SIGNALS_PP_CLI_BASE_URL"\); v != "" \{\n\t\tcfg\.BaseURL = v\n\t\}/,
    `if v := os.Getenv("SIGNALS_BASE_URL"); v != "" {\n\t\tcfg.BaseURL = v\n\t\tcfg.AuthSource = "env:SIGNALS_BASE_URL"\n\t} else if v := os.Getenv("SIGNALS_PP_CLI_BASE_URL"); v != "" {\n\t\tcfg.BaseURL = v\n\t}`,
    "SIGNALS_BASE_URL env override"
  );
  // Without a base URL the generated CLI falls back to a hardcoded 127.0.0.1:3000 and fails,
  // so every caller has had to export SIGNALS_BASE_URL by hand (#447). RealTimeX hosts the Local
  // App and knows where it is; resolve it instead of making the caller say.
  requireReplace(
    configPath,
    /\tif v := os\.Getenv\("SIGNALS_BASE_URL"\); v != "" \{\n\t\tcfg\.BaseURL = v\n\t\tcfg\.AuthSource = "env:SIGNALS_BASE_URL"\n\t\} else if v := os\.Getenv\("SIGNALS_PP_CLI_BASE_URL"\); v != "" \{\n\t\tcfg\.BaseURL = v\n\t\}/,
    `\tif v := os.Getenv("SIGNALS_BASE_URL"); v != "" {\n\t\tcfg.BaseURL = v\n\t\tcfg.AuthSource = "env:SIGNALS_BASE_URL"\n\t} else if v := os.Getenv("SIGNALS_PP_CLI_BASE_URL"); v != "" {\n\t\tcfg.BaseURL = v\n\t} else if resolved := resolveSignalsBaseURL(); resolved != "" {\n\t\tcfg.BaseURL = resolved\n\t\tcfg.AuthSource = "resolved:" + resolved\n\t}`,
    "Signals Local App base URL resolution"
  );

  requireReplace(
    configPath,
    /import \(\n\t"fmt"\n\t"os"\n/,
    `import (\n\t"encoding/json"\n\t"fmt"\n\t"io"\n\t"net/http"\n\t"os"\n`,
    "base URL resolution imports"
  );

  appendToFile(
    configPath,
    `

// signalsHealthProbeTimeout bounds each candidate so an unreachable port cannot stall a command.
const signalsHealthProbeTimeout = 2 * time.Second

// resolveSignalsBaseURL locates the Signals Local App when no base URL was supplied (#447).
//
// It probes rather than reading the Local App registry, because a single RealtimeX install can
// hold many Signals records — a live one plus stopped QA instances, several configured on the same
// port. The registry answers "which Signals apps exist", not "which one is answering now", and a
// Local App's own credential cannot enumerate its peers regardless.
//
// RTX_PORT and PORT come first: a process launched by the Local App runtime already knows its port.
func resolveSignalsBaseURL() string {
	candidates := make([]string, 0, 6)
	for _, key := range []string{"RTX_PORT", "PORT"} {
		if port := strings.TrimSpace(os.Getenv(key)); port != "" {
			candidates = append(candidates, "http://localhost:"+port)
		}
	}
	candidates = append(candidates,
		"http://localhost:3010",
		"http://localhost:3000",
		"http://127.0.0.1:3010",
		"http://127.0.0.1:3000",
	)

	client := &http.Client{Timeout: signalsHealthProbeTimeout}
	seen := make(map[string]bool, len(candidates))
	for _, base := range candidates {
		base = strings.TrimSuffix(base, "/")
		if seen[base] {
			continue
		}
		seen[base] = true
		if isSignalsHealthy(client, base) {
			return base
		}
	}
	return ""
}

// isSignalsHealthy accepts a candidate only when it identifies itself as Signals. Matching on a
// reachable port alone would hand the CLI whatever else happens to be listening on 3000.
func isSignalsHealthy(client *http.Client, base string) bool {
	resp, err := client.Get(base + "/api/health")
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return false
	}
	var payload struct {
		App string \`json:"app"\`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 64<<10)).Decode(&payload); err != nil {
		return false
	}
	return payload.App == "signals"
}
`,
    "Signals base URL resolution helpers"
  );

  requireReplace(
    configPath,
    /if v := os\.Getenv\("SIGNALS_AGENT_TOOL_TOKEN"\); v != "" \{\n\t\tcfg\.SignalsAgentToolToken = v\n\t\tcfg\.AuthSource = "env:SIGNALS_AGENT_TOOL_TOKEN"\n\t\}/,
    `if v := os.Getenv("SIGNALS_AGENT_TOOL_TOKEN"); v != "" {\n\t\tcfg.SignalsAgentToolToken = v\n\t\tcfg.AuthSource = "env:SIGNALS_AGENT_TOOL_TOKEN"\n\t} else if v := os.Getenv("SIGNALS_PP_CLI_BEARER_AUTH"); v != "" {\n\t\tcfg.SignalsAgentToolToken = v\n\t\tcfg.AuthSource = "env:SIGNALS_PP_CLI_BEARER_AUTH"\n\t}`,
    "SIGNALS_AGENT_TOOL_TOKEN env override"
  );

  const rootPath = path.join(sourceDir, "internal", "cli", "root.go");
  requireReplace(
    rootPath,
    /rootCmd\.AddCommand\(newImportCmd\(flags\)\)\n/,
    `rootCmd.AddCommand(newSignalsImportCmd(flags))\n\trootCmd.AddCommand(newReconcileCmd(flags))\n\trootCmd.AddCommand(newTargetsCmd(flags))\n`,
    "transcendence import/reconcile registration"
  );

  const mainPath = path.join(sourceDir, "cmd", `${CLI_NAME}-pp-cli`, "main.go");
  if (fs.existsSync(mainPath)) {
    const mainDir = path.dirname(mainPath);
    const newMainDir = path.join(sourceDir, "cmd", CLI_NAME);
    if (!fs.existsSync(newMainDir)) {
      fs.renameSync(mainDir, newMainDir);
    }
  }
}
