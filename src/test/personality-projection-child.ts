import { readPersonalityStore, withPersonalityStore } from "@/lib/personality/store";

const mode = process.argv[2];

if (mode === "hold") {
  await withPersonalityStore(async (session) => {
    process.stdout.write("locked\n");
    await new Promise<void>((resolve) => setTimeout(resolve, 3_000));
    session.commit({
      schemaVersion: 1,
      bindings: session.index.bindings,
      proposals: session.index.proposals,
    });
  });
  process.stdout.write("committed\n");
} else if (mode === "contend") {
  try {
    await withPersonalityStore(() => undefined, { timeoutMs: 100 });
    process.stdout.write("unexpected-lock\n");
  } catch (error) {
    process.stdout.write(`${(error as { code?: string }).code ?? "ERROR"}\n`);
  }
} else if (mode === "inspect") {
  process.stdout.write(`${readPersonalityStore().index.generation}\n`);
} else {
  process.exitCode = 2;
}
