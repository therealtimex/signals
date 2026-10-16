/**
 * Browser-side calls to the allowed-websites API (#547). Every call resolves: `status: null` means
 * Signals didn't respond, so callers can say "nothing was changed" instead of guessing.
 */
import type {
  AddAllowedOriginResult,
  AllowedOriginsChange,
  AllowedOriginsErrorBody,
  AllowedOriginsView,
  RemoveAllowedOriginResult,
} from "@/lib/browser/allowed-websites-types";

export type ApiOutcome<T> =
  | { status: number; body: T | AllowedOriginsErrorBody | { code?: string; error?: string } | null }
  | { status: null; body: null };

export type BrowserConnectionOption = {
  id: string;
  sessionName: string;
  kind: "shared" | "dedicated";
};

/** Error statuses carry a JSON body too (`{ code, error }`); callers branch on `status`. */
async function readBody<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

async function call<T>(input: string, init?: RequestInit): Promise<ApiOutcome<T>> {
  const response = await fetch(input, init).catch(() => null);
  if (!response) return { status: null, body: null };
  return { status: response.status, body: await readBody<T>(response) };
}

const base = (connectionId: string) =>
  `/api/browser-connections/${encodeURIComponent(connectionId)}/allowed-origins`;

const jsonPost = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export const allowedWebsitesApi = {
  listConnections: () =>
    call<{ connections: BrowserConnectionOption[] }>("/api/browser-connections"),
  /** The shared connection's row is created on first use of Settings (ADR-547-4). */
  ensurePublishConnection: () =>
    call<{ connection: BrowserConnectionOption }>(
      "/api/platform-targets/connections",
      jsonPost({ sessionName: "signals-publish", kind: "shared" }),
    ),
  get: (connectionId: string) => call<AllowedOriginsView>(base(connectionId)),
  add: (connectionId: string, url: string, source: "settings" | "recovery") =>
    call<AddAllowedOriginResult>(base(connectionId), jsonPost({ url, source })),
  remove: (connectionId: string, origin: string) =>
    call<RemoveAllowedOriginResult>(`${base(connectionId)}/${encodeURIComponent(origin)}`, {
      method: "DELETE",
    }),
  apply: (connectionId: string) =>
    call<AllowedOriginsChange>(`${base(connectionId)}/apply`, { method: "POST" }),
};
