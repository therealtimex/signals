import { isSnowballSeedScoutTemplateConfig } from "@/lib/workflows/snowball-seed-scout";

export interface DeployableTemplate {
  id: string;
  name: string;
  description: string | null;
  config: string;
}

/** Template config is stored as a JSON string; a malformed one is simply not deployable. */
export function parseDeployTemplateConfig(config: string): Record<string, unknown> {
  try {
    return JSON.parse(config || "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Whether the gallery should offer Deploy instead of Run for this template. */
export function isSnowballSeedScoutTemplate(template: DeployableTemplate): boolean {
  return isSnowballSeedScoutTemplateConfig(
    parseDeployTemplateConfig(template.config),
  );
}

/**
 * Render `deployedAt` without depending on the server's locale or timezone.
 *
 * `toLocaleString()` during render produces different text on the server and the
 * client, which is a hydration mismatch. This formats deterministically in UTC.
 */
export function formatDeployedAt(deployedAt: string): string {
  const parsed = new Date(deployedAt);
  if (Number.isNaN(parsed.getTime())) return "";
  const iso = parsed.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}
