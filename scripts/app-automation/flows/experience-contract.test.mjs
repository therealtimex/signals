import assert from "node:assert/strict";
import test from "node:test";
import {
  buildManifest,
  createCheckpointLedger,
  defineContract,
  validateContract,
} from "./experience-contract.mjs";

function contract(overrides = {}) {
  return defineContract({
    id: "example-contract",
    issue: 413,
    kind: "review",
    reachability: { status: "reachable" },
    evidence: { profile: "visual", gtm: false },
    promise: "The UI and persisted state agree.",
    checkpoints: [
      {
        id: "state-agrees",
        ui: "UI says ready",
        data: "API says ready",
        capture: "ready-state",
        assert: ({ ui, data }) => ({ ok: ui === data, detail: `ui=${ui} data=${data}` }),
      },
    ],
    ...overrides,
  });
}

test("defineContract freezes a validated contract and hashes assertion source", () => {
  const value = contract();
  assert.equal(Object.isFrozen(value), true);
  assert.match(value.sha256, /^[a-f0-9]{64}$/);
  assert.equal(value.sha256, contract().sha256);
});

test("validateContract rejects malformed and duplicate checkpoint identifiers", () => {
  const failures = validateContract({
    id: "Bad Id",
    issue: 0,
    kind: "other",
    promise: "",
    reachability: { status: "blocked" },
    evidence: { profile: "visual", gtm: true },
    checkpoints: [
      { id: "same", capture: "same-shot", assert: () => true },
      { id: "same", capture: "same-shot" },
    ],
  });
  assert.ok(failures.some((failure) => failure.includes("id must be kebab-case")));
  assert.ok(failures.some((failure) => failure.includes("duplicate checkpoint id")));
  assert.ok(failures.some((failure) => failure.includes("duplicate capture name")));
  assert.ok(failures.some((failure) => failure.includes("requires assert")));
  assert.ok(failures.some((failure) => failure.includes("blocked reachability requires by")));
});

test("the ledger fails missing evidence and missing declarations", () => {
  const ledger = createCheckpointLedger(contract());
  assert.equal(ledger.record("state-agrees", { ui: "ready", data: "ready" }).status, "evidence_missing");
  const result = ledger.finalize();
  assert.equal(result.result, "failed");
  assert.equal(result.failures[0].status, "evidence_missing");
});

test("the ledger passes only after capture and assertion", () => {
  const ledger = createCheckpointLedger(contract());
  ledger.capture("ready-state", "ready-state.png");
  const entry = ledger.record("state-agrees", { ui: "ready", data: "ready" });
  assert.equal(entry.status, "passed");
  assert.deepEqual(entry.evidence, ["ready-state.png"]);
  assert.equal(ledger.finalize().result, "passed");
});

test("undeclared and duplicate records throw immediately", () => {
  const ledger = createCheckpointLedger(contract({ evidence: { profile: "assertions", gtm: false } }));
  assert.throws(() => ledger.record("not-declared"), /undeclared checkpoint/);
  ledger.record("state-agrees", { ui: "ready", data: "ready" });
  assert.throws(() => ledger.record("state-agrees", { ui: "ready", data: "ready" }), /duplicate checkpoint/);
});

test("a blocked contract produces an explicit blocked result", () => {
  const value = contract({
    kind: "path",
    reachability: { status: "blocked", by: "assist_only_mandate", unblockedBy: "a new ADR" },
    evidence: { profile: "assertions", gtm: false },
  });
  const ledger = createCheckpointLedger(value);
  ledger.record("state-agrees", { status: "blocked", reason: "assist_only_mandate" });
  assert.equal(ledger.finalize().result, "blocked");
});

test("buildManifest is deterministic for stable inputs", () => {
  const value = contract({ evidence: { profile: "assertions", gtm: false } });
  const ledger = createCheckpointLedger(value);
  ledger.record("state-agrees", { ui: "ready", data: "ready" });
  const finalized = ledger.finalize();
  const input = {
    contract: value,
    contractPath: "scripts/app-automation/scenarios/example.contract.mjs",
    commit: { sha: "abc", dirty: false },
    target: { origin: "http://127.0.0.1:3010", source: "base-url", healthApp: "signals" },
    fixture: null,
    startedAt: "2026-09-02T00:00:00.000Z",
    finishedAt: "2026-09-02T00:00:01.000Z",
    ledger: finalized,
  };
  assert.deepEqual(buildManifest(input), buildManifest(input));
});
