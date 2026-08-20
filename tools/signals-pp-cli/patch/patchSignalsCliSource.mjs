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
