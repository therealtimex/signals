export default async function run(ctx) {
  const templates = await ctx.api("/api/workflows/templates?templateType=nurture&pageSize=100");
  const template = templates.body.data.find((entry) => entry.name === "Contact Relationship Nurture");
  const targets = await ctx.api("/api/platform-targets");
  const activeTargets = targets.body.targets.filter((target) => target.status === "active");
  if (!template || activeTargets.length === 0) {
    const error = new Error("fixture_precondition_unmet: the autonomous guard requires the nurture template and one active acting target");
    error.code = "fixture_precondition_unmet";
    throw error;
  }

  const config = typeof template.config === "string" ? JSON.parse(template.config) : template.config;
  if (config.requireApproval !== true) throw new Error("autonomous guard: stored template is not explicit");
  for (const target of activeTargets) {
    const response = await ctx.api(`/api/workflows/templates/${template.id}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: { requireApproval: false, targetId: target.id } }),
    });
    if (response.status !== 422 || response.body.errorCode !== "approval_gate_locked") {
      throw new Error(`autonomous guard: ${target.platform} returned ${response.status}/${response.body.errorCode}`);
    }
  }
  for (const checkpoint of [
    "activation-operator-choice",
    "run-config-off-honored",
    "composition-autonomous",
    "published-result",
    "dm-still-explicit",
  ]) {
    ctx.record(checkpoint, { status: "blocked", reason: "assist_only_mandate", data: { reason: "assist_only_mandate" } });
  }
}
