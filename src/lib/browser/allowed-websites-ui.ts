/**
 * Copy and state rules for the allowed-websites UI (#547): Settings → Platforms → Allowed websites,
 * the run page callout and the allow dialog. The strings are UX contract v1 §1–§3 and Addendum 1,
 * verbatim. The one rule everything here keeps: nothing says "active" or "allowed" unless
 * RealTimeX is reachable and holds the website.
 */
import type { ApiOutcome, BrowserConnectionOption } from "@/lib/browser/allowed-websites-client";
import type {
  AddAllowedOriginResult,
  AllowedOriginsChange,
  AllowedOriginsRuntime,
  AllowedOriginsView,
  RemoveAllowedOriginResult,
} from "@/lib/browser/allowed-websites-types";
import type { RunNavigationDenial } from "@/lib/browser/navigation-blocked";

export const NO_PUBLISHING_CARD =
  "Websites the RealTimeX Browser can open for Signals. Allowing a website only lets the browser open it. It doesn't let Signals publish, message or take any other action there.";
export const NO_PUBLISHING_DIALOG =
  "This only lets the browser open the website. It doesn't let Signals publish, message or take any other action there. You can remove it later in Settings → Platforms.";
export const ADD_HELP =
  "Paste any link from the website. Signals keeps only its address, such as https://www.example.com. The address must match exactly: example.com and www.example.com are different websites.";
export const SELECT_HELP =
  "Each connection keeps its own list. The websites Signals always allows apply to every connection.";
export const EMPTY_LIST =
  "You haven't added any websites. When a run is blocked by a website, you can allow it from the run.";
export const DEFAULTS_CAPTION =
  "Signals needs these for X, LinkedIn and Facebook. They can't be removed.";
export const NO_RESPONSE =
  "Couldn't save. Signals didn't respond, so nothing was changed. Try again.";

const FIELD_ERRORS: Record<string, string> = {
  invalid_url: "Enter a full link that starts with https:// or http://.",
  unsupported_scheme: "Only websites that start with https:// or http:// can be allowed.",
  credentials_not_allowed: "Remove the username and password from the link, then add it again.",
};

export function devGuardMessage(sessionName: string): string {
  return `This development copy of Signals can't change ${sessionName}.`;
}

function hasResult<T extends object>(body: unknown, key: keyof T): body is T {
  return !!body && typeof body === "object" && key in body;
}

function errorCode(body: unknown): string | null {
  return body && typeof body === "object" && "code" in body && typeof body.code === "string"
    ? body.code
    : null;
}

export type AddFeedback =
  | {
      kind: "result";
      result: AddAllowedOriginResult;
      message: string;
      /** The contract clears the field only once nothing is left to do with the link. */
      clearInput: boolean;
    }
  | { kind: "field_error"; message: string };

/** What Settings shows after Add (contract §1.1). */
export function interpretAdd(
  outcome: ApiOutcome<AddAllowedOriginResult>,
  sessionName: string,
): AddFeedback {
  if (outcome.status === null) return { kind: "field_error", message: NO_RESPONSE };
  if (outcome.status === 403) return { kind: "field_error", message: devGuardMessage(sessionName) };
  if (outcome.status === 400) {
    return { kind: "field_error", message: FIELD_ERRORS[errorCode(outcome.body) ?? ""] ?? FIELD_ERRORS.invalid_url };
  }
  if ((outcome.status === 200 || outcome.status === 502) && hasResult<AddAllowedOriginResult>(outcome.body, "persisted")) {
    const result = outcome.body;
    const origin = result.origin;
    if (result.status === "already_default") {
      return { kind: "result", result, message: `${origin} is already allowed by Signals.`, clearInput: true };
    }
    if (result.status === "already_added") {
      return { kind: "result", result, message: `${origin} is already in your list.`, clearInput: true };
    }
    if (result.applied) {
      return { kind: "result", result, message: `Added ${origin}. The browser can open it now.`, clearInput: true };
    }
    if (result.runtime?.reachable) {
      return { kind: "result", result, message: `Saved ${origin}, but it isn't active yet.`, clearInput: false };
    }
    return {
      kind: "result",
      result,
      message: `Saved ${origin}. It takes effect when the RealTimeX Browser is available.`,
      clearInput: false,
    };
  }
  return { kind: "field_error", message: NO_RESPONSE };
}

export type RemoveFeedback =
  | { kind: "result"; result: RemoveAllowedOriginResult; message: string }
  | { kind: "error"; message: string };

/** What Settings shows after Remove (contract §1.2). Errors go to the status line. */
export function interpretRemove(
  outcome: ApiOutcome<RemoveAllowedOriginResult>,
  sessionName: string,
): RemoveFeedback {
  if (outcome.status === 403) return { kind: "error", message: devGuardMessage(sessionName) };
  if ((outcome.status === 200 || outcome.status === 502) && hasResult<RemoveAllowedOriginResult>(outcome.body, "removed")) {
    const result = outcome.body;
    const message = result.removed && !result.applied && result.runtime
      ? `Removed ${result.origin}, but the change isn't active yet.`
      : `Removed ${result.origin}.`;
    return { kind: "result", result, message };
  }
  return { kind: "error", message: NO_RESPONSE };
}

/** Undo re-adds the website (contract §1.2). */
export function interpretUndo(outcome: ApiOutcome<AddAllowedOriginResult>, sessionName: string): AddFeedback {
  const feedback = interpretAdd(outcome, sessionName);
  if (feedback.kind === "result" && feedback.result.status === "added" && feedback.result.applied) {
    return { ...feedback, message: `Added ${feedback.result.origin} back.` };
  }
  return feedback;
}

export type ApplyFeedback =
  | { kind: "result"; change: AllowedOriginsChange; message: string }
  | { kind: "error"; message: string };

/** The "Some changes aren't active yet" alert's Try again (contract §1.3). */
export function interpretApply(outcome: ApiOutcome<AllowedOriginsChange>, sessionName: string): ApplyFeedback {
  if (outcome.status === 403) return { kind: "error", message: devGuardMessage(sessionName) };
  if ((outcome.status === 200 || outcome.status === 502) && hasResult<AllowedOriginsChange>(outcome.body, "applied")) {
    const change = outcome.body;
    return {
      kind: "result",
      change,
      message: change.applied
        ? "All changes are active."
        : "Still not active. The RealTimeX Browser didn't accept the update.",
    };
  }
  return { kind: "error", message: NO_RESPONSE };
}

export type CardAlert = "unreachable" | "not_active" | null;

/**
 * One card-level alert at a time (contract §1.3, Addendum A3). RealTimeX can be reachable yet hold
 * no list for the session (it was never created, or creating it failed): once the user has added
 * websites, that is "not active yet" too, so Try again stays available.
 */
export function cardAlert(view: Pick<AllowedOriginsView, "runtime" | "effective" | "defaults">): CardAlert {
  const { runtime } = view;
  if (!runtime) return null;
  if (!runtime.reachable) return "unreachable";
  if (runtime.applied === false) return "not_active";
  const defaults = new Set(view.defaults);
  const hasAdditions = view.effective.some((origin) => !defaults.has(origin));
  return runtime.allowedOrigins === null && hasAdditions ? "not_active" : null;
}

/** "Not active yet" on a row: RealTimeX is reachable and doesn't hold the website (or holds no list). */
export function rowNotActive(origin: string, runtime: AllowedOriginsRuntime | null): boolean {
  return !!runtime?.reachable && !(runtime.allowedOrigins ?? []).includes(origin);
}

/**
 * Apply an add/remove/apply response to the loaded view. With no view yet (its load failed), the
 * response alone carries what the run callout needs: the effective list and what RealTimeX holds.
 */
export function viewFromChange(
  current: AllowedOriginsView | null,
  change: AllowedOriginsChange,
  identity: { connectionId: string; sessionName: string },
): AllowedOriginsView {
  return current
    ? mergeChange(current, change)
    : { ...identity, defaults: [], custom: [], effective: change.effective, runtime: change.runtime };
}

/** Apply an add/remove/apply response to the loaded view. */
export function mergeChange(
  view: AllowedOriginsView,
  change: AllowedOriginsChange,
  custom: AllowedOriginsView["custom"] = view.custom,
): AllowedOriginsView {
  return { ...view, custom, effective: change.effective, runtime: change.runtime };
}

const SHORT_DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

/** "Added on Oct 14", "Added today", "Added on Oct 16 from a blocked run". */
export function formatAddedMeta(
  addedAt: number,
  source: "settings" | "recovery",
  now: Date = new Date(),
): string {
  const added = new Date(addedAt * 1000);
  const sameDay = added.toDateString() === now.toDateString();
  const day = sameDay ? "Added today" : `Added on ${SHORT_DATE.format(added)}`;
  return source === "recovery" ? `${day} from a blocked run` : day;
}

export type CalloutOriginState = "blocked" | "allowed" | "not_active" | "unreachable";

/**
 * Where one blocked website stands for its connection (contract §2.1, Addendum A3). "allowed"
 * needs RealTimeX reachable and holding the website; a saved website RealTimeX can't confirm is
 * never shown as allowed.
 */
export function calloutOriginState(origin: string, view: AllowedOriginsView | null): CalloutOriginState {
  const runtime = view?.runtime ?? null;
  if (runtime?.reachable && runtime.allowedOrigins?.includes(origin)) return "allowed";
  if (!view || !view.effective.includes(origin)) return "blocked";
  if (!runtime || !runtime.reachable) return "unreachable";
  return "not_active";
}

const PUBLISH_SESSION = "signals-publish";

/** The connection Settings opens on: the deep-linked one, else signals-publish, else the first. */
export function pickInitialConnection(
  connections: readonly BrowserConnectionOption[],
  requestedId: string | null,
): BrowserConnectionOption | null {
  return (
    connections.find((connection) => connection.id === requestedId) ??
    connections.find((connection) => connection.sessionName === PUBLISH_SESSION) ??
    connections[0] ??
    null
  );
}

export function connectionKindLabel(connection: BrowserConnectionOption): string {
  return connection.sessionName === PUBLISH_SESSION ? "Shared · used for publishing" : "Dedicated";
}

export type BlockedOrigin = { origin: string; requestedUrl: string | null };

export type BlockedConnectionGroup = {
  connectionId: string;
  sessionName: string;
  origins: BlockedOrigin[];
};

/**
 * Group a run's recoverable denials by the connection the server resolved (Addendum A1). The UI
 * never derives a connection itself: a denial without `recovery.connectionId` has no callout.
 */
export function groupRecoverableDenials(denials: readonly RunNavigationDenial[]): BlockedConnectionGroup[] {
  const groups = new Map<string, BlockedConnectionGroup>();
  for (const denial of denials) {
    if (!denial.recoverable || !denial.recovery) continue;
    const { connectionId, origin } = denial.recovery;
    const group = groups.get(connectionId) ?? {
      connectionId,
      sessionName: denial.sessionName ?? connectionId,
      origins: [],
    };
    const existing = group.origins.find((entry) => entry.origin === origin);
    if (existing) existing.requestedUrl ??= denial.requestedUrl;
    else group.origins.push({ origin, requestedUrl: denial.requestedUrl });
    groups.set(connectionId, group);
  }
  return [...groups.values()];
}

/** Settings → Platforms → Allowed websites, with the connection selected (contract §2.1). */
export function manageAllowedWebsitesHref(connectionId: string): string {
  return `/dashboard/settings?tab=platforms&connection=${encodeURIComponent(connectionId)}#allowed-websites`;
}
