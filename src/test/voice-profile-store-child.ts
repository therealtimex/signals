import {
  __voiceStoreTestHooks,
  approveVoiceProfile,
  upsertVoiceProfile,
} from "@/lib/writing/voice-profile-store";

type ChildOperation =
  | { mode: "upsert"; profile: Record<string, unknown> }
  | { mode: "crash_after_install"; profile: Record<string, unknown> }
  | { mode: "approve"; id: string; version: number };

const operation = JSON.parse(process.argv[2] ?? "null") as ChildOperation | null;
if (!operation) throw new Error("Missing voice profile child operation");

if (operation.mode === "crash_after_install") {
  __voiceStoreTestHooks.afterInstall = () => process.exit(86);
  await upsertVoiceProfile(operation.profile);
} else if (operation.mode === "approve") {
  const profile = await approveVoiceProfile({
    id: operation.id,
    version: operation.version,
    evidence: { kind: "api", caller: "voice-profile-child" },
  });
  process.stdout.write(`${JSON.stringify(profile)}\n`);
} else {
  const result = await upsertVoiceProfile(operation.profile);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
