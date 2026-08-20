#!/usr/bin/env node
import path from "node:path";
import { pathToFileURL } from "node:url";

export const SIGNALS_NODE_VERSION = "22.16.0";
export const SIGNALS_NODE_VERSION_WITH_PREFIX = `v${SIGNALS_NODE_VERSION}`;
export const SIGNALS_NODE_MODULE_ABI = "127";
export const SIGNALS_NODE_ENGINE_RANGE = ">=22.16.0 <23";

export function assertSignalsNodeRuntime({
  label = "Signals",
  version = process.version,
  moduleAbi = process.versions.modules,
} = {}) {
  const mismatches = [];
  if (version !== SIGNALS_NODE_VERSION_WITH_PREFIX) {
    mismatches.push(`Node ${SIGNALS_NODE_VERSION} (received ${version})`);
  }
  if (moduleAbi !== SIGNALS_NODE_MODULE_ABI) {
    mismatches.push(`module ABI ${SIGNALS_NODE_MODULE_ABI} (received ${moduleAbi})`);
  }
  if (mismatches.length > 0) {
    throw new Error(
      `${label} requires ${mismatches.join(" and ")} so native dependencies match the RealtimeX host.`,
    );
  }
}

export function assertSignalsNodeRuntimeCompatibility({
  label = "Signals",
  version = process.version,
  moduleAbi = process.versions.modules,
  warn = console.warn,
} = {}) {
  if (moduleAbi !== SIGNALS_NODE_MODULE_ABI) {
    throw new Error(
      `${label} requires module ABI ${SIGNALS_NODE_MODULE_ABI} for native dependencies; received Node ${version} with ABI ${moduleAbi}.`,
    );
  }
  if (version !== SIGNALS_NODE_VERSION_WITH_PREFIX) {
    warn(
      `${label} was built and tested with Node ${SIGNALS_NODE_VERSION}; running ${version} with compatible module ABI ${moduleAbi}.`,
    );
  }
}

const isDirectExecution =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectExecution) {
  try {
    assertSignalsNodeRuntime();
    console.log(
      `OK: Node ${SIGNALS_NODE_VERSION} uses module ABI ${SIGNALS_NODE_MODULE_ABI}`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
