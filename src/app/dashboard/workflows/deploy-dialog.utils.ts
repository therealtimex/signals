import { isSnowballSeedScoutTemplateConfig } from "@/lib/workflows/snowball-seed-scout";
import { parseTemplateConfig } from "@/lib/workflows/template-config";

export interface DeployableTemplate {
  id: string;
  name: string;
  description: string | null;
  config: string;
}

/** Whether the gallery should offer Deploy instead of Run for this template. */
export function isSnowballSeedScoutTemplate(template: DeployableTemplate): boolean {
  return isSnowballSeedScoutTemplateConfig(parseTemplateConfig(template.config));
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
