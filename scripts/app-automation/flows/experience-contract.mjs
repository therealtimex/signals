import { createHash } from "node:crypto";

export const CONTRACT_KINDS = ["path", "review", "negative"];
export const EVIDENCE_PROFILES = ["assertions", "visual"];
export const CHECKPOINT_STATUSES = [
  "passed",
  "failed",
  "missing",
  "undeclared",
  "evidence_missing",
  "blocked",
];

const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function canonicalValue(value) {
  if (typeof value === "function") return { $function: value.toString() };
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .filter((key) => key !== "sha256")
        .sort()
        .map((key) => [key, canonicalValue(value[key])]),
    );
  }
  return value;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

export function contractSha256(contract) {
  return createHash("sha256")
    .update(JSON.stringify(canonicalValue(contract)))
    .digest("hex");
}

export function validateContract(contract) {
  const failures = [];
  if (!contract || typeof contract !== "object") return ["contract must be an object"];
  if (!KEBAB_CASE.test(contract.id ?? "")) failures.push("id must be kebab-case");
  if (!Number.isInteger(contract.issue) || contract.issue < 1) failures.push("issue must be a positive integer");
  if (!CONTRACT_KINDS.includes(contract.kind)) failures.push(`kind must be one of ${CONTRACT_KINDS.join(", ")}`);
  if (typeof contract.promise !== "string" || !contract.promise.trim()) failures.push("promise is required");
  if (!EVIDENCE_PROFILES.includes(contract.evidence?.profile)) {
    failures.push(`evidence.profile must be one of ${EVIDENCE_PROFILES.join(", ")}`);
  }
  if (contract.evidence?.gtm !== false) failures.push("evidence.gtm must be false for a QA contract");
  if (!contract.reachability || !["reachable", "blocked"].includes(contract.reachability.status)) {
    failures.push("reachability.status must be reachable or blocked");
  }
  if (contract.reachability?.status === "blocked") {
    if (!contract.reachability.by) failures.push("blocked reachability requires by");
    if (!contract.reachability.unblockedBy) failures.push("blocked reachability requires unblockedBy");
  }
  if (!Array.isArray(contract.checkpoints) || contract.checkpoints.length === 0) {
    failures.push("at least one checkpoint is required");
    return failures;
  }

  const ids = new Set();
  const captures = new Set();
  for (const checkpoint of contract.checkpoints) {
    if (!KEBAB_CASE.test(checkpoint?.id ?? "")) {
      failures.push(`checkpoint id must be kebab-case: ${checkpoint?.id ?? "<missing>"}`);
    } else if (ids.has(checkpoint.id)) {
      failures.push(`duplicate checkpoint id: ${checkpoint.id}`);
    } else {
      ids.add(checkpoint.id);
    }
    if (typeof checkpoint?.assert !== "function") {
      failures.push(`checkpoint ${checkpoint?.id ?? "<missing>"} requires assert`);
    }
    if (!checkpoint?.ui && !checkpoint?.data) {
      failures.push(`checkpoint ${checkpoint?.id ?? "<missing>"} requires ui or data expectation`);
    }
    if (checkpoint?.capture != null) {
      if (!KEBAB_CASE.test(checkpoint.capture)) {
        failures.push(`capture must be kebab-case: ${checkpoint.capture}`);
      } else if (captures.has(checkpoint.capture)) {
        failures.push(`duplicate capture name: ${checkpoint.capture}`);
      } else {
        captures.add(checkpoint.capture);
      }
    }
  }
  return failures;
}

export function defineContract(input) {
  const failures = validateContract(input);
  if (failures.length > 0) throw new Error(`Invalid experience contract:\n- ${failures.join("\n- ")}`);
  const contract = { ...input, sha256: contractSha256(input) };
  return deepFreeze(contract);
}

function assertionResult(result) {
  if (result === true) return { ok: true, detail: "assertion passed" };
  if (result === false) return { ok: false, detail: "assertion returned false" };
  if (result && typeof result === "object" && typeof result.ok === "boolean") {
    return { ok: result.ok, detail: String(result.detail ?? (result.ok ? "assertion passed" : "assertion failed")) };
  }
  throw new Error("assert must return boolean or { ok, detail }");
}

export function createCheckpointLedger(contract) {
  const declared = new Map(contract.checkpoints.map((checkpoint) => [checkpoint.id, checkpoint]));
  const records = new Map();
  const captures = new Map();
  const undeclared = [];

  function capture(name, file) {
    if (!contract.checkpoints.some((checkpoint) => checkpoint.capture === name)) {
      throw new Error(`undeclared evidence capture: ${name}`);
    }
    const files = captures.get(name) ?? [];
    files.push(file);
    captures.set(name, files);
  }

  function record(id, payload = {}) {
    const checkpoint = declared.get(id);
    if (!checkpoint) {
      const entry = { id, status: "undeclared", assertion: { ok: false, detail: "checkpoint is not declared" }, evidence: [] };
      undeclared.push(entry);
      throw new Error(`undeclared checkpoint: ${id}`);
    }
    if (records.has(id)) throw new Error(`duplicate checkpoint record: ${id}`);

    if (payload.status === "blocked") {
      if (contract.reachability.status !== "blocked") {
        throw new Error(`reachable contract cannot block checkpoint: ${id}`);
      }
      const entry = {
        id,
        status: "blocked",
        assertion: { ok: false, detail: String(payload.reason ?? contract.reachability.by) },
        evidence: checkpoint.capture ? (captures.get(checkpoint.capture) ?? []) : [],
      };
      records.set(id, entry);
      return entry;
    }

    const evidence = checkpoint.capture ? (captures.get(checkpoint.capture) ?? []) : [];
    if (contract.evidence.profile === "visual" && checkpoint.capture && evidence.length === 0) {
      const entry = {
        id,
        status: "evidence_missing",
        assertion: { ok: false, detail: `required capture was not produced: ${checkpoint.capture}` },
        evidence,
      };
      records.set(id, entry);
      return entry;
    }

    let assertion;
    try {
      assertion = assertionResult(checkpoint.assert({ ui: payload.ui, data: payload.data }));
    } catch (error) {
      assertion = { ok: false, detail: error instanceof Error ? error.message : String(error) };
    }
    const entry = { id, status: assertion.ok ? "passed" : "failed", assertion, evidence };
    records.set(id, entry);
    return entry;
  }

  function finalize() {
    const checkpoints = [];
    for (const checkpoint of contract.checkpoints) {
      checkpoints.push(
        records.get(checkpoint.id) ?? {
          id: checkpoint.id,
          status: "missing",
          assertion: { ok: false, detail: "declared checkpoint was not recorded" },
          evidence: checkpoint.capture ? (captures.get(checkpoint.capture) ?? []) : [],
        },
      );
    }
    checkpoints.push(...undeclared);
    const failures = checkpoints.filter((checkpoint) => !["passed", "blocked"].includes(checkpoint.status));
    const allBlocked = checkpoints.length > 0 && checkpoints.every((checkpoint) => checkpoint.status === "blocked");
    const result = contract.reachability.status === "blocked" && allBlocked
      ? "blocked"
      : failures.length === 0 && !checkpoints.some((checkpoint) => checkpoint.status === "blocked")
        ? "passed"
        : "failed";
    return { result, checkpoints, failures };
  }

  return { capture, record, finalize };
}

export function buildManifest({
  contract,
  contractPath,
  commit,
  target,
  fixture,
  startedAt,
  finishedAt,
  ledger,
  runnerFailures = [],
}) {
  const failures = [
    ...ledger.failures.map((entry) => ({ checkpointId: entry.id, status: entry.status, detail: entry.assertion.detail })),
    ...runnerFailures,
  ];
  return {
    schemaVersion: 1,
    contract: { id: contract.id, issue: contract.issue, kind: contract.kind, path: contractPath, sha256: contract.sha256 },
    commit,
    target,
    profile: contract.evidence.profile,
    fixture: fixture ?? null,
    startedAt,
    finishedAt,
    result: runnerFailures.length > 0 ? "failed" : ledger.result,
    checkpoints: ledger.checkpoints,
    failures,
  };
}
