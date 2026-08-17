/** X enrich cards show RTX migration steps even when Signals X OAuth is disconnected. */
export const ENRICH_ACTION_IDS = new Set(["x-enrich", "x-enrich-low"]);

export function actionNeedsPlatformConnection(
  actionId: string,
  actionType: "api" | "upload",
  isConnected: boolean,
  isLoading: boolean
): boolean {
  if (actionType === "upload") return false;
  if (ENRICH_ACTION_IDS.has(actionId)) return false;
  return !isConnected && !isLoading;
}

export function getActionRunButtonLabel(
  actionId: string,
  opts: {
    needsConnection: boolean;
    restrictionNavigateTo?: string;
    hasRestriction: boolean;
    isRunning: boolean;
    isUpload?: boolean;
    hasImportHistory?: boolean;
  }
): string {
  if (opts.needsConnection) return "Connect first";
  if (opts.restrictionNavigateTo) return "Go to Settings";
  if (opts.hasRestriction) return "Restricted";
  if (opts.isRunning) return "Running...";
  if (ENRICH_ACTION_IDS.has(actionId)) return "Show RTX steps";
  if (opts.isUpload) return opts.hasImportHistory ? "Import again" : "Upload export";
  return "Run";
}
