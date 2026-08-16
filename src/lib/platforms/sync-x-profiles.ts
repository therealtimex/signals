import type { SyncResult } from "@/lib/platforms/adapter";

export const BROWSER_ENRICHMENT_UNAVAILABLE_CODE = "BROWSER_ENRICHMENT_UNAVAILABLE";

export const BROWSER_ENRICHMENT_MESSAGE =
  "In-process Playwright profile enrichment was removed from Signals. Use RealTimeX Browser + agent-browser, then write results with POST /api/agent-tools/invoke (enrich_contact, create_contact). See docs/rtx-agent-browser-enrichment.md.";

/**
 * Profile enrichment no longer runs inside Signals.
 * RTX terminal agents scrape via agent-browser and mutate CRM data through agent-tools.
 */
export async function syncXProfiles(
  _accountId: string,
  _opts?: {
    maxProfiles?: number;
    contactIds?: string[];
  }
): Promise<SyncResult> {
  return {
    added: 0,
    updated: 0,
    skipped: 0,
    errors: [`${BROWSER_ENRICHMENT_UNAVAILABLE_CODE}: ${BROWSER_ENRICHMENT_MESSAGE}`],
  };
}
