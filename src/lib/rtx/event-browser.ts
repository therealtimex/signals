import { createHash } from "node:crypto";
import * as cheerio from "cheerio";
import { chromium } from "playwright";
import type { Page } from "playwright";
import { getBrowserConnectionBySessionName } from "@/lib/db/queries/platform-targets";
import {
  acquireSessionLease,
  getSessionLease,
  getSessionLeaseById,
  releaseSessionLease,
  renewSessionLease,
} from "@/lib/leases/session-lease";
import { PlatformTargetError } from "@/lib/platforms/target-errors";
import {
  findRtxBrowserSession,
  listRtxBrowserSessions,
  resolveRtxDebugPort,
} from "@/lib/rtx/browser-sessions";
import type { EnvLike } from "@/lib/rtx/env";
import { EVENT_PROVIDER_RUNTIME_POLICY } from "@/lib/workflows/event-sources/policy";
import type {
  AuthorizedEventParticipant,
  EventSourceAccessScope,
  GuestBoundaryReason,
} from "@/lib/workflows/event-sources/types";
import { canonicalizeLumaUrl, lumaEventKey } from "@/lib/workflows/event-sources/urls";
import { LUMA_EXTRACTOR_VERSION } from "@/lib/workflows/event-sources/providers/luma";

export class EventBrowserError extends Error {
  constructor(
    readonly reason: Exclude<GuestBoundaryReason, null>,
    message: string,
  ) {
    super(message);
    this.name = "EventBrowserError";
  }
}

const EVENT_BROWSER_LEASE_TTL_SECONDS = 30 * 60;
const SNOWBALL_RUN_LEASE_HOLDER_PREFIX = "network-snowball:";

export type AuthorizedEventBrowserLease = {
  leaseId: string;
  expiresAt: number;
  reused: boolean;
};

/**
 * Acquire the selected source session, or reuse the current run's lease when its publishing
 * target is bound to the same browser connection. Reuse preserves the target binding and leaves
 * final release to the run owner.
 */
export function acquireAuthorizedEventBrowserLease(input: {
  connectionId: string;
  runId: string;
}): AuthorizedEventBrowserLease {
  const holder = `${SNOWBALL_RUN_LEASE_HOLDER_PREFIX}${input.runId}`;
  const now = Math.floor(Date.now() / 1_000);
  const current = getSessionLease(input.connectionId);
  if (current && current.expiresAt >= now && current.holder === holder) {
    const renewed = renewSessionLease(current.leaseId, EVENT_BROWSER_LEASE_TTL_SECONDS);
    return { leaseId: renewed.leaseId, expiresAt: renewed.expiresAt, reused: true };
  }

  try {
    const acquired = acquireSessionLease(input.connectionId, {
      holder,
      targetId: null,
      intent: "browse",
      ttlSeconds: EVENT_BROWSER_LEASE_TTL_SECONDS,
    });
    return { leaseId: acquired.leaseId, expiresAt: acquired.expiresAt, reused: false };
  } catch (error) {
    if (error instanceof PlatformTargetError && error.code === "SESSION_LEASE_HELD") {
      throw new EventBrowserError(
        "permission_missing",
        "The selected browser session is currently in use by another workflow.",
      );
    }
    throw error;
  }
}

/** Renew only the exact lease still owned by this Snowball run and connection. */
export function renewAuthorizedEventBrowserLease(input: {
  connectionId: string;
  leaseId: string;
  runId: string;
}): AuthorizedEventBrowserLease {
  const current = getSessionLeaseById(input.leaseId);
  const now = Math.floor(Date.now() / 1_000);
  if (
    !current ||
    current.connectionId !== input.connectionId ||
    current.holder !== `${SNOWBALL_RUN_LEASE_HOLDER_PREFIX}${input.runId}` ||
    current.expiresAt < now
  ) {
    throw new EventBrowserError(
      "lease_lost",
      "The browser lease expired or changed during authorized source traversal.",
    );
  }
  try {
    const renewed = renewSessionLease(input.leaseId, EVENT_BROWSER_LEASE_TTL_SECONDS);
    return { leaseId: renewed.leaseId, expiresAt: renewed.expiresAt, reused: true };
  } catch (error) {
    if (error instanceof PlatformTargetError && error.code === "LEASE_LOST") {
      throw new EventBrowserError(
        "lease_lost",
        "The browser lease expired or changed during authorized source traversal.",
      );
    }
    throw error;
  }
}

function normalizedText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isVisiblyIncluded($: cheerio.CheerioAPI, element: Parameters<cheerio.CheerioAPI>[0]): boolean {
  let current = $(element);
  while (current.length) {
    const style = current.attr("style") ?? "";
    if (
      current.attr("aria-hidden") === "true" ||
      current.attr("data-signals-computed-hidden") === "true" ||
      current.is("[hidden]") ||
      /display\s*:\s*none|visibility\s*:\s*hidden/i.test(style)
    ) return false;
    current = current.parent();
  }
  return true;
}

async function visibleDomSnapshot(page: Page): Promise<string> {
  return page.evaluate(() => {
    const root = document.documentElement;
    const clone = root.cloneNode(true) as HTMLElement;
    const sourceElements = [root, ...root.querySelectorAll<HTMLElement>("*")];
    const clonedElements = [clone, ...clone.querySelectorAll<HTMLElement>("*")];
    for (let index = 0; index < sourceElements.length; index += 1) {
      const source = sourceElements[index];
      const cloned = clonedElements[index];
      if (!source || !cloned) continue;
      const style = getComputedStyle(source);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.visibility === "collapse" ||
        style.contentVisibility === "hidden" ||
        style.opacity === "0"
      ) {
        cloned.setAttribute("data-signals-computed-hidden", "true");
      }
    }
    return clone.outerHTML;
  });
}

function visibleSelection($: cheerio.CheerioAPI, selector: string) {
  return $(selector).filter((_, element) => isVisiblyIncluded($, element));
}

function removeNonVisibleTextSources($: cheerio.CheerioAPI): void {
  $("script, style, noscript").remove();
  $("*").each((_, element) => {
    if (!isVisiblyIncluded($, element)) $(element).remove();
  });
}

type TextTreeNode = {
  type: string;
  data?: string;
  children?: TextTreeNode[];
};

function collectTextNodesInOrder(node: TextTreeNode, fragments: string[]): void {
  if (node.type === "text" && typeof node.data === "string") {
    fragments.push(node.data);
    return;
  }
  if (node.children) {
    for (const child of node.children) collectTextNodesInOrder(child, fragments);
  }
}

function visibleBodyText($: cheerio.CheerioAPI): string {
  const fragments: string[] = [];
  for (const node of $("body").contents().toArray()) {
    collectTextNodesInOrder(node, fragments);
  }
  return normalizedText(fragments.join(" "));
}

function hasVisibleSignInControl($: cheerio.CheerioAPI): boolean {
  return visibleSelection(
    $,
    'a[href], button, [role="button"], input[type="button"], input[type="submit"]',
  ).toArray().some((element) => {
    const control = $(element);
    const label = normalizedText([
      control.attr("aria-label"),
      control.attr("title"),
      control.attr("value"),
      control.text(),
    ].filter(Boolean).join(" "));
    if (/\b(?:sign|log)\s+in\b/i.test(label)) return true;
    const href = control.attr("href");
    if (!href) return false;
    try {
      return /\/(?:sign|log)[-_]?in(?:\/|$)/i.test(new URL(href, "https://luma.com").pathname);
    } catch {
      return false;
    }
  });
}

function readVisibleLumaPageState(html: string): {
  bodyText: string;
  hasSignInControl: boolean;
  viewerIdentity: string;
} {
  const $ = cheerio.load(html);
  removeNonVisibleTextSources($);
  const bodyText = visibleBodyText($);
  const viewer = visibleSelection(
    $,
    '[data-testid="user-menu"], [data-testid="account-menu"], [data-viewer-identity], button[aria-label*="account" i], button[aria-label*="profile" i], header button img[alt], nav button img[alt]',
  ).first();
  const viewerIdentity = normalizedText(
    viewer.attr("data-viewer-identity")
      ?? viewer.attr("aria-label")
      ?? viewer.attr("title")
      ?? viewer.find("img[alt]").first().attr("alt")
      ?? viewer.text(),
  );
  return { bodyText, hasSignInControl: hasVisibleSignInControl($), viewerIdentity };
}

function throwForVisibleLumaGate(state: ReturnType<typeof readVisibleLumaPageState>): void {
  if (!state.viewerIdentity) {
    if (state.hasSignInControl) {
      throw new EventBrowserError("login_required", "The selected browser session is not signed in to Luma.");
    }
    return;
  }
  if (/\bregister\s+to\s+view\s+guest\s+list\b|\bregistered\s+guests?\s+only\b/i.test(state.bodyText)) {
    throw new EventBrowserError("registration_required", "The guest list requires event registration.");
  }
  if (/you are waitlisted|on the waitlist|waitlist status/i.test(state.bodyText)) {
    throw new EventBrowserError("waitlisted", "The selected viewer is waitlisted and cannot access the guest list.");
  }
}

export function inspectVisibleLumaViewerIdentity(html: string): string {
  const state = readVisibleLumaPageState(html);
  throwForVisibleLumaGate(state);
  if (!state.viewerIdentity) {
    throw new EventBrowserError("permission_missing", "A visible signed-in Luma viewer identity could not be verified.");
  }
  return state.viewerIdentity;
}

export function inspectAuthorizedLumaHtml(input: {
  html: string;
  canonicalUrl: string;
  scope: Extract<EventSourceAccessScope, { kind: "authorized" }>;
  observedAt?: number;
  maxParticipants: number;
}): { viewerIdentity: string; participants: AuthorizedEventParticipant[] } {
  const $ = cheerio.load(input.html);
  const viewerIdentity = inspectVisibleLumaViewerIdentity(input.html);

  let guestRoot = visibleSelection(
    $,
    '[data-guest-list-access="authorized"], [data-testid*="guest" i], [data-testid*="attendee" i], [class*="guest-list" i], [class*="attendee-list" i]',
  ).first();
  if (!guestRoot.length) {
    guestRoot = visibleSelection($, '[role="dialog"]').filter((_, element) =>
      /guest list|attendees|people going/i.test(normalizedText($(element).text())),
    ).first();
  }
  if (!guestRoot.length) {
    throw new EventBrowserError("permission_missing", "The selected viewer does not have a visibly accessible guest list.");
  }

  const observedAt = input.observedAt ?? Math.floor(Date.now() / 1000);
  const eventKey = lumaEventKey(input.canonicalUrl);
  if (!eventKey) throw new EventBrowserError("parse_failed", "The event key could not be resolved.");
  const candidates = guestRoot.find("[data-participant-name], a[href], li, article").toArray();
  const seen = new Set<string>();
  const participants: AuthorizedEventParticipant[] = [];
  for (const element of candidates) {
    if (participants.length >= input.maxParticipants) break;
    const current = $(element);
    if (!isVisiblyIncluded($, element)) continue;
    const displayName = normalizedText(
      current.attr("data-participant-name")
        ?? current.find("[data-participant-name]").first().attr("data-participant-name")
        ?? current.find("img[alt]").first().attr("alt")
        ?? current.text(),
    );
    if (!displayName || displayName.length > 160 || /guest list|attendees|going/i.test(displayName)) continue;
    const href = current.is("a") ? current.attr("href") : current.find("a[href]").first().attr("href");
    let profileUrl: string | null = null;
    if (href) {
      try {
        const candidate = new URL(href, input.canonicalUrl);
        if (["luma.com", "www.luma.com", "lu.ma", "www.lu.ma"].includes(candidate.hostname.toLowerCase())) {
          candidate.search = "";
          candidate.hash = "";
          profileUrl = candidate.toString();
        }
      } catch {
        profileUrl = null;
      }
    }
    const subjectKey = createHash("sha256")
      .update(`${displayName.toLowerCase()}\u0000${profileUrl ?? ""}`)
      .digest("hex")
      .slice(0, 32);
    if (seen.has(subjectKey)) continue;
    seen.add(subjectKey);
    participants.push({
      subjectKey,
      displayName,
      profileUrl,
      rsvp: "registered",
      attendance: "unknown",
      evidence: {
        eventKey,
        sourceUrl: input.canonicalUrl,
        observedAt,
        observedRole: "participant",
        confidence: "high",
        scope: input.scope,
        provider: "luma",
        extractorVersion: LUMA_EXTRACTOR_VERSION,
        observationId: `obs_${createHash("sha256").update(`${eventKey}:${subjectKey}:${observedAt}`).digest("hex").slice(0, 24)}`,
      },
    });
  }
  if (participants.length === 0) {
    throw new EventBrowserError("parse_failed", "The guest list was visible but no participant rows could be parsed.");
  }
  return { viewerIdentity, participants };
}

export function recheckAuthorizedLumaBoundary(input: {
  html: string;
  canonicalUrl: string;
  scope: Extract<EventSourceAccessScope, { kind: "authorized" }>;
  expectedViewerIdentity: string | null;
  maxParticipants: number;
}): { viewerIdentity: string; participants: AuthorizedEventParticipant[] } {
  const inspected = inspectAuthorizedLumaHtml(input);
  if (
    input.expectedViewerIdentity !== null &&
    inspected.viewerIdentity !== input.expectedViewerIdentity
  ) {
    throw new EventBrowserError(
      "session_changed",
      "The visible Luma viewer identity changed during observation.",
    );
  }
  return inspected;
}

export async function verifyAuthorizedLumaParticipantProfiles(input: {
  participants: AuthorizedEventParticipant[];
  expectedViewerIdentity: string;
  maxProfileVisits: number;
  navigate: (url: string) => Promise<string>;
  renewLease: () => void;
  sleep: (ms: number) => Promise<void>;
  beforeProviderRequest?: () => Promise<boolean>;
}): Promise<number> {
  const profileUrls = [...new Set(input.participants.flatMap((participant) =>
    participant.profileUrl ? [participant.profileUrl] : [],
  ))].slice(0, input.maxProfileVisits);
  let visits = 0;
  for (const profileUrl of profileUrls) {
    input.renewLease();
    if (visits > 0) await input.sleep(EVENT_PROVIDER_RUNTIME_POLICY.minRequestIntervalMs);
    if (input.beforeProviderRequest && !(await input.beforeProviderRequest())) {
      throw new EventBrowserError("rate_limited", "The event provider request budget is exhausted.");
    }
    const viewerIdentity = inspectVisibleLumaViewerIdentity(await input.navigate(profileUrl));
    input.renewLease();
    if (viewerIdentity !== input.expectedViewerIdentity) {
      throw new EventBrowserError("session_changed", "The visible Luma viewer identity changed during profile observation.");
    }
    visits += 1;
  }
  return visits;
}

export async function observeAuthorizedLumaParticipants(input: {
  runId: string;
  ownerWorkspace: string;
  grantId: string;
  sessionName: string;
  url: string;
  maxParticipants: number;
  maxGuestPages: number;
  maxProfileVisits: number;
  beforeProviderRequest?: () => Promise<boolean>;
  env?: EnvLike;
  fetchImpl?: typeof fetch;
}): Promise<{
  connectionId: string;
  sessionName: string;
  viewerIdentity: string;
  participants: AuthorizedEventParticipant[];
}> {
  const canonicalUrl = canonicalizeLumaUrl(input.url);
  if (!canonicalUrl) throw new EventBrowserError("parse_failed", "Unsupported Luma event URL.");
  const connection = getBrowserConnectionBySessionName(input.sessionName);
  if (!connection || connection.status !== "active") {
    throw new EventBrowserError("permission_missing", "The selected browser connection is not registered in Signals.");
  }
  const sessions = await listRtxBrowserSessions(input.env, input.fetchImpl);
  const session = findRtxBrowserSession(sessions, input.sessionName);
  const port = resolveRtxDebugPort(session);
  if (!session || session.running === false || !port) {
    throw new EventBrowserError("permission_missing", "The selected RealTimeX browser session is not running.");
  }

  const lease = acquireAuthorizedEventBrowserLease({
    connectionId: connection.id,
    runId: input.runId,
  });
  const renewLease = () => {
    renewAuthorizedEventBrowserLease({
      connectionId: connection.id,
      leaseId: lease.leaseId,
      runId: input.runId,
    });
  };
  let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | null = null;
  try {
    renewLease();
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const context = browser.contexts()[0];
    if (!context) throw new EventBrowserError("session_changed", "The selected browser context disappeared.");
    let page = context.pages().find((candidate) => canonicalizeLumaUrl(candidate.url()) === canonicalUrl);
    page ??= await context.newPage();
    if (input.beforeProviderRequest && !(await input.beforeProviderRequest())) {
      throw new EventBrowserError("rate_limited", "The event provider request budget is exhausted.");
    }
    renewLease();
    await page.goto(canonicalUrl, {
      waitUntil: "domcontentloaded",
      timeout: EVENT_PROVIDER_RUNTIME_POLICY.navigationTimeoutMs,
    });
    renewLease();
    const initialHtml = await visibleDomSnapshot(page);
    throwForVisibleLumaGate(readVisibleLumaPageState(initialHtml));
    const guestTrigger = page.getByText(/^\s*(?:guest list|[\d,]+\s+(?:people\s+)?going)\s*$/i).first();
    if (await guestTrigger.isVisible().catch(() => false)) {
      if (input.beforeProviderRequest && !(await input.beforeProviderRequest())) {
        throw new EventBrowserError("rate_limited", "The event provider request budget is exhausted.");
      }
      renewLease();
      await guestTrigger.click({ timeout: 5_000 }).catch(() => undefined);
      await page.waitForTimeout(300);
      renewLease();
    }
    const participants: AuthorizedEventParticipant[] = [];
    const seenParticipants = new Set<string>();
    let viewerIdentity: string | null = null;
    for (let guestPage = 0; guestPage < input.maxGuestPages; guestPage += 1) {
      renewLease();
      const inspected = recheckAuthorizedLumaBoundary({
        html: await visibleDomSnapshot(page),
        canonicalUrl,
        scope: { kind: "authorized", ownerWorkspace: input.ownerWorkspace, runId: input.runId, grantId: input.grantId },
        expectedViewerIdentity: viewerIdentity,
        maxParticipants: input.maxParticipants,
      });
      viewerIdentity = inspected.viewerIdentity;
      for (const participant of inspected.participants) {
        if (participants.length >= input.maxParticipants) break;
        if (seenParticipants.has(participant.subjectKey)) continue;
        seenParticipants.add(participant.subjectKey);
        participants.push(participant);
      }
      if (participants.length >= input.maxParticipants) break;
      const nextGuests = page.getByRole("button", { name: /^\s*(?:load more|show more|next)\s*$/i }).first();
      if (!(await nextGuests.isVisible().catch(() => false))) break;
      if (input.beforeProviderRequest && !(await input.beforeProviderRequest())) {
        throw new EventBrowserError("rate_limited", "The event provider request budget is exhausted.");
      }
      renewLease();
      await nextGuests.click({ timeout: 5_000 });
      await page.waitForTimeout(EVENT_PROVIDER_RUNTIME_POLICY.minRequestIntervalMs);
      renewLease();
    }
    if (!viewerIdentity || participants.length === 0) {
      throw new EventBrowserError("parse_failed", "The authorized guest observation was empty.");
    }
    await page.waitForTimeout(100);
    const confirmedViewerIdentity = inspectVisibleLumaViewerIdentity(await visibleDomSnapshot(page));
    if (confirmedViewerIdentity !== viewerIdentity) {
      throw new EventBrowserError("session_changed", "The visible Luma viewer identity changed during observation.");
    }
    await verifyAuthorizedLumaParticipantProfiles({
      participants,
      expectedViewerIdentity: viewerIdentity,
      maxProfileVisits: input.maxProfileVisits,
      navigate: async (profileUrl) => {
        renewLease();
        await page.goto(profileUrl, {
          waitUntil: "domcontentloaded",
          timeout: EVENT_PROVIDER_RUNTIME_POLICY.navigationTimeoutMs,
        });
        renewLease();
        return visibleDomSnapshot(page);
      },
      renewLease,
      sleep: (ms) => page.waitForTimeout(ms),
      beforeProviderRequest: input.beforeProviderRequest,
    });
    if (input.beforeProviderRequest && !(await input.beforeProviderRequest())) {
      throw new EventBrowserError("rate_limited", "The event provider request budget is exhausted.");
    }
    renewLease();
    await page.goto(canonicalUrl, {
      waitUntil: "domcontentloaded",
      timeout: EVENT_PROVIDER_RUNTIME_POLICY.navigationTimeoutMs,
    });
    renewLease();
    const finalGuestTrigger = page.getByText(
      /^\s*(?:guest list|[\d,]+\s+(?:people\s+)?going)\s*$/i,
    ).first();
    if (await finalGuestTrigger.isVisible().catch(() => false)) {
      if (input.beforeProviderRequest && !(await input.beforeProviderRequest())) {
        throw new EventBrowserError("rate_limited", "The event provider request budget is exhausted.");
      }
      renewLease();
      await finalGuestTrigger.click({ timeout: 5_000 }).catch(() => undefined);
      await page.waitForTimeout(300);
      renewLease();
    }
    recheckAuthorizedLumaBoundary({
      html: await visibleDomSnapshot(page),
      canonicalUrl,
      scope: {
        kind: "authorized",
        ownerWorkspace: input.ownerWorkspace,
        runId: input.runId,
        grantId: input.grantId,
      },
      expectedViewerIdentity: viewerIdentity,
      maxParticipants: input.maxParticipants,
    });
    return {
      connectionId: connection.id,
      sessionName: connection.sessionName,
      viewerIdentity,
      participants,
    };
  } finally {
    await browser?.close().catch(() => undefined);
    if (!lease.reused) {
      try {
        releaseSessionLease(lease.leaseId);
      } catch {
        // The lease may already have expired; never stop the borrowed session.
      }
    }
  }
}
