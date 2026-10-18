import { checkDemoSeedTarget } from "@/lib/db/demo-seed-guard";

async function main(): Promise<void> {
  const json = process.argv.includes("--json");
  const fixtureIndex = process.argv.indexOf("--fixture");
  const fixture = fixtureIndex >= 0 ? process.argv[fixtureIndex + 1] : null;
  const labelIndex = process.argv.indexOf("--label");
  const label = labelIndex >= 0 ? process.argv[labelIndex + 1] : undefined;
  const verdict = checkDemoSeedTarget();
  if (!verdict.ok) {
    if (json) process.stdout.write(`${JSON.stringify(verdict)}\n`);
    else process.stderr.write(`${verdict.message}\n`);
    process.exitCode = 1;
    return;
  }
  if (fixture !== "nurture-proposals") {
    const result = { ok: false, code: "fixture_unknown", fixture };
    if (json) process.stdout.write(`${JSON.stringify(result)}\n`);
    else process.stderr.write(`Unknown experience fixture: ${fixture ?? "(missing)"}\n`);
    process.exitCode = 1;
    return;
  }
  try {
    const { seedNurtureProposalFixture } = await import(
      "@/lib/db/seed-fixtures/nurture-proposals"
    );
    const objectiveIndex = process.argv.indexOf("--objective");
    const objective = objectiveIndex >= 0 ? process.argv[objectiveIndex + 1] : undefined;
    if (objective !== undefined && !["none", "commercial", "relationship_only"].includes(objective)) {
      throw Object.assign(new Error(`--objective must be none, commercial or relationship_only`), {
        code: "fixture_option_invalid",
      });
    }
    const offeringIndex = process.argv.indexOf("--offering");
    const offeringSlug = offeringIndex >= 0 ? process.argv[offeringIndex + 1] : undefined;
    const result = await seedNurtureProposalFixture({
      label,
      ...(objective ? { objective: objective as "none" | "commercial" | "relationship_only" } : {}),
      ...(offeringSlug ? { offeringSlug } : {}),
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    const candidate = error as Error & { code?: string; reasons?: string[] };
    const result = {
      ok: false,
      code: candidate.code ?? "fixture_failed",
      error: candidate.message,
      ...(candidate.reasons ? { reasons: candidate.reasons } : {}),
    };
    if (json) process.stdout.write(`${JSON.stringify(result)}\n`);
    else process.stderr.write(`${candidate.message}\n`);
    process.exitCode = 1;
  }
}

await main();
