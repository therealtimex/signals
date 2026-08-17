#!/usr/bin/env node
/**
 * validate-plugin.js
 *
 * Gate-checks a RealtimeX plugin directory before packaging (zip + install).
 * Runs 6 check passes and exits 0 (ready) or 1 (errors found).
 *
 * Usage: node validate-plugin.js <plugin-dir>
 *
 * Zero npm dependencies — pure Node.js built-ins only.
 */
"use strict";

const fs   = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

// ── ANSI helpers ──────────────────────────────────────────────────────────────
const RED    = (s) => `\x1b[31m${s}\x1b[0m`;
const YELLOW = (s) => `\x1b[33m${s}\x1b[0m`;
const GREEN  = (s) => `\x1b[32m${s}\x1b[0m`;
const BOLD   = (s) => `\x1b[1m${s}\x1b[0m`;
const DIM    = (s) => `\x1b[2m${s}\x1b[0m`;

// ── Result context ────────────────────────────────────────────────────────────
const errors   = [];  // { file, message }
const warnings = [];  // { file, message }
const suppressedFiles = new Set();  // abs paths excluded from further checks

function addError(file, message)   { errors.push({ file, message }); }
function addWarning(file, message) { warnings.push({ file, message }); }

function rel(absPath) {
  return path.relative(absPluginDir, absPath) || path.basename(absPath);
}

// ── Argument parsing ──────────────────────────────────────────────────────────
const pluginDirArg = process.argv[2];
if (!pluginDirArg) {
  console.error("Usage: node validate-plugin.js <plugin-dir>");
  process.exit(1);
}
const absPluginDir = path.resolve(pluginDirArg);
if (!fs.existsSync(absPluginDir) || !fs.statSync(absPluginDir).isDirectory()) {
  console.error(`Error: directory not found: ${absPluginDir}`);
  process.exit(1);
}

// ── Known hook names ──────────────────────────────────────────────────────────
const KNOWN_HOOKS = new Set([
  "onBeforeChat", "onAfterChat", "onMessageReceived", "onMessageSending",
  "onBeforeToolCall", "onAfterToolCall", "onBeforeEmbed",
  "onBeforeMessageDispatch", "onBeforeResponseRecord", "onChatTurnRecorded",
  "onTerminalPermissionRequest", "onAgentToolCall", "onDocumentAdd",
  "onTerminalSessionIdle",
  "onWorkspaceCreate", "onSessionStart", "onSessionEnd", "onStartup",
  "onShutdown", "onError",
]);

// ── Valid manifest enum values ────────────────────────────────────────────────
const VALID_ROUTE_METHODS  = new Set(["GET", "POST", "PUT", "DELETE", "PATCH"]);
const VALID_ROUTE_AUTH     = new Set(["internal", "plugin", "contribution"]);
const VALID_PROVIDER_TYPES = new Set(["llm", "embedding", "context_engine", "image_generation"]);
const VALID_CONFIG_TYPES   = new Set(["text", "password", "number", "boolean", "select", "multi-select", "tag-list", "file", "folder"]);

const VALID_CAPABILITY_KEYS = new Set([
  "hooks",
  "ui_panels",
  "ui_contributions",
  "api_routes",
  "providers",
  "flow_nodes",
  "services",
  "skills",
  "workspace_skills",
  "workspace_provisions",
]);
const DECLARATIVE_ONLY_CAPABILITIES = new Set([
  "skills",
  "workspace_skills",
  "workspace_provisions",
]);
const SKILL_NAME_REGEX = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GENERATED_WORKSPACE_DIRS = new Set([
  ".agents",
  ".claude",
  ".qwen",
  ".mcp2skill",
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getEditorOptions(field) {
  if (!isPlainObject(field)) return {};
  const editor = isPlainObject(field.editor) ? field.editor : {};
  const aiEditor = isPlainObject(field.aiEditor)
    ? field.aiEditor
    : isPlainObject(field.ai_editor)
      ? field.ai_editor
      : {};
  return { ...editor, ...aiEditor };
}

function getEditorMode(field) {
  if (!isPlainObject(field)) return "";
  if (typeof field.editor === "string") {
    return field.editor.trim().toLowerCase();
  }
  const options = getEditorOptions(field);
  if (options.mode || options.type) {
    return String(options.mode || options.type).trim().toLowerCase();
  }
  if (field.aiEditor || field.ai_editor) return "ai-editor";
  return "";
}

function normalizeWorkspaceRelativePath(value) {
  if (typeof value !== "string") return null;
  const normalized = path.posix.normalize(
    value.trim().replace(/\\/g, "/")
  );
  if (
    !normalized ||
    normalized.includes("\0") ||
    normalized.endsWith("/") ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:/.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

function getEditorTargetPath(field) {
  const options = getEditorOptions(field);
  return normalizeWorkspaceRelativePath(
    options.fileName || options.filename || options.path || ""
  );
}

function getEditorTargetCollisionKey(targetPath) {
  const normalized = normalizeWorkspaceRelativePath(targetPath);
  return normalized ? normalized.normalize("NFC").toLowerCase() : null;
}

function isSafeRelativePath(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  return !path.isAbsolute(value) && !value.includes("..");
}

function isWithin(parent, child) {
  const relative = path.relative(parent, child);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function validateStringList(value, label, manifestPath) {
  if (!Array.isArray(value)) {
    addError(manifestPath, `${label} must be an array`);
    return [];
  }
  const seen = new Set();
  const result = [];
  for (const item of value) {
    if (typeof item !== "string" || !SKILL_NAME_REGEX.test(item)) {
      addError(manifestPath, `${label} entries must be valid skill slugs`);
      continue;
    }
    if (seen.has(item)) {
      addError(manifestPath, `${label} contains duplicate entry '${item}'`);
      continue;
    }
    seen.add(item);
    result.push(item);
  }
  return result;
}

function validateProvisionSkills(
  entry,
  label,
  manifestPath,
  workspaceSkillKeys
) {
  if (!entry || entry.skills === undefined) return;
  const { skills } = entry;
  if (!isPlainObject(skills)) {
    addError(manifestPath, `${label} skills must be an object`);
    return;
  }

  for (const key of Object.keys(skills)) {
    if (!["workspace", "external"].includes(key)) {
      addError(
        manifestPath,
        `${label} skills contains unsupported field '${key}'`
      );
    }
  }

  if (skills.workspace !== undefined) {
    if (!isPlainObject(skills.workspace)) {
      addError(manifestPath, `${label} skills.workspace must be an object`);
    } else {
      for (const key of Object.keys(skills.workspace)) {
        if (key !== "include") {
          addError(
            manifestPath,
            `${label} skills.workspace contains unsupported field '${key}'`
          );
        }
      }
      if (skills.workspace.include === undefined) {
        addError(manifestPath, `${label} skills.workspace.include is required`);
      } else {
        const included = validateStringList(
          skills.workspace.include,
          `${label} skills.workspace.include`,
          manifestPath
        );
        for (const key of included) {
          if (!workspaceSkillKeys.has(key)) {
            addError(
              manifestPath,
              `${label} skills.workspace.include references unknown workspace skill '${key}'`
            );
          }
        }
      }
    }
  }

  if (skills.external !== undefined) {
    if (!isPlainObject(skills.external)) {
      addError(manifestPath, `${label} skills.external must be an object`);
    } else {
      for (const key of Object.keys(skills.external)) {
        if (!["lock", "allow", "onMissing"].includes(key)) {
          addError(
            manifestPath,
            `${label} skills.external contains unsupported field '${key}'`
          );
        }
      }
      if (typeof skills.external.lock !== "boolean") {
        addError(
          manifestPath,
          `${label} skills.external.lock must be a boolean`
        );
      }
      const allowed =
        skills.external.allow === undefined
          ? []
          : validateStringList(
              skills.external.allow,
              `${label} skills.external.allow`,
              manifestPath
            );
      if (allowed.length > 0 && skills.external.lock !== true) {
        addError(
          manifestPath,
          `${label} skills.external.allow requires lock=true`
        );
      }
      if (
        skills.external.onMissing !== undefined &&
        !["error", "warn", "ignore"].includes(skills.external.onMissing)
      ) {
        addError(
          manifestPath,
          `${label} skills.external.onMissing must be 'error', 'warn', or 'ignore'`
        );
      }
    }
  }
}

function validateWorkspaceSkillBundle(skill, manifestPath) {
  if (!isSafeRelativePath(skill.directory)) return;
  const bundleDir = path.resolve(absPluginDir, skill.directory);
  if (!isWithin(absPluginDir, bundleDir)) return;
  if (!fs.existsSync(bundleDir) || !fs.lstatSync(bundleDir).isDirectory()) {
    addError(
      manifestPath,
      `Workspace skill '${skill.key || "?"}' directory does not exist: '${skill.directory}'`
    );
    return;
  }
  const skillFile = path.join(bundleDir, "SKILL.md");
  if (!fs.existsSync(skillFile) || !fs.lstatSync(skillFile).isFile()) {
    addError(
      manifestPath,
      `Workspace skill '${skill.key || "?"}' directory must contain SKILL.md`
    );
  }

  const pending = [bundleDir];
  while (pending.length > 0) {
    const current = pending.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch (error) {
      addError(
        manifestPath,
        `Cannot read workspace skill '${skill.key || "?"}': ${error.message}`
      );
      continue;
    }
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      const stats = fs.lstatSync(entryPath);
      if (stats.isSymbolicLink()) {
        addError(
          manifestPath,
          `Workspace skill '${skill.key || "?"}' contains a symbolic link: '${path.relative(bundleDir, entryPath)}'`
        );
      } else if (stats.isDirectory()) {
        pending.push(entryPath);
      } else if (!stats.isFile()) {
        addError(
          manifestPath,
          `Workspace skill '${skill.key || "?"}' contains an unsupported filesystem entry: '${path.relative(bundleDir, entryPath)}'`
        );
      }
    }
  }
}

function validateWorkingDirectorySource(source, label, manifestPath) {
  if (!isSafeRelativePath(source)) {
    addError(
      manifestPath,
      `${label} workingDirectory.source must stay inside the plugin package`
    );
    return;
  }
  const sourceDir = path.resolve(absPluginDir, source);
  if (
    !isWithin(absPluginDir, sourceDir) ||
    !fs.existsSync(sourceDir) ||
    !fs.lstatSync(sourceDir).isDirectory()
  ) {
    addError(
      manifestPath,
      `${label} workingDirectory.source does not exist: '${source}'`
    );
    return;
  }

  const pending = [sourceDir];
  while (pending.length > 0) {
    const current = pending.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch (error) {
      addError(
        manifestPath,
        `Cannot read ${label} working-directory source: ${error.message}`
      );
      continue;
    }
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      const relativePath = path.relative(sourceDir, entryPath);
      if (GENERATED_WORKSPACE_DIRS.has(relativePath.split(path.sep)[0])) {
        continue;
      }
      const stats = fs.lstatSync(entryPath);
      if (stats.isDirectory()) {
        pending.push(entryPath);
        continue;
      }
      if (stats.isSymbolicLink()) {
        const linkTarget = fs.readlinkSync(entryPath);
        const resolvedTarget = path.resolve(
          path.dirname(entryPath),
          linkTarget
        );
        if (path.isAbsolute(linkTarget)) {
          addError(
            manifestPath,
            `${label} template symlink must be relative: '${relativePath}'`
          );
        } else if (!isWithin(sourceDir, resolvedTarget)) {
          addError(
            manifestPath,
            `${label} template symlink escapes its source directory: '${relativePath}'`
          );
        }
        continue;
      }
      if (!stats.isFile()) {
        addError(
          manifestPath,
          `${label} template contains an unsupported entry: '${relativePath}'`
        );
      }
    }
  }
}

function validateWorkspaceProvisioning(manifest, manifestPath) {
  const workspaceSkillKeys = new Set();
  const workspaceSkillNames = new Set();
  const workspaceSkills = manifest.capabilities?.workspace_skills;

  if (workspaceSkills !== undefined) {
    if (!Array.isArray(workspaceSkills)) {
      addError(
        manifestPath,
        "'capabilities.workspace_skills' must be an array"
      );
    } else {
      for (const skill of workspaceSkills) {
        if (!isPlainObject(skill)) {
          addError(
            manifestPath,
            "Each workspace skill entry must be an object"
          );
          continue;
        }
        if (!skill.key || !SKILL_NAME_REGEX.test(skill.key)) {
          addError(
            manifestPath,
            `Workspace skill key '${skill.key || "?"}' must be a valid skill slug`
          );
        } else if (workspaceSkillKeys.has(skill.key)) {
          addError(
            manifestPath,
            `Duplicate workspace skill key: '${skill.key}'`
          );
        } else {
          workspaceSkillKeys.add(skill.key);
        }
        if (!skill.name || !SKILL_NAME_REGEX.test(skill.name)) {
          addError(
            manifestPath,
            `Workspace skill name '${skill.name || "?"}' must be a valid skill slug`
          );
        } else if (workspaceSkillNames.has(skill.name)) {
          addError(
            manifestPath,
            `Duplicate workspace skill name: '${skill.name}'`
          );
        } else {
          workspaceSkillNames.add(skill.name);
        }
        if (!skill.displayName || typeof skill.displayName !== "string") {
          addError(
            manifestPath,
            `Workspace skill '${skill.key || "?"}' missing 'displayName'`
          );
        }
        if (!isSafeRelativePath(skill.directory)) {
          addError(
            manifestPath,
            `Workspace skill '${skill.key || "?"}' directory must stay inside the plugin package`
          );
        }
        if (
          skill.description !== undefined &&
          typeof skill.description !== "string"
        ) {
          addWarning(
            manifestPath,
            `Workspace skill '${skill.key || "?"}' description should be a string`
          );
        }
        validateWorkspaceSkillBundle(skill, manifestPath);
      }
    }
  }

  const provisionKeys = manifest.capabilities?.workspace_provisions;
  if (provisionKeys !== undefined) {
    if (!Array.isArray(provisionKeys)) {
      addError(
        manifestPath,
        "'capabilities.workspace_provisions' must be an array"
      );
    } else {
      const seenProvisionKeys = new Set();
      for (const key of provisionKeys) {
        if (typeof key !== "string" || !key) {
          addError(
            manifestPath,
            "Each workspace provision capability must be a string key"
          );
        } else if (seenProvisionKeys.has(key)) {
          addError(
            manifestPath,
            `Duplicate workspace provision capability: '${key}'`
          );
        } else {
          seenProvisionKeys.add(key);
        }
      }
    }
  }

  if (
    manifest.kind !== "workspace-provision" &&
    manifest.provisions?.workspaces === undefined &&
    manifest.provisions?.templates === undefined
  ) {
    return;
  }
  if (!isPlainObject(manifest.provisions)) {
    addError(
      manifestPath,
      "'provisions' must be an object for workspace-provision plugins"
    );
    return;
  }

  const workspaces = manifest.provisions.workspaces;
  const templates = manifest.provisions.templates;
  if (workspaces !== undefined && !Array.isArray(workspaces)) {
    addError(manifestPath, "'provisions.workspaces' must be an array");
  }
  if (templates !== undefined && !Array.isArray(templates)) {
    addError(manifestPath, "'provisions.templates' must be an array");
  }
  if (
    !(Array.isArray(workspaces) && workspaces.length) &&
    !(Array.isArray(templates) && templates.length)
  ) {
    addError(
      manifestPath,
      "'provisions' must declare at least one workspace or template"
    );
  }

  const seenWorkspaceKeys = new Set();
  const seenWorkspaceSlugs = new Set();
  for (const workspace of Array.isArray(workspaces) ? workspaces : []) {
    if (!isPlainObject(workspace)) {
      addError(
        manifestPath,
        "Each workspace provision entry must be an object"
      );
      continue;
    }
    const label = `Workspace provision '${workspace.key || "?"}'`;
    if (!workspace.key || typeof workspace.key !== "string") {
      addError(manifestPath, "Workspace provision missing 'key'");
    } else if (seenWorkspaceKeys.has(workspace.key)) {
      addError(
        manifestPath,
        `Duplicate workspace provision key: '${workspace.key}'`
      );
    } else {
      seenWorkspaceKeys.add(workspace.key);
    }
    if (!workspace.slug || typeof workspace.slug !== "string") {
      addError(manifestPath, `${label} missing 'slug'`);
    } else if (!UUID_REGEX.test(workspace.slug)) {
      addError(manifestPath, `${label} slug must be a UUID`);
    } else if (seenWorkspaceSlugs.has(workspace.slug.toLowerCase())) {
      addError(
        manifestPath,
        `Duplicate workspace provision slug: '${workspace.slug}'`
      );
    } else {
      seenWorkspaceSlugs.add(workspace.slug.toLowerCase());
    }
    if (!workspace.name || typeof workspace.name !== "string") {
      addError(manifestPath, `${label} missing 'name'`);
    }
    validateProvisionEntryCommon(
      workspace,
      label,
      manifestPath,
      workspaceSkillKeys,
      true
    );
  }

  const seenTemplateKeys = new Set();
  for (const template of Array.isArray(templates) ? templates : []) {
    if (!isPlainObject(template)) {
      addError(manifestPath, "Each workspace template entry must be an object");
      continue;
    }
    const label = `Workspace template '${template.key || "?"}'`;
    if (!template.key || typeof template.key !== "string") {
      addError(manifestPath, "Workspace template missing 'key'");
    } else if (seenTemplateKeys.has(template.key)) {
      addError(
        manifestPath,
        `Duplicate workspace template key: '${template.key}'`
      );
    } else {
      seenTemplateKeys.add(template.key);
    }
    if (!template.displayName || typeof template.displayName !== "string") {
      addError(manifestPath, `${label} missing 'displayName'`);
    }
    for (const field of ["defaultName", "description", "type"]) {
      if (
        template[field] !== undefined &&
        typeof template[field] !== "string"
      ) {
        addError(manifestPath, `${label} ${field} must be a string`);
      }
    }
    if (template.instanceConfigSchema !== undefined) {
      if (!Array.isArray(template.instanceConfigSchema)) {
        addError(
          manifestPath,
          `${label} instanceConfigSchema must be an array`
        );
      } else {
        const fieldKeys = new Set();
        const editorTargetFields = new Map();
        for (const field of template.instanceConfigSchema) {
          if (!isPlainObject(field)) {
            addError(
              manifestPath,
              `${label} instanceConfigSchema entries must be objects`
            );
            continue;
          }
          if (!field.key || typeof field.key !== "string") {
            addError(
              manifestPath,
              `${label} instanceConfigSchema field missing 'key'`
            );
          } else if (fieldKeys.has(field.key)) {
            addError(
              manifestPath,
              `${label} has duplicate instanceConfigSchema field '${field.key}'`
            );
          } else {
            fieldKeys.add(field.key);
          }
          const editorMode = getEditorMode(field);
          if (field.type !== "file" && editorMode) {
            addError(
              manifestPath,
              `${label} instance config field '${field.key || "?"}' cannot use an editor with type '${field.type || "?"}'`
            );
          }
          if (field.type === "file" && editorMode) {
            if (!["editor", "ai-editor"].includes(editorMode)) {
              addError(
                manifestPath,
                `${label} instance config field '${field.key || "?"}' has unsupported editor mode '${editorMode}'`
              );
            } else {
              const targetPath = getEditorTargetPath(field);
              if (!targetPath) {
                addError(
                  manifestPath,
                  `${label} instance config field '${field.key || "?"}' editor fileName must stay inside the workspace`
                );
              } else {
                const collisionKey =
                  getEditorTargetCollisionKey(targetPath);
                if (editorTargetFields.has(collisionKey)) {
                  addError(
                    manifestPath,
                    `${label} instance config fields '${editorTargetFields.get(collisionKey)}' and '${field.key || "?"}' use duplicate editor target '${targetPath}'`
                  );
                } else {
                  editorTargetFields.set(
                    collisionKey,
                    field.key || "?"
                  );
                }
              }
            }
          }
        }
      }
    }
    validateProvisionEntryCommon(
      template,
      label,
      manifestPath,
      workspaceSkillKeys,
      false
    );
  }
}

function validateProvisionEntryCommon(
  entry,
  label,
  manifestPath,
  workspaceSkillKeys,
  staticProvision
) {
  if (entry.settings !== undefined && !isPlainObject(entry.settings)) {
    addError(manifestPath, `${label} settings must be an object`);
  }
  if (staticProvision && entry.managedSettings !== undefined) {
    if (
      !Array.isArray(entry.managedSettings) ||
      entry.managedSettings.some((key) => typeof key !== "string")
    ) {
      addError(
        manifestPath,
        `${label} managedSettings must be an array of strings`
      );
    }
  }
  if (
    entry.workingDirectory !== undefined &&
    !isPlainObject(entry.workingDirectory)
  ) {
    addError(manifestPath, `${label} workingDirectory must be an object`);
  } else if (entry.workingDirectory) {
    const source = entry.workingDirectory.source;
    if (source !== undefined) {
      validateWorkingDirectorySource(source, label, manifestPath);
    }
    if (
      entry.workingDirectory.copyPolicy !== undefined &&
      entry.workingDirectory.copyPolicy !== "copy-missing"
    ) {
      addError(
        manifestPath,
        `${label} workingDirectory.copyPolicy must be 'copy-missing'`
      );
    }
    if (staticProvision && entry.workingDirectory.managedPaths !== undefined) {
      const managedPaths = entry.workingDirectory.managedPaths;
      if (!Array.isArray(managedPaths)) {
        addError(
          manifestPath,
          `${label} workingDirectory.managedPaths must be an array`
        );
      } else {
        for (const managedPath of managedPaths) {
          if (!isSafeRelativePath(managedPath)) {
            addError(
              manifestPath,
              `${label} workingDirectory.managedPaths entries must stay inside the workspace`
            );
          }
        }
      }
    }
  }
  validateProvisionSkills(entry, label, manifestPath, workspaceSkillKeys);
}

// ── Node.js built-in module allowlist (Node 20 LTS) ──────────────────────────
const NODE_BUILTINS = new Set([
  "assert", "async_hooks", "buffer", "child_process", "cluster", "console",
  "constants", "crypto", "dgram", "diagnostics_channel", "dns", "domain",
  "events", "fs", "fs/promises", "http", "http2", "https", "inspector",
  "module", "net", "os", "path", "path/posix", "path/win32", "perf_hooks",
  "process", "punycode", "querystring", "readline", "repl", "stream",
  "stream/consumers", "stream/promises", "stream/web", "string_decoder",
  "sys", "timers", "timers/promises", "tls", "trace_events", "tty",
  "url", "util", "util/types", "v8", "vm", "wasi", "worker_threads", "zlib",
]);

// ── Recursive .js file walker ─────────────────────────────────────────────────
// Silently skips node_modules/ and .git/ during traversal.
// Flags __tests__/ directories with a warning and excludes them.
function walkJs(dir) {
  const results = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    addError(dir, `Cannot read directory: ${e.message}`);
    return results;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      if (entry.name === "__tests__") {
        addWarning(fullPath, `Test directory '${rel(fullPath)}' should not be included in the plugin package`);
        continue;
      }
      results.push(...walkJs(fullPath));
    } else if (entry.isFile() && /\.(js|mjs)$/.test(entry.name)) {
      results.push(fullPath);
    }
  }
  return results;
}

// =============================================================================
// SECTION 1: Forbidden files and directories
// =============================================================================
function checkForbiddenFilesAndDirs() {
  // ERROR-level: node_modules/, .git/
  for (const forbiddenDir of ["node_modules", ".git"]) {
    const p = path.join(absPluginDir, forbiddenDir);
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
      addError(p, `Forbidden directory '${forbiddenDir}/' must not be included in the plugin package`);
    }
  }

  // ERROR-level: .env files (recursive walk not needed — top-level only for .env)
  let rootEntries;
  try {
    rootEntries = fs.readdirSync(absPluginDir);
  } catch (e) {
    addError(absPluginDir, `Cannot read plugin directory: ${e.message}`);
    return;
  }
  for (const name of rootEntries) {
    if (/^\.env(\..+)?$/.test(name)) {
      const p = path.join(absPluginDir, name);
      addError(p, `Forbidden file '${name}' — never include .env files in a plugin package`);
      suppressedFiles.add(p);
    }
  }

  // WARNING-level: lock files (top-level)
  for (const lockFile of ["package-lock.json", "yarn.lock", "pnpm-lock.yaml"]) {
    const p = path.join(absPluginDir, lockFile);
    if (fs.existsSync(p)) {
      addWarning(p, `Lock file '${lockFile}' should not be included in the plugin package`);
      suppressedFiles.add(p);
    }
  }
}

// =============================================================================
// SECTION 2: Manifest schema validation
// =============================================================================
function checkManifest() {
  const manifestPath = path.join(absPluginDir, "realtimex.plugin.json");

  if (!fs.existsSync(manifestPath)) {
    addError(absPluginDir, "Missing required file: realtimex.plugin.json");
    return null;
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (e) {
    addError(manifestPath, `Invalid JSON: ${e.message}`);
    return null;
  }

  // ── Required fields ─────────────────────────────────────────────────────────
  for (const field of ["id", "name", "displayName", "version"]) {
    if (!manifest[field] || typeof manifest[field] !== "string" || !manifest[field].trim()) {
      addError(manifestPath, `Missing or empty required field: '${field}'`);
    }
  }

  // ── entrypoint: required unless every declared capability is declarative ────
  // Mirrors PluginValidator.js so skill bundles and workspace-provision packs
  // do not need dummy JavaScript boilerplate.
  if (
    !manifest.entrypoint ||
    typeof manifest.entrypoint !== "string" ||
    !manifest.entrypoint.trim()
  ) {
    const declaredCaps =
      manifest.capabilities && typeof manifest.capabilities === "object"
        ? Object.entries(manifest.capabilities)
            .filter(([, v]) => Array.isArray(v) && v.length > 0)
            .map(([k]) => k)
        : [];
    const isDeclarativeOnly =
      declaredCaps.length > 0 &&
      declaredCaps.every((capability) =>
        DECLARATIVE_ONLY_CAPABILITIES.has(capability)
      );
    if (!isDeclarativeOnly) {
      addError(
        manifestPath,
        `Missing or empty required field: 'entrypoint' (omit only when all capabilities are declarative: ${[...DECLARATIVE_ONLY_CAPABILITIES].join(", ")})`
      );
    }
  }

  // ── id format: /^[a-z0-9][a-z0-9._-]*[a-z0-9]$/ ───────────────────────────
  if (manifest.id) {
    if (!/^[a-z0-9][a-z0-9._-]*[a-z0-9]$/.test(manifest.id)) {
      addWarning(manifestPath, `'id' should follow reverse-domain format (lowercase, dots/hyphens/underscores, no leading/trailing special chars) — got: '${manifest.id}'`);
    }
  }

  // ── name format: /^[a-z0-9][a-z0-9-]*$/ ────────────────────────────────────
  if (manifest.name) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(manifest.name)) {
      addError(manifestPath, `'name' must be lowercase alphanumeric with hyphens only — got: '${manifest.name}'`);
    }
  }

  // ── version: semver prefix ───────────────────────────────────────────────────
  if (manifest.version) {
    if (!/^\d+\.\d+\.\d+/.test(manifest.version)) {
      addWarning(manifestPath, `'version' should follow semver (e.g. 1.0.0) — got: '${manifest.version}'`);
    }
  }

  // ── entrypoint ───────────────────────────────────────────────────────────────
  if (manifest.entrypoint) {
    if (!/\.(js|mjs)$/.test(manifest.entrypoint)) {
      addError(manifestPath, `'entrypoint' must be a .js or .mjs file — got: '${manifest.entrypoint}'`);
    }
    // Path traversal check
    const entrypointAbs = path.resolve(absPluginDir, manifest.entrypoint);
    if (!entrypointAbs.startsWith(absPluginDir + path.sep) && entrypointAbs !== absPluginDir) {
      addError(manifestPath, `'entrypoint' must not escape the plugin directory — got: '${manifest.entrypoint}'`);
    } else if (!fs.existsSync(entrypointAbs)) {
      addError(manifestPath, `'entrypoint' file does not exist: '${manifest.entrypoint}'`);
    }
  }

  // ── capabilities ─────────────────────────────────────────────────────────────
  if (manifest.capabilities !== undefined) {
    if (typeof manifest.capabilities !== "object" || Array.isArray(manifest.capabilities)) {
      addError(manifestPath, "'capabilities' must be an object");
    } else {
      for (const capability of Object.keys(manifest.capabilities)) {
        if (!VALID_CAPABILITY_KEYS.has(capability)) {
          addWarning(manifestPath, `Unknown capability type: '${capability}'`);
        }
      }

      // hooks
      if (manifest.capabilities.hooks !== undefined) {
        if (!Array.isArray(manifest.capabilities.hooks)) {
          addError(manifestPath, "'capabilities.hooks' must be an array");
        } else {
          for (const h of manifest.capabilities.hooks) {
            if (!KNOWN_HOOKS.has(h)) {
              addWarning(manifestPath, `Unknown hook name in capabilities.hooks: '${h}'`);
            }
          }
        }
      }

      // api_routes
      if (manifest.capabilities.api_routes !== undefined) {
        if (!Array.isArray(manifest.capabilities.api_routes)) {
          addError(manifestPath, "'capabilities.api_routes' must be an array");
        } else {
          for (let i = 0; i < manifest.capabilities.api_routes.length; i++) {
            const route = manifest.capabilities.api_routes[i];
            if (!route.method) {
              addError(manifestPath, `capabilities.api_routes[${i}] missing required 'method'`);
            } else if (!VALID_ROUTE_METHODS.has(route.method)) {
              addError(manifestPath, `capabilities.api_routes[${i}] invalid method '${route.method}' — must be one of GET/POST/PUT/DELETE/PATCH`);
            }
            if (!route.path) {
              addError(manifestPath, `capabilities.api_routes[${i}] missing required 'path'`);
            }
            if (route.auth !== undefined && !VALID_ROUTE_AUTH.has(route.auth)) {
              addError(
                manifestPath,
                `capabilities.api_routes[${i}] invalid auth '${route.auth}'`
              );
            }
          }
        }
      }

      // Generic host-rendered UI contributions
      if (manifest.capabilities.ui_contributions !== undefined) {
        if (!Array.isArray(manifest.capabilities.ui_contributions)) {
          addError(
            manifestPath,
            "'capabilities.ui_contributions' must be an array"
          );
        } else {
          const declaredRoutes = new Map(
            (Array.isArray(manifest.capabilities.api_routes)
              ? manifest.capabilities.api_routes
              : []
            ).map((route) => [
              `${String(route?.method || "").toUpperCase()} ${route?.path || ""}`,
              route,
            ])
          );
          const contributionIds = new Set();
          for (const contribution of manifest.capabilities.ui_contributions) {
            if (!isPlainObject(contribution)) {
              addError(manifestPath, "Each UI contribution must be an object");
              continue;
            }
            const label = `UI contribution '${contribution.id || "?"}'`;
            if (!contribution.id || !SKILL_NAME_REGEX.test(contribution.id)) {
              addError(manifestPath, `${label} must have a valid slug id`);
            } else if (contributionIds.has(contribution.id)) {
              addError(
                manifestPath,
                `Duplicate UI contribution id: '${contribution.id}'`
              );
            } else {
              contributionIds.add(contribution.id);
            }
            if (contribution.surface !== "chat-history") {
              addError(manifestPath, `${label} has unsupported surface`);
            }
            if (contribution.component !== "status-event") {
              addError(manifestPath, `${label} has unsupported component`);
            }
            const source = contribution.source;
            const sourceRoute = `${String(source?.method || "").toUpperCase()} ${
              source?.path || ""
            }`;
            if (!isPlainObject(source) || !declaredRoutes.has(sourceRoute)) {
              addError(
                manifestPath,
                `${label} source must reference a declared api_routes entry`
              );
            } else if (declaredRoutes.get(sourceRoute)?.auth !== "contribution") {
              addError(
                manifestPath,
                `${label} source api route must use auth 'contribution'`
              );
            }
            if (
              contribution.options !== undefined &&
              !isPlainObject(contribution.options)
            ) {
              addError(manifestPath, `${label} options must be an object`);
            }
            if (
              contribution.actions !== undefined &&
              !Array.isArray(contribution.actions)
            ) {
              addError(manifestPath, `${label} actions must be an array`);
              continue;
            }
            const actionIds = new Set();
            for (const action of contribution.actions || []) {
              if (!isPlainObject(action)) {
                addError(manifestPath, `${label} actions must contain objects`);
                continue;
              }
              if (!action.id || !SKILL_NAME_REGEX.test(action.id)) {
                addError(manifestPath, `${label} action must have a valid slug id`);
              } else if (actionIds.has(action.id)) {
                addError(
                  manifestPath,
                  `${label} has duplicate action id '${action.id}'`
                );
              } else {
                actionIds.add(action.id);
              }
              const actionRoute = `${String(action.method || "").toUpperCase()} ${
                action.path || ""
              }`;
              if (!declaredRoutes.has(actionRoute)) {
                addError(
                  manifestPath,
                  `${label} action '${action.id || "?"}' must reference a declared api_routes entry`
                );
              } else if (
                declaredRoutes.get(actionRoute)?.auth !== "contribution"
              ) {
                addError(
                  manifestPath,
                  `${label} action '${action.id || "?"}' api route must use auth 'contribution'`
                );
              }
            }
          }
        }
      }

      // providers
      if (manifest.capabilities.providers !== undefined) {
        if (!Array.isArray(manifest.capabilities.providers)) {
          addError(manifestPath, "'capabilities.providers' must be an array");
        } else {
          for (let i = 0; i < manifest.capabilities.providers.length; i++) {
            const p = manifest.capabilities.providers[i];
            if (!p.key) addError(manifestPath, `capabilities.providers[${i}] missing required 'key'`);
            if (!p.type) {
              addError(manifestPath, `capabilities.providers[${i}] missing required 'type'`);
            } else if (!VALID_PROVIDER_TYPES.has(p.type)) {
              addError(manifestPath, `capabilities.providers[${i}] invalid type '${p.type}' — must be llm, embedding, context_engine, or image_generation`);
            }
          }
        }
      }
    }
  }

  validateWorkspaceProvisioning(manifest, manifestPath);

  // ── configSchema ─────────────────────────────────────────────────────────────
  if (manifest.configSchema !== undefined) {
    if (!Array.isArray(manifest.configSchema)) {
      addError(manifestPath, "'configSchema' must be an array");
    } else {
      for (let i = 0; i < manifest.configSchema.length; i++) {
        const entry = manifest.configSchema[i];
        if (!entry.key) {
          addError(manifestPath, `configSchema[${i}] missing required 'key'`);
        }
        if (!entry.label) {
          addWarning(manifestPath, `configSchema[${i}] (key: '${entry.key || "?"}') has no 'label' — recommended for the admin UI`);
        }
        if (entry.type !== undefined && !VALID_CONFIG_TYPES.has(entry.type)) {
          addWarning(manifestPath, `configSchema[${i}] (key: '${entry.key || "?"}') unknown type '${entry.type}' — expected text/password/number/boolean/select/multi-select/tag-list/file/folder`);
        }
        if (entry.type === "select") {
          if (!Array.isArray(entry.options) || entry.options.length === 0) {
            addError(manifestPath, `configSchema[${i}] (key: '${entry.key || "?"}') type=select requires a non-empty 'options' array`);
          }
        }
      }
    }
  }

  // ── llmSlots ─────────────────────────────────────────────────────────────────
  if (manifest.llmSlots !== undefined) {
    if (!Array.isArray(manifest.llmSlots)) {
      addError(manifestPath, "'llmSlots' must be an array");
    } else {
      const seenSlotNames = new Set();
      for (let i = 0; i < manifest.llmSlots.length; i++) {
        const slot = manifest.llmSlots[i];
        if (!slot.name) {
          addError(manifestPath, `llmSlots[${i}] missing required 'name'`);
        } else {
          if (!/^[a-z0-9][a-z0-9_-]*$/.test(slot.name)) {
            addError(manifestPath, `llmSlots[${i}] name '${slot.name}' must match /^[a-z0-9][a-z0-9_-]*$/`);
          }
          if (seenSlotNames.has(slot.name)) {
            addError(manifestPath, `llmSlots[${i}] duplicate slot name '${slot.name}' — slot names must be unique`);
          }
          seenSlotNames.add(slot.name);
        }
      }
    }
  }

  return manifest;
}

// =============================================================================
// SECTION 3: Syntax check all .js files + flag test files
// =============================================================================
function checkSyntaxAndFlagTestFiles(allJsFiles) {
  for (const f of allJsFiles) {
    const relPath = rel(f);

    // Flag test files — suppress from further checks
    if (/\.(test|spec)\.(js|mjs)$/.test(relPath)) {
      addWarning(f, `Test file '${relPath}' should not be included in the plugin package`);
      suppressedFiles.add(f);
      continue;
    }

    // Syntax check
    try {
      execFileSync(process.execPath, ["--check", f], { stdio: "pipe" });
    } catch (err) {
      const stderr = ((err.stderr || err.stdout || Buffer.alloc(0)).toString()).trim();
      addError(f, `Syntax error: ${stderr || err.message}`);
      suppressedFiles.add(f);
    }
  }
}

// =============================================================================
// SECTION 4: Entrypoint semantic checks
// =============================================================================
function checkEntrypoint(manifest) {
  if (!manifest || !manifest.entrypoint) return;

  const entrypointAbs = path.resolve(absPluginDir, manifest.entrypoint);
  if (!fs.existsSync(entrypointAbs) || suppressedFiles.has(entrypointAbs)) return;

  let src;
  try {
    src = fs.readFileSync(entrypointAbs, "utf8");
  } catch (e) {
    addError(entrypointAbs, `Cannot read entrypoint: ${e.message}`);
    return;
  }

  // Must require @realtimex/plugin-sdk
  if (!/require\s*\(\s*["']@realtimex\/plugin-sdk["']\s*\)/.test(src)) {
    addError(entrypointAbs, "Entrypoint must require('@realtimex/plugin-sdk')");
  }

  // Must call definePlugin(
  if (!/definePlugin\s*\(/.test(src)) {
    addError(entrypointAbs, "Entrypoint must call definePlugin()");
  }

  // Must use module.exports = definePlugin(
  if (!/module\.exports\s*=\s*definePlugin\s*\(/.test(src)) {
    addError(entrypointAbs, "Entrypoint must assign 'module.exports = definePlugin(...)'");
  }

  // id in definePlugin must match manifest id
  // Use multiline regex to capture id field (first occurrence after definePlugin()
  const idMatch = src.match(/definePlugin\s*\(\s*\{[\s\S]*?id\s*:\s*["']([^"']+)["']/);
  if (idMatch) {
    if (idMatch[1] !== manifest.id) {
      addError(entrypointAbs, `Plugin id mismatch: definePlugin id='${idMatch[1]}' vs manifest id='${manifest.id}'`);
    }
  } else {
    addWarning(entrypointAbs, "Could not detect 'id' field in definePlugin() call — verify it matches the manifest id");
  }

  // No ES module syntax
  if (/^\s*(import\s+[\w{*"']|export\s+(default|const|function|class|let|var|\{))/m.test(src)) {
    addError(entrypointAbs, "ES module syntax (import/export) detected — plugins must use CommonJS only");
  }
}

// =============================================================================
// SECTION 5: Code quality checks (all non-suppressed .js files)
// =============================================================================
function checkCodeQuality(allJsFiles) {
  for (const f of allJsFiles) {
    if (suppressedFiles.has(f)) continue;

    let src;
    try {
      src = fs.readFileSync(f, "utf8");
    } catch (e) {
      addError(f, `Cannot read file: ${e.message}`);
      continue;
    }

    const relPath = rel(f);
    const relParts = relPath.split(path.sep);

    // ── console.* calls ──────────────────────────────────────────────────────
    const consoleCalls = [...src.matchAll(/\bconsole\.(log|warn|error|info|debug)\s*\(/g)];
    if (consoleCalls.length > 0) {
      addWarning(f, `Use api.log instead of console.${consoleCalls[0][1]}() (${consoleCalls.length} occurrence(s) in this file)`);
    }

    // ── process.env access ───────────────────────────────────────────────────
    if (/\bprocess\.env\b/.test(src)) {
      const exception = src.match(
        /^\s*\/\/\s*realtimex-plugin-validator:\s*allow-process-env\s+--\s*(.{20,})\s*$/m
      );
      if (exception) {
        addWarning(
          f,
          `Explicit process.env exception — verify this is host-runtime transport/discovery, not plugin configuration: ${exception[1].trim()}`
        );
      } else {
        addError(f, "process.env access found — use api.getConfig() for plugin configuration instead");
      }
    }

    // ── Hardcoded secret pattern ─────────────────────────────────────────────
    // Looks for variable/property assignments where name suggests a secret and value is a long string literal
    if (/(api[_-]?key|secret|password|token|auth[_-]?key)\s*[:=]\s*["'][A-Za-z0-9+/=_\-]{16,}["']/i.test(src)) {
      addError(f, "Possible hardcoded secret detected — use configSchema with type='password' and api.getConfig()");
    }

    // ── ES module syntax ─────────────────────────────────────────────────────
    if (/^\s*(import\s+[\w{*"']|export\s+(default|const|function|class|let|var|\{))/m.test(src)) {
      addError(f, "ES module syntax (import/export) found — plugins must use CommonJS only");
    }

    // ── Forbidden require targets ────────────────────────────────────────────
    const requireMatches = [...src.matchAll(/require\s*\(\s*["']([^"']+)["']\s*\)/g)];
    for (const m of requireMatches) {
      const target = m[1];
      if (target === "@realtimex/plugin-sdk") continue;            // SDK: always OK
      if (target.startsWith("./") || target.startsWith("../")) continue; // local: OK
      const bare = target.startsWith("node:") ? target.slice(5) : target;
      if (NODE_BUILTINS.has(bare)) continue;                       // built-in: OK
      addWarning(f, `Potential npm dependency: require('${target}') — only @realtimex/plugin-sdk, Node.js built-ins, and local files are allowed`);
    }

    // ── Route files: try-catch check ─────────────────────────────────────────
    // Files that register routes or live in routes/ should handle errors
    const isRoutesFile = relParts.includes("routes");
    if (isRoutesFile || /api\.registerRoute\s*\(/.test(src)) {
      if (!/\btry\s*\{/.test(src)) {
        addWarning(f, "Route handler file has no try-catch — route handlers should handle errors to avoid unhandled rejections");
      }
    }

    // ── complete: must check .error and .timedOut ────────────────────────────
    if (/\bcomplete\s*\(/.test(src)) {
      if (!/\.error\b/.test(src)) {
        addError(f, "complete() called but result.error is never checked — always handle the error case gracefully");
      }
      if (!/\.timedOut\b/.test(src)) {
        addError(f, "complete() called but result.timedOut is never checked — always handle the timedOut case gracefully");
      }
    }

    // ── hooks/ and routes/ files must export a function ──────────────────────
    const isHooksFile  = relParts.includes("hooks");
    if (isHooksFile || isRoutesFile) {
      if (!/module\.exports\s*=\s*(function|async\s+function|\()/.test(src)) {
        addWarning(f, `File in ${isHooksFile ? "hooks" : "routes"}/ should export a function (factory or handler) via module.exports`);
      }
    }
  }
}

// =============================================================================
// SECTION 6: Cross-consistency checks (manifest ↔ code)
// =============================================================================
function checkCrossConsistency(manifest, allJsFiles) {
  if (!manifest) return;

  const manifestPath = path.join(absPluginDir, "realtimex.plugin.json");

  // ── Build manifest declaration sets ──────────────────────────────────────
  const manifestHooks = new Set(manifest.capabilities?.hooks || []);

  // Normalize route path: ensure leading /
  const normalizeRoutePath = (p) => (p.startsWith("/") ? p : "/" + p);
  const manifestRoutes = new Set(
    (manifest.capabilities?.api_routes || []).map(
      (r) => `${r.method}:${normalizeRoutePath(r.path || "")}`
    )
  );

  const manifestProviderTypes = new Set(
    (manifest.capabilities?.providers || []).map((p) => p.type)
  );

  const manifestSlotNames = new Set(
    (manifest.llmSlots || []).map((s) => s.name)
  );

  // ── Collect from code ─────────────────────────────────────────────────────
  const codeHooks         = new Set();
  const codeRoutes        = new Set();
  const codeProviderTypes = new Set();
  const codeSlotRefs      = new Set();

  for (const f of allJsFiles) {
    if (suppressedFiles.has(f)) continue;

    let src;
    try {
      src = fs.readFileSync(f, "utf8");
    } catch (e) {
      continue;
    }

    // Hook registrations: api.registerHook("hookName", ...)
    for (const m of src.matchAll(/api\.registerHook\s*\(\s*["']([^"']+)["']/g)) {
      codeHooks.add(m[1]);
    }

    // Route registrations: api.registerRoute("METHOD", "/path", ...)
    for (const m of src.matchAll(/api\.registerRoute\s*\(\s*["']([A-Z]+)["']\s*,\s*["']([^"']+)["']/g)) {
      codeRoutes.add(`${m[1]}:${normalizeRoutePath(m[2])}`);
    }

    // Provider registrations
    if (/api\.registerProvider\s*\(/.test(src))                    codeProviderTypes.add("llm");
    if (/api\.registerEmbeddingProvider\s*\(/.test(src))           codeProviderTypes.add("embedding");
    if (/api\.registerImageGenerationProvider\s*\(/.test(src))     codeProviderTypes.add("image_generation");
    if (/api\.registerContextEngine\s*\(/.test(src))               codeProviderTypes.add("context_engine");

    // LLM slot references: slot: "name" or api.resolveLlmSlot("name")
    for (const m of src.matchAll(/\bslot\s*:\s*["']([^"']+)["']/g)) {
      codeSlotRefs.add(m[1]);
    }
    for (const m of src.matchAll(/api\.resolveLlmSlot\s*\(\s*["']([^"']+)["']/g)) {
      codeSlotRefs.add(m[1]);
    }
  }

  // ── Compare hooks ─────────────────────────────────────────────────────────
  for (const h of manifestHooks) {
    if (!codeHooks.has(h)) {
      addError(manifestPath, `Hook '${h}' declared in capabilities.hooks but no api.registerHook("${h}", ...) found in any .js file`);
    }
  }
  for (const h of codeHooks) {
    if (!manifestHooks.has(h)) {
      addError(manifestPath, `Hook '${h}' registered in code but not declared in capabilities.hooks`);
    }
  }

  // ── Compare routes ────────────────────────────────────────────────────────
  for (const r of manifestRoutes) {
    if (!codeRoutes.has(r)) {
      const [method, routePath] = r.split(":");
      addError(manifestPath, `Route ${method} ${routePath} declared in capabilities.api_routes but api.registerRoute("${method}", "${routePath}", ...) not found in any .js file`);
    }
  }
  for (const r of codeRoutes) {
    if (!manifestRoutes.has(r)) {
      const [method, routePath] = r.split(":");
      addError(manifestPath, `Route ${method} ${routePath} found in code but not declared in capabilities.api_routes`);
    }
  }

  // ── Compare providers ─────────────────────────────────────────────────────
  const REGISTRATION_METHOD = {
    llm: "api.registerProvider()",
    embedding: "api.registerEmbeddingProvider()",
    image_generation: "api.registerImageGenerationProvider()",
    context_engine: "api.registerContextEngine()",
  };
  for (const t of codeProviderTypes) {
    if (!manifestProviderTypes.has(t)) {
      addError(manifestPath, `${REGISTRATION_METHOD[t]} called in code but no capabilities.providers entry with type:'${t}' found in manifest`);
    }
  }
  for (const t of manifestProviderTypes) {
    if (!codeProviderTypes.has(t)) {
      addWarning(manifestPath, `capabilities.providers declares type:'${t}' but the corresponding registration call (${REGISTRATION_METHOD[t]}) was not found in any .js file`);
    }
  }

  // ── Compare LLM slot references ───────────────────────────────────────────
  for (const slotName of codeSlotRefs) {
    if (!manifestSlotNames.has(slotName)) {
      addError(manifestPath, `LLM slot '${slotName}' referenced in code but not declared in manifest llmSlots`);
    }
  }
}

// =============================================================================
// SUMMARY: print report and exit
// =============================================================================
function printSummaryAndExit() {
  const divider = "─".repeat(60);
  console.log("\n" + BOLD(divider));
  console.log(BOLD("Validation Summary"));
  console.log(BOLD(divider));

  if (warnings.length > 0) {
    console.log(YELLOW(`\nWarnings (${warnings.length}):`));
    for (const w of warnings) {
      console.log(YELLOW(`  ⚠  ${rel(w.file)}: ${w.message}`));
    }
  }

  if (errors.length > 0) {
    console.log(RED(`\nErrors (${errors.length}):`));
    for (const e of errors) {
      console.log(RED(`  ✗  ${rel(e.file)}: ${e.message}`));
    }
  }

  if (errors.length === 0 && warnings.length === 0) {
    console.log(GREEN("\n✓ All checks passed — no errors, no warnings"));
  }

  console.log("\n" + BOLD(divider));

  if (errors.length > 0) {
    console.log(RED(BOLD(`FAIL — ${errors.length} error(s). Fix before packaging.`)));
    process.exit(1);
  } else {
    const warnNote = warnings.length > 0 ? `, ${warnings.length} warning(s)` : "";
    console.log(GREEN(BOLD(`OK — 0 errors${warnNote}`)));
    process.exit(0);
  }
}

// =============================================================================
// MAIN
// =============================================================================
console.log(BOLD(`\nValidating plugin: ${path.basename(absPluginDir)}`));
console.log(DIM(`  Directory: ${absPluginDir}\n`));

checkForbiddenFilesAndDirs();
const manifest = checkManifest();
const allJsFiles = walkJs(absPluginDir);
checkSyntaxAndFlagTestFiles(allJsFiles);
checkEntrypoint(manifest);
checkCodeQuality(allJsFiles);
checkCrossConsistency(manifest, allJsFiles);
printSummaryAndExit();
