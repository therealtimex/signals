import Database from "better-sqlite3";
import { join } from "node:path";
import { getPersonalityProposal } from "@/lib/personality/store";
import {
  __personalityUseCaseTestHooks,
  setTargetRepresentation,
} from "@/lib/personality/use-cases";
import { approveVoiceProfile, __voiceStoreTestHooks } from "@/lib/writing/voice-profile-store";
import {
  approveFixturePersonalityProposal,
  personalityGuardDependencies,
  personalityWorkspace,
} from "@/test/personality-writing-fixture";

const mode = process.argv[2];
const storageDir = process.env.RACE_STORAGE_DIR;
if (!storageDir) throw new Error("RACE_STORAGE_DIR is required");

function hold(label: string): void {
  process.stdout.write(`${label}\n`);
  const memory = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(memory, 0, 0, 750);
}

if (mode === "apply") {
  const proposalId = process.env.RACE_PROPOSAL_ID!;
  const workspace = personalityWorkspace(storageDir);
  const dependencies = personalityGuardDependencies(workspace);
  const proposal = getPersonalityProposal(proposalId).proposal;
  __personalityUseCaseTestHooks.beforeBindingReconcile = () => hold("binding-committed");
  await approveFixturePersonalityProposal(proposal, workspace, dependencies);
  process.stdout.write("apply-done\n");
} else if (mode === "target") {
  const workspace = personalityWorkspace(storageDir);
  const dependencies = personalityGuardDependencies(workspace);
  __personalityUseCaseTestHooks.beforeTargetMutation = () => hold("target-locked");
  await setTargetRepresentation({
    targetId: process.env.RACE_TARGET_ID!,
    bindingId: process.env.RACE_BINDING_ID!,
    represents: { kind: "unbound" },
    evidence: { kind: "ui", route: "/settings/personality" },
  }, dependencies);
  process.stdout.write("target-done\n");
} else if (mode === "source") {
  const dataDir = process.env.SIGNALS_DATA_DIR!;
  const sqlite = new Database(join(dataDir, "data.db"));
  sqlite.pragma("busy_timeout = 10000");
  sqlite.exec("BEGIN IMMEDIATE");
  sqlite.prepare(
    "UPDATE contacts SET name = ?, first_name = ?, updated_at = unixepoch() WHERE is_self = 1",
  ).run("Source Race Winner", "Source");
  hold("source-locked");
  sqlite.exec("COMMIT");
  sqlite.close();
  process.stdout.write("source-done\n");
} else if (mode === "voice") {
  __voiceStoreTestHooks.beforeIndexCommit = () => hold("voice-locked");
  await approveVoiceProfile({
    id: process.env.RACE_VOICE_ID!,
    version: Number(process.env.RACE_VOICE_VERSION!),
    evidence: { kind: "ui", route: "/settings/personality" },
  });
  process.stdout.write("voice-done\n");
} else {
  process.exitCode = 2;
}
