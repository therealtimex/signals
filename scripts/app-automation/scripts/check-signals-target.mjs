#!/usr/bin/env node
/**
 * Print the resolved Signals target, or explain why it is unusable.
 *
 * Run this before any CDP work against the Dev app: it turns "the automation saw
 * an empty UI" into a specific, actionable reason.
 */
import { resolveSignalsTarget } from "../flows/resolve-signals-target.mjs";

const result = await resolveSignalsTarget();
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!result.ok) {
  process.stderr.write(`\n${result.message}\n`);
  process.exitCode = 1;
}
