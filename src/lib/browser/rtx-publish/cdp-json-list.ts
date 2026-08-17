import { isShellOrDevtoolsUrl } from "@/lib/browser/rtx-publish/x-publish-url";

export type CdpJsonPageTarget = {
  id: string;
  url: string;
  title: string;
  webSocketDebuggerUrl: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

/** True for CDP `/json/list` page targets that represent real web content (not the Electron shell). */
export function isInspectableCdpPageTarget(tab: unknown): tab is CdpJsonPageTarget {
  if (!isRecord(tab)) return false;
  if (tab.type && tab.type !== "page") return false;

  const url = typeof tab.url === "string" ? tab.url : "";
  const webSocketDebuggerUrl =
    typeof tab.webSocketDebuggerUrl === "string" ? tab.webSocketDebuggerUrl : "";
  if (!url || !webSocketDebuggerUrl) return false;
  if (isShellOrDevtoolsUrl(url)) return false;

  const id = typeof tab.id === "string" ? tab.id : "";
  const title = typeof tab.title === "string" ? tab.title : "";
  return Boolean(id);
}

/** List inspectable page targets from the RTX Browser CDP HTTP endpoint. */
export async function fetchCdpJsonPageTargets(
  remoteDebugPort: number,
  fetchImpl: typeof fetch = fetch
): Promise<CdpJsonPageTarget[]> {
  const baseUrl = `http://127.0.0.1:${remoteDebugPort}`;
  const response = await fetchImpl(`${baseUrl}/json/list`).catch(() => null);
  if (!response?.ok) {
    const fallback = await fetchImpl(`${baseUrl}/json`).catch(() => null);
    if (!fallback?.ok) return [];
    const body = await fallback.json().catch(() => null);
    return normalizeCdpJsonTargets(body);
  }

  const body = await response.json().catch(() => null);
  return normalizeCdpJsonTargets(body);
}

function normalizeCdpJsonTargets(body: unknown): CdpJsonPageTarget[] {
  if (!Array.isArray(body)) return [];

  return body
    .filter(isInspectableCdpPageTarget)
    .map((tab) => ({
      id: tab.id,
      url: tab.url,
      title: typeof tab.title === "string" ? tab.title : "",
      webSocketDebuggerUrl: tab.webSocketDebuggerUrl,
    }));
}
