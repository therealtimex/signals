#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");

const ID_PREFIXES = new Set(["spn", "clm", "src", "vs", "vp"]);
const BLOCKER_CLASSES = new Set(["hard", "claim"]);
const VOICE_SKIPPABLE_CLASSES = new Set(["voice", "heuristic", "aesthetic"]);
const TARGETED_SURFACES = new Set(["x/post", "x/thread", "linkedin/post", "facebook/post"]);

function newId(prefix) {
  if (!ID_PREFIXES.has(prefix)) throw new Error(`Unsupported id prefix: ${prefix}`);
  return `${prefix}_${crypto.randomBytes(12).toString("base64url")}`;
}

function hardLimit(surface) {
  if (surface.startsWith("x/")) return 280;
  if (surface.startsWith("linkedin/")) return 3_000;
  if (surface.startsWith("facebook/")) return 63_206;
  if (surface.startsWith("threads/")) return 500;
  if (surface.startsWith("instagram/")) return 2_200;
  if (surface.startsWith("tiktok/")) return 4_000;
  if (surface === "youtube/title") return 100;
  return 5_000;
}

function deriveHard(input) {
  const text = input.units.texts.join("\n");
  return {
    units: input.units.count,
    chars: input.units.chars,
    limit: input.limit,
    hashtags: (text.match(/(^|\s)#[\p{L}\p{N}_]+/gu) ?? []).length,
    links: (text.match(/https?:\/\/\S+/g) ?? []).length,
    mediaCount: input.media?.assetIds?.length ?? 0,
  };
}

function measure(surface, input) {
  const texts = Array.isArray(input?.texts) ? input.texts : [];
  const units = { texts, count: texts.length, chars: texts.map((text) => text.length) };
  const limit = hardLimit(surface);
  const hard = deriveHard({ units, media: input?.media, limit });
  const violations = [];
  units.chars.forEach((chars, index) => {
    if (chars > limit) violations.push({ reason: "unit_over_limit", unit: index + 1 });
  });
  if ((surface === "x/thread" || surface === "threads/thread") && units.count < 2) {
    violations.push({ reason: "thread_units" });
  } else if (surface !== "x/thread" && surface !== "threads/thread" && units.count !== 1) {
    violations.push({ reason: "thread_units" });
  }
  return { units, hard, violations };
}

function findingApplies(finding) { return !finding.skippedForVoice || !VOICE_SKIPPABLE_CLASSES.has(finding.class); }

function deriveVerdict(audit, spine) {
  const claimById = new Map((spine?.claims ?? []).map((claim) => [claim.id, claim]));
  const blocker = (audit.findings ?? []).some(
    (finding) => finding.severity === "blocker" && findingApplies(finding),
  ) ||
    (audit.claims?.invented?.length ?? 0) > 0 ||
    (audit.claims?.altered ?? []).some((id) => claimById.get(id)?.verbatimRequired) ||
    (audit.claims?.privateIncluded ?? []).some(
      (id) => claimById.get(id)?.includeInOutput === false,
    ) ||
    Boolean(audit.hard?.chars?.some((chars) => chars > audit.hard.limit));
  if (blocker) return "block";
  return audit.voice?.status === "rules_first" ||
    (audit.findings ?? []).some(
      (finding) => finding.severity === "warning" && findingApplies(finding),
    ) ||
    (audit.claims?.missing?.length ?? 0) > 0 ||
    (audit.claims?.altered?.length ?? 0) > 0
    ? "warn"
    : "pass";
}

function sameHard(left, right) {
  return ["units", "limit", "hashtags", "links", "mediaCount"].every(
    (key) => left?.[key] === right?.[key],
  ) && JSON.stringify(left?.chars) === JSON.stringify(right?.chars);
}

function expectedVoiceStatus(writing) {
  if (writing.voicePrecedence === "rules_first") return "rules_first";
  return writing.voiceProfile ? "applied" : "none";
}

function exactSurfaceUnits(surface, count) {
  return surface === "x/thread" || surface === "threads/thread" ? count >= 2 : count === 1;
}

function precheck(payload, spinePayload, launchPayload) {
  const input = payload?.input ?? payload;
  const writing = input?.metadata?.writing;
  const generation = input?.generationMetadata;
  const spine = spinePayload?.spine ?? spinePayload?.metadata?.writing?.spine ?? spinePayload;
  const launch = launchPayload?.input?.metadata?.writing ?? launchPayload?.metadata?.writing ?? launchPayload;
  const problems = [];
  const problem = (reason, path = []) => problems.push({ reason, path });

  if (!writing || !spine) return { ok: false, problems: [{ reason: "writing_required", path: ["metadata", "writing"] }] };
  if (writing.spine?.id !== spine.id || writing.spine?.hash !== spine.hash) {
    problem("spine_mismatch", ["metadata", "writing", "spine"]);
  }
  if (!writing.surface?.startsWith(`${writing.platform}/`)) problem("surface_platform_mismatch");
  if (!exactSurfaceUnits(writing.surface, writing.units?.count)) {
    problem("thread_units", ["metadata", "writing", "units"]);
  }
  if (input.body !== writing.units?.texts?.[0]) problem("body_units_mismatch", ["body"]);

  const measured = measure(writing.surface, { texts: writing.units?.texts ?? [], media: writing.media });
  if (writing.units?.count !== measured.units.count ||
      JSON.stringify(writing.units?.chars) !== JSON.stringify(measured.units.chars)) {
    problem("audit_hard_mismatch", ["metadata", "writing", "units"]);
  }

  const claimIds = new Set((spine.claims ?? []).map((claim) => claim.id));
  (writing.claimMap ?? []).forEach((claim, index) => {
    if (!claimIds.has(claim.claimId)) {
      problem("claim_unknown", ["metadata", "writing", "claimMap", index, "claimId"]);
    }
  });
  const sourceIds = new Set((spine.sources ?? []).map((source) => source.id));
  (writing.lineage?.sourceIds ?? []).forEach((sourceId, index) => {
    if (!sourceIds.has(sourceId)) {
      problem("lineage_source_unknown", ["metadata", "writing", "lineage", "sourceIds", index]);
    }
  });
  if (launch?.voiceProfile && !writing.voiceProfile) {
    problem("voice_profile_required", ["metadata", "writing", "voiceProfile"]);
  }

  if (Object.hasOwn(writing, "personality")) {
    const selector = writing.personality;
    const keys = selector && typeof selector === "object" && !Array.isArray(selector)
      ? Object.keys(selector)
      : [];
    if (keys.length !== 1 || keys[0] !== "bindingId" ||
        typeof selector?.bindingId !== "string" ||
        !/^pb_[A-Za-z0-9_-]{6,}$/.test(selector.bindingId)) {
      problem("personality_selector_invalid", ["metadata", "writing", "personality"]);
    }
  }

  const audit = writing.audit;
  if (audit) {
    if (Object.hasOwn(audit, "personality")) {
      problem("audit_personality_forbidden", ["metadata", "writing", "audit", "personality"]);
    }
    if (!sameHard(audit.hard, measured.hard)) {
      problem("audit_hard_mismatch", ["metadata", "writing", "audit", "hard"]);
    }
    if (audit.overlay?.id !== writing.overlay?.id || audit.overlay?.version !== writing.overlay?.version ||
        audit.core?.version !== writing.core?.version) {
      problem("audit_overlay_mismatch", ["metadata", "writing", "audit"]);
    }
    if (audit.voice?.status !== expectedVoiceStatus(writing)) {
      problem("audit_voice_mismatch", ["metadata", "writing", "audit", "voice", "status"]);
    }
    for (const [index, finding] of (audit.findings ?? []).entries()) {
      const encodedClass = finding.code?.split("/").at(-2);
      if (encodedClass !== finding.class ||
          (finding.severity === "blocker" && !BLOCKER_CLASSES.has(finding.class))) {
        problem("audit_severity_class", ["metadata", "writing", "audit", "findings", index]);
      }
      if (finding.skippedForVoice && BLOCKER_CLASSES.has(finding.class)) {
        problem("audit_voice_skip_class", ["metadata", "writing", "audit", "findings", index]);
      }
    }
    if (audit.verdict !== deriveVerdict(audit, spine)) {
      problem("audit_verdict_mismatch", ["metadata", "writing", "audit", "verdict"]);
    }
  }

  const formulaVersion = Number(/@([1-9][0-9]*)$/.exec(writing.formulaId ?? "")?.[1]);
  if (!formulaVersion || formulaVersion !== writing.overlay?.version) {
    problem("formula_version_mismatch", ["metadata", "writing", "formulaId"]);
  }
  if (!generation?.requestHash) problem("request_hash_missing", ["generationMetadata", "requestHash"]);
  if (TARGETED_SURFACES.has(writing.surface) && !writing.targetId) {
    problem("target_required_for_publish_surface", ["metadata", "writing", "targetId"]);
  }
  return { ok: problems.length === 0, problems };
}

function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }

function option(args, name) { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; }

function options(args, name) {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === name) values.push(args[index + 1]);
  }
  return values;
}

function usage() {
  return [
    "writing-cli.cjs id <spn|clm|src|vs|vp>",
    "writing-cli.cjs measure --surface <surface> (--units <file> | --text <text> [...])",
    "writing-cli.cjs verdict --audit <file> --spine <file>",
    "writing-cli.cjs precheck --variant <file> --spine <file> [--launch <file>]",
  ].join("\n");
}

function main(argv) {
  const [command, ...args] = argv;
  if (!command || command === "--help" || command === "help") {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  if (command === "id") {
    process.stdout.write(`${JSON.stringify(newId(args[0]))}\n`);
    return 0;
  }
  if (command === "measure") {
    const surface = option(args, "--surface");
    if (!surface) throw new Error("--surface is required");
    const unitsFile = option(args, "--units");
    const source = unitsFile ? readJson(unitsFile) : { texts: options(args, "--text") };
    process.stdout.write(`${JSON.stringify(measure(surface, source))}\n`);
    return 0;
  }
  if (command === "verdict") {
    const auditFile = option(args, "--audit");
    const spineFile = option(args, "--spine");
    if (!auditFile || !spineFile) throw new Error("--audit and --spine are required");
    const audit = readJson(auditFile);
    const spine = readJson(spineFile);
    const verdict = deriveVerdict(audit, spine);
    process.stdout.write(`${JSON.stringify({ verdict, reasons: [] })}\n`);
    return 0;
  }
  if (command === "precheck") {
    const variantFile = option(args, "--variant");
    const spineFile = option(args, "--spine");
    if (!variantFile || !spineFile) throw new Error("--variant and --spine are required");
    const result = precheck(
      readJson(variantFile),
      readJson(spineFile),
      option(args, "--launch") ? readJson(option(args, "--launch")) : undefined,
    );
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return result.ok ? 0 : 1;
  }
  throw new Error(`Unknown command: ${command}`);
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

module.exports = { newId, hardLimit, measure, deriveVerdict, precheck };
