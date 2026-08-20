#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  SIGNALS_NODE_MODULE_ABI,
  SIGNALS_NODE_VERSION_WITH_PREFIX,
  assertSignalsNodeRuntime,
  assertSignalsNodeRuntimeCompatibility,
} from "./node-runtime-contract.mjs";

assert.doesNotThrow(() => assertSignalsNodeRuntime());
assert.throws(
  () =>
    assertSignalsNodeRuntime({
      version: "v22.17.0",
      moduleAbi: SIGNALS_NODE_MODULE_ABI,
    }),
  /Node 22\.16\.0/,
);

const warnings = [];
assert.doesNotThrow(() =>
  assertSignalsNodeRuntimeCompatibility({
    version: "v22.17.0",
    moduleAbi: SIGNALS_NODE_MODULE_ABI,
    warn: (message) => warnings.push(message),
  }),
);
assert.equal(warnings.length, 1);
assert.match(warnings[0], /compatible module ABI 127/);

assert.throws(
  () =>
    assertSignalsNodeRuntimeCompatibility({
      version: SIGNALS_NODE_VERSION_WITH_PREFIX,
      moduleAbi: "115",
      warn: () => {},
    }),
  /requires module ABI 127/,
);

console.log("OK: exact build contract and ABI-compatible runtime contract verified");
