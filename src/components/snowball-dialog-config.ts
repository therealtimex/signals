import { buildNetworkSnowballRunConfig, type NetworkSnowballConfig } from "@/lib/workflows/network-snowball";

export function buildSnowballDialogRunConfig(config: NetworkSnowballConfig, orgId?: string) {
  return { ...buildNetworkSnowballRunConfig(config), ...(orgId ? { orgId } : {}) };
}
