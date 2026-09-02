import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { validateContract } from "../flows/experience-contract.mjs";

const scenarioDir = dirname(fileURLToPath(import.meta.url));

test("every Experience Contract has a sibling scenario and globally unique checkpoint ids", async () => {
  const files = await readdir(scenarioDir);
  const contractFiles = files.filter((file) => file.endsWith(".contract.mjs")).sort();
  assert.ok(contractFiles.length > 0);
  const checkpointOwners = new Map();
  for (const file of contractFiles) {
    const contract = (await import(pathToFileURL(join(scenarioDir, file)).href)).default;
    assert.deepEqual(validateContract(contract), [], file);
    assert.ok(files.includes(file.replace(".contract.mjs", ".mjs")), `${file} has no sibling scenario`);
    for (const checkpoint of contract.checkpoints) {
      assert.equal(checkpointOwners.has(checkpoint.id), false, `${checkpoint.id} is also declared by ${checkpointOwners.get(checkpoint.id)}`);
      checkpointOwners.set(checkpoint.id, file);
    }
  }
});
