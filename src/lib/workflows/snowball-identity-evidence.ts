import { randomBytes, timingSafeEqual } from "node:crypto";
import type { Page } from "playwright";
import { getContactById } from "@/lib/db/queries/contacts";
import { getWorkflowRun, listWorkflowRuns, updateWorkflowRun } from "@/lib/db/queries/workflows";
import type { WorkflowRunWithSteps } from "@/lib/db/types";
import {
  getPlatformHomeUrl,
  isLinkedInLoggedOutUrl,
  probeAuthenticatedPlatformIdentity,
  urlMatchesPlatformHost,
  withPlatformBrowserPage,
} from "@/lib/platforms/browser-connection";
import {
  isLinkedInNavbarThumbnailUrl,
  linkedInProfilePhotosCollide,
} from "@/lib/platforms/linkedin/profile-photo-url";
import { normalizePlatformTargetIdentity } from "@/lib/platforms/target-identity";
import { PlatformTargetError } from "@/lib/platforms/target-errors";
import { sha256 } from "@/lib/writing/hash";
import { isNetworkSnowballTemplateConfig } from "@/lib/workflows/network-snowball";
import {
  getNetworkSnowballTargetFromRunConfig,
  renewNetworkSnowballTargetLease,
} from "@/lib/workflows/network-snowball-target";

export const SNOWBALL_IDENTITY_SCOPE_TOKEN_CONFIG_KEY =
  "_snowballIdentityScopeTokenHash";
export const SNOWBALL_IDENTITY_EVIDENCE_RESULT_KEY =
  "_snowballIdentityEvidence";
export const SNOWBALL_IDENTITY_PLATFORM_DATA_KEY =
  "signalsIdentityEvidence";

const EVIDENCE_TTL_SECONDS = 15 * 60;
const MAX_EVIDENCE_RECORDS = 100;

export type SnowballIdentityScopeToken = {
  token: string;
  tokenHash: string;
};

export type LinkedInProfileObservation = {
  finalUrl: string;
  authenticated: boolean;
  visibleName: string;
  headline: string;
  topCardText: string;
  unavailable?: boolean;
  avatarUrl?: string | null;
  sessionViewerAvatarUrl?: string | null;
};

type SnowballIdentityEvidenceRecord = {
  id: string;
  tokenHash: string;
  workflowRunId: string;
  templateId: string | null;
  candidateName: string;
  candidateNameKey: string;
  candidateCompany: string | null;
  candidateTitle: string | null;
  proposedProfileUrl?: string;
  platform: "linkedin";
  platformUserId: string;
  platformHandle: string;
  platformUrl: string;
  displayName: string;
  headline: string | null;
  avatarUrl?: string | null;
  sessionViewerAvatarUrl?: string | null;
  matchedSignals: string[];
  browserSessionName: string;
  pageDigest: string;
  observedAt: number;
  expiresAt: number;
  consumedAt: number | null;
  contactId: string | null;
  identityId: string | null;
};

export type ClaimedSnowballLinkedInEvidence = Omit<
  SnowballIdentityEvidenceRecord,
  "tokenHash"
>;

export type SnowballEvidenceAudit = {
  errors: string[];
  auditedIdentityIds: string[];
};

type SnowballCandidateContext = {
  candidateName: string;
  candidateCompany?: string | null;
  candidateTitle?: string | null;
};

type SnowballCandidateContextMismatch = {
  field: "name" | "company" | "title";
  attestedValue: string;
  candidateValue: string | null;
};

export type SnowballIdentityEvidenceErrorReason =
  | "scope_invalid"
  | "run_not_found"
  | "run_not_active"
  | "run_not_snowball"
  | "browser_target_unavailable"
  | "profile_url_invalid"
  | "profile_not_authenticated"
  | "profile_unavailable"
  | "profile_name_missing"
  | "profile_name_mismatch"
  | "profile_corroboration_missing"
  | "evidence_invalid"
  | "evidence_expired"
  | "evidence_replayed"
  | "evidence_candidate_mismatch"
  | "evidence_run_mismatch"
  | "evidence_template_mismatch";

export class SnowballIdentityEvidenceError extends Error {
  constructor(
    public readonly reason: SnowballIdentityEvidenceErrorReason,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "SnowballIdentityEvidenceError";
  }
}

function parseJsonObject(value: string | null | undefined): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function safeEqualHash(token: string, expectedHash: unknown): boolean {
  if (typeof expectedHash !== "string" || !expectedHash) return false;
  const actual = Buffer.from(sha256(token), "utf8");
  const expected = Buffer.from(expectedHash, "utf8");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function mintSnowballIdentityScopeToken(
  workflowRunId: string,
): SnowballIdentityScopeToken {
  const token = `${workflowRunId}.${randomBytes(24).toString("base64url")}`;
  return { token, tokenHash: sha256(token) };
}

function parseScopeToken(value: unknown): { workflowRunId: string; token: string } | null {
  if (typeof value !== "string") return null;
  const separator = value.lastIndexOf(".");
  if (separator <= 0 || separator === value.length - 1) return null;
  return { workflowRunId: value.slice(0, separator), token: value };
}

function parseEvidenceToken(
  value: unknown,
): { workflowRunId: string; evidenceId: string; token: string } | null {
  if (typeof value !== "string") return null;
  const secretSeparator = value.lastIndexOf(".");
  if (secretSeparator <= 0 || secretSeparator === value.length - 1) return null;
  const evidenceSeparator = value.lastIndexOf(".", secretSeparator - 1);
  if (evidenceSeparator <= 0 || evidenceSeparator === secretSeparator - 1) return null;
  return {
    workflowRunId: value.slice(0, evidenceSeparator),
    evidenceId: value.slice(evidenceSeparator + 1, secretSeparator),
    token: value,
  };
}

function normalizeHumanText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function findCandidateContextMismatch(
  evidence: Pick<
    SnowballIdentityEvidenceRecord,
    "candidateName" | "candidateNameKey" | "candidateCompany" | "candidateTitle"
  >,
  candidate: SnowballCandidateContext,
  options: { allowMissingCorroboratedFields?: boolean } = {},
): SnowballCandidateContextMismatch | null {
  if (normalizeHumanText(candidate.candidateName) !== evidence.candidateNameKey) {
    return {
      field: "name",
      attestedValue: evidence.candidateName,
      candidateValue: candidate.candidateName.trim() || null,
    };
  }

  for (const [field, attestedValue, candidateValue] of [
    ["company", evidence.candidateCompany, candidate.candidateCompany],
    ["title", evidence.candidateTitle, candidate.candidateTitle],
  ] as const) {
    if (!attestedValue) continue;
    const normalizedCandidate = normalizeHumanText(candidateValue ?? "");
    if (options.allowMissingCorroboratedFields && !normalizedCandidate) continue;
    if (normalizedCandidate !== normalizeHumanText(attestedValue)) {
      return {
        field,
        attestedValue,
        candidateValue: candidateValue?.trim() || null,
      };
    }
  }
  return null;
}

export function assertSnowballLinkedInEvidenceMatchesCandidate(
  evidence: ClaimedSnowballLinkedInEvidence,
  candidate: SnowballCandidateContext,
  options: { allowMissingCorroboratedFields?: boolean } = {},
): void {
  const mismatch = findCandidateContextMismatch(evidence, candidate, options);
  if (!mismatch) return;
  throw new SnowballIdentityEvidenceError(
    "evidence_candidate_mismatch",
    `LinkedIn identity evidence cannot be transferred to a candidate with a different ${mismatch.field}.`,
    {
      evidenceId: evidence.id,
      candidateField: mismatch.field,
      attestedValue: mismatch.attestedValue,
      candidateValue: mismatch.candidateValue,
    },
  );
}

const COMPANY_SUFFIXES = new Set([
  "co",
  "company",
  "corp",
  "corporation",
  "inc",
  "incorporated",
  "llc",
  "ltd",
  "limited",
]);

function corroboratingSignalMatches(signal: string, observedText: string): boolean {
  const normalizedSignal = normalizeHumanText(signal);
  const normalizedObserved = normalizeHumanText(observedText);
  if (!normalizedSignal || !normalizedObserved) return false;
  if (normalizedObserved.includes(normalizedSignal)) return true;
  const significantTokens = normalizedSignal
    .split(" ")
    .filter((token) => token.length > 1 && !COMPANY_SUFFIXES.has(token));
  const observedTokens = new Set(normalizedObserved.split(" "));
  return significantTokens.length > 0 && significantTokens.every((token) =>
    observedTokens.has(token),
  );
}

function canonicalLinkedInProfile(rawUrl: string): {
  platformUserId: string;
  platformHandle: string;
  platformUrl: string;
} | null {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" || !urlMatchesPlatformHost(rawUrl, "linkedin.com")) {
      return null;
    }
    const match = /^\/in\/([A-Za-z0-9][A-Za-z0-9_-]*)\/?$/.exec(url.pathname);
    if (!match) return null;
    const vanity = match[1];
    return {
      platformUserId: vanity,
      platformHandle: vanity,
      platformUrl: `https://www.linkedin.com/in/${vanity}/`,
    };
  } catch {
    return null;
  }
}

function readEvidenceLedger(run: Pick<WorkflowRunWithSteps, "result">): SnowballIdentityEvidenceRecord[] {
  const raw = parseJsonObject(run.result)[SNOWBALL_IDENTITY_EVIDENCE_RESULT_KEY];
  if (!Array.isArray(raw)) return [];
  return raw.filter((record): record is SnowballIdentityEvidenceRecord => {
    if (!record || typeof record !== "object" || Array.isArray(record)) return false;
    const value = record as Partial<SnowballIdentityEvidenceRecord>;
    return (
      typeof value.id === "string" &&
      typeof value.tokenHash === "string" &&
      typeof value.workflowRunId === "string" &&
      value.platform === "linkedin" &&
      typeof value.platformUserId === "string" &&
      typeof value.platformUrl === "string"
    );
  });
}

function writeEvidenceLedger(
  run: Pick<WorkflowRunWithSteps, "id" | "result">,
  ledger: SnowballIdentityEvidenceRecord[],
): void {
  updateWorkflowRun(run.id, {
    result: JSON.stringify({
      ...parseJsonObject(getWorkflowRun(run.id)?.result ?? run.result),
      [SNOWBALL_IDENTITY_EVIDENCE_RESULT_KEY]: ledger.slice(-MAX_EVIDENCE_RECORDS),
    }),
  });
}

/**
 * Read only identity evidence that is visibly attached to the canonical profile
 * currently open in LinkedIn. Keep this function self-contained because
 * Playwright serializes it into the browser context.
 */
export function extractLinkedInProfileDomObservation(): Pick<
  LinkedInProfileObservation,
  "visibleName" | "headline" | "topCardText" | "unavailable" | "avatarUrl" | "sessionViewerAvatarUrl"
> {
  const text = (element: Element | null): string =>
    element?.textContent?.replace(/\s+/g, " ").trim() ?? "";
  const firstText = (selectors: string[]): string => {
    for (const selector of selectors) {
      const value = text(document.querySelector(selector));
      if (value) return value;
    }
    return "";
  };
  const linkedInProfilePath = (value: string): string => {
    try {
      const url = new URL(value, window.location.href);
      if (
        url.hostname.toLocaleLowerCase("en-US") !==
        window.location.hostname.toLocaleLowerCase("en-US")
      ) {
        return "";
      }
      const match = url.pathname.match(/^\/in\/([^/]+)/i);
      return match ? `/in/${decodeURIComponent(match[1]).toLocaleLowerCase("en-US")}` : "";
    } catch {
      return "";
    }
  };
  const isInsideAuthenticatedNav = (element: Element | null): boolean => {
    for (let node: Element | null = element; node; node = node.parentElement) {
      if (
        node.tagName === "NAV" ||
        node.classList.contains("global-nav") ||
        node.classList.contains("global-nav__me")
      ) {
        return true;
      }
    }
    return false;
  };
  const absoluteUrl = (value: string): string => {
    try {
      return new URL(value, window.location.href).toString();
    } catch {
      return "";
    }
  };
  const imageCandidateUrls = (img: HTMLImageElement): string[] => {
    const urls: string[] = [];
    for (const raw of [img.currentSrc, img.src, img.getAttribute("data-delayed-url")]) {
      if (raw) urls.push(absoluteUrl(raw));
    }
    const srcset = img.getAttribute("srcset") ?? img.getAttribute("data-delayed-srcset") ?? "";
    for (const part of srcset.split(",")) {
      const candidate = part.trim().split(/\s+/)[0];
      if (candidate) urls.push(absoluteUrl(candidate));
    }
    return urls.filter(Boolean);
  };
  const isProfilePhotoUrl = (url: string): boolean =>
    /media\.licdn\.com/i.test(url) && /profile-(?:displayphoto|framedphoto)/i.test(url);
  const isNavbarThumb = (url: string): boolean =>
    /profile-(?:displayphoto|framedphoto)-(?:shrink|scale|crop)_(?:50_50|100_100)/i.test(url);
  const photoScore = (url: string): number => {
    const lower = url.toLowerCase();
    const dim = lower.match(/(?:shrink|crop|scale)_(\d+)_(\d+)/);
    const size = dim ? Number(dim[1]) : 150;
    return lower.includes("profile-framedphoto") ? size + 50 : size;
  };
  const pickBestPhoto = (urls: string[], allowNavbarThumbs = false): string | null => {
    let best: string | null = null;
    let bestScore = -1;
    for (const url of urls) {
      if (!isProfilePhotoUrl(url)) continue;
      if (!allowNavbarThumbs && isNavbarThumb(url)) continue;
      const score = photoScore(url);
      if (score > bestScore) {
        best = url;
        bestScore = score;
      }
    }
    return best;
  };

  const main = document.querySelector("main");
  const currentProfilePath = linkedInProfilePath(window.location.href);
  const matchingProfileAnchors = main && currentProfilePath
    ? Array.from(main.querySelectorAll<HTMLAnchorElement>("a[href]")).filter(
        (anchor) => linkedInProfilePath(anchor.href) === currentProfilePath,
      )
    : [];
  const profileAnchor = matchingProfileAnchors.find(
    (anchor) =>
      anchor.getAttribute("componentkey")?.startsWith("ProfileVerificationTriggerRef-") &&
      text(anchor.querySelector("h1,h2,h3")),
  ) ?? matchingProfileAnchors.find((anchor) => text(anchor.querySelector("h1,h2,h3"))) ?? null;

  let structuralTopCard: Element | null = null;
  let structuralParagraphs: Element[] = [];
  for (
    let candidate: Element | null = profileAnchor;
    candidate && candidate !== main;
    candidate = candidate.parentElement
  ) {
    const directParagraphs = Array.from(candidate.children).filter(
      (child) => child.tagName === "P" && text(child),
    );
    // The current LinkedIn top card has separate direct paragraphs for the
    // headline and affiliation. Requiring both avoids mistaking a connection
    // degree badge (for example, "· 2nd") for the headline.
    if (directParagraphs.length >= 2) {
      structuralTopCard = candidate;
      structuralParagraphs = directParagraphs;
      break;
    }
  }

  const visibleName =
    text(profileAnchor?.querySelector("h1,h2,h3") ?? profileAnchor) ||
    firstText([
      "main h1",
      "h1.text-heading-xlarge",
      '[data-anonymize="person-name"]',
    ]);
  const headline = text(structuralParagraphs[0] ?? null) || firstText([
    "main .text-body-medium.break-words",
    ".pv-text-details__left-panel .text-body-medium",
    '[data-generated-suggestion-target*="headline"]',
  ]);
  const topCardText = (text(structuralTopCard) || firstText([
    "main section:first-of-type",
    ".pv-top-card",
    ".scaffold-layout__main",
  ])).slice(0, 2_000);
  const pageText = text(document.body).slice(0, 8_000).toLocaleLowerCase();
  const unavailable = [
    "this page doesn’t exist",
    "this page doesn't exist",
    "profile not found",
    "page not found",
  ].some((marker) => pageText.includes(marker));

  const sessionViewerUrls: string[] = [];
  for (const img of document.querySelectorAll<HTMLImageElement>(
    "nav img, header img, .global-nav img, .global-nav__me img",
  )) {
    sessionViewerUrls.push(...imageCandidateUrls(img));
  }
  const sessionViewerAvatarUrl = pickBestPhoto(sessionViewerUrls, true);

  const enclosingProfilePath = (element: Element | null): string => {
    for (let node: Element | null = element; node && node !== main; node = node.parentElement) {
      if (node.tagName !== "A") continue;
      const path = linkedInProfilePath((node as HTMLAnchorElement).href);
      if (path) return path;
    }
    return "";
  };
  const belongsToCurrentProfile = (element: Element): boolean => {
    const enclosed = enclosingProfilePath(element);
    return !enclosed || enclosed === currentProfilePath;
  };
  const topCardUrls: string[] = [];
  const collectPhotoUrlsFrom = (root: Element | null): void => {
    if (!root) return;
    const images = root.tagName === "IMG"
      ? [root as HTMLImageElement]
      : Array.from(root.querySelectorAll<HTMLImageElement>("img"));
    for (const img of images) {
      if (isInsideAuthenticatedNav(img)) continue;
      if (!belongsToCurrentProfile(img)) continue;
      topCardUrls.push(...imageCandidateUrls(img));
    }
  };
  const findKeyedTopCard = (start: Element | null): Element | null => {
    for (let node: Element | null = start; node && node !== main; node = node.parentElement) {
      const keyedCandidates: Element[] = [];
      if (node.getAttribute("componentkey") === "topcard") keyedCandidates.push(node);
      keyedCandidates.push(...Array.from(node.querySelectorAll('[componentkey="topcard"]')));
      for (const keyed of keyedCandidates) {
        if (belongsToCurrentProfile(keyed)) return keyed;
      }
    }
    return null;
  };

  // Proven photo roots only. Do not scan a wide ancestor of the text card:
  // the same SDUI section also holds mutual-connection facepile chips and
  // adjacent recommendation photos that belong to other profiles.
  collectPhotoUrlsFrom(document.querySelector("main .pv-top-card"));
  collectPhotoUrlsFrom(document.querySelector('main [data-view-name="profile-card"]'));
  for (const img of document.querySelectorAll<HTMLImageElement>(
    "main img.pv-top-card-profile-picture__image",
  )) {
    collectPhotoUrlsFrom(img);
  }
  collectPhotoUrlsFrom(structuralTopCard);
  collectPhotoUrlsFrom(
    findKeyedTopCard(structuralTopCard) ?? findKeyedTopCard(profileAnchor),
  );
  const avatarUrl = pickBestPhoto(topCardUrls);

  return { visibleName, headline, topCardText, unavailable, avatarUrl, sessionViewerAvatarUrl };
}

async function observeLinkedInProfile(
  proposedProfileUrl: string,
  sessionName: string,
  expectedHandle: string,
): Promise<LinkedInProfileObservation> {
  return withPlatformBrowserPage("linkedin", sessionName, async (page: Page) => {
    await page.goto(getPlatformHomeUrl("linkedin"), {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    const liveIdentity = await probeAuthenticatedPlatformIdentity("linkedin", page, 8_000);
    const expectedIdentity = normalizePlatformTargetIdentity("linkedin", expectedHandle);
    const observedIdentity = normalizePlatformTargetIdentity(
      "linkedin",
      liveIdentity.detectedHandle,
    );
    const authenticated = Boolean(
      liveIdentity.loggedIn &&
      expectedIdentity.handleNormalized &&
      expectedIdentity.handleNormalized === observedIdentity.handleNormalized,
    );
    if (!authenticated) {
      return {
        finalUrl: page.url(),
        authenticated: false,
        visibleName: "",
        headline: "",
        topCardText: "",
        avatarUrl: null,
        sessionViewerAvatarUrl: null,
      };
    }
    await page.goto(proposedProfileUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await page.waitForTimeout(500);
    const extracted = await page.evaluate(extractLinkedInProfileDomObservation);
    return {
      finalUrl: page.url(),
      authenticated,
      ...extracted,
    };
  });
}

function validateObservation(input: {
  candidateName: string;
  candidateCompany?: string;
  candidateTitle?: string;
  observation: LinkedInProfileObservation;
}): {
  identity: NonNullable<ReturnType<typeof canonicalLinkedInProfile>>;
  matchedSignals: string[];
} {
  const { observation } = input;
  const identity = canonicalLinkedInProfile(observation.finalUrl);
  if (isLinkedInLoggedOutUrl(observation.finalUrl) || !observation.authenticated) {
    throw new SnowballIdentityEvidenceError(
      "profile_not_authenticated",
      "LinkedIn identity attestation requires an authenticated profile page, not a login, checkpoint, or auth-wall page.",
      { finalUrl: observation.finalUrl },
    );
  }
  if (!identity) {
    throw new SnowballIdentityEvidenceError(
      "profile_url_invalid",
      "The browser did not finish on a canonical LinkedIn /in/ profile URL.",
      { finalUrl: observation.finalUrl },
    );
  }
  if (observation.unavailable) {
    throw new SnowballIdentityEvidenceError(
      "profile_unavailable",
      "LinkedIn reported that the proposed profile is unavailable.",
      { finalUrl: observation.finalUrl },
    );
  }
  if (!normalizeHumanText(observation.visibleName)) {
    throw new SnowballIdentityEvidenceError(
      "profile_name_missing",
      "No visible profile name was found in the LinkedIn top card.",
      { finalUrl: observation.finalUrl },
    );
  }
  if (normalizeHumanText(input.candidateName) !== normalizeHumanText(observation.visibleName)) {
    throw new SnowballIdentityEvidenceError(
      "profile_name_mismatch",
      `LinkedIn profile name "${observation.visibleName}" does not match candidate "${input.candidateName}".`,
      { finalUrl: observation.finalUrl, observedName: observation.visibleName },
    );
  }

  const observedText = `${observation.headline} ${observation.topCardText}`;
  const matchedSignals: string[] = [];
  if (input.candidateCompany && corroboratingSignalMatches(input.candidateCompany, observedText)) {
    matchedSignals.push(`company:${input.candidateCompany.trim()}`);
  }
  if (input.candidateTitle && corroboratingSignalMatches(input.candidateTitle, observedText)) {
    matchedSignals.push(`title:${input.candidateTitle.trim()}`);
  }
  if (matchedSignals.length === 0) {
    throw new SnowballIdentityEvidenceError(
      "profile_corroboration_missing",
      "The LinkedIn top card did not corroborate the candidate company or role.",
      {
        finalUrl: observation.finalUrl,
        candidateCompany: input.candidateCompany ?? null,
        candidateTitle: input.candidateTitle ?? null,
      },
    );
  }
  return { identity, matchedSignals };
}

export async function attestSnowballLinkedInIdentity(
  input: {
    snowballScopeToken: string;
    candidateName: string;
    candidateCompany?: string;
    candidateTitle?: string;
    profileUrl: string;
  },
  options: {
    observe?: (
      profileUrl: string,
      sessionName: string,
      expectedHandle: string,
    ) => Promise<LinkedInProfileObservation>;
    now?: () => number;
  } = {},
): Promise<{
  identityEvidenceToken: string;
  workflowRunId: string;
  templateId: string | null;
  platform: "linkedin";
  platformUserId: string;
  platformHandle: string;
  platformUrl: string;
  displayName: string;
  headline: string | null;
  avatarUrl: string | null;
  matchedSignals: string[];
  observedAt: number;
  expiresAt: number;
}> {
  if (!canonicalLinkedInProfile(input.profileUrl)) {
    throw new SnowballIdentityEvidenceError(
      "profile_url_invalid",
      "Proposed LinkedIn identity must be an https://linkedin.com/in/... profile URL.",
      { profileUrl: input.profileUrl },
    );
  }
  const run = resolveSnowballIdentityScope(input.snowballScopeToken);

  const browserTarget = getNetworkSnowballTargetFromRunConfig(run.config);
  const expectedHandle = browserTarget?.verifiedHandle ?? browserTarget?.expectedHandle;
  if (!browserTarget || browserTarget.platform !== "linkedin" || !expectedHandle) {
    throw new SnowballIdentityEvidenceError(
      "browser_target_unavailable",
      "LinkedIn identity attestation requires the server-bound authenticated LinkedIn browser target for this run.",
    );
  }
  try {
    renewNetworkSnowballTargetLease(browserTarget, run.id);
  } catch (error) {
    if (!(error instanceof PlatformTargetError)) throw error;
    throw new SnowballIdentityEvidenceError(
      "browser_target_unavailable",
      "The server-bound LinkedIn browser-session lease is no longer current. Restart Network Snowball to obtain a fresh authenticated session.",
      { code: error.code, ...(error.details ?? {}) },
    );
  }

  const observe = options.observe ?? observeLinkedInProfile;
  const observation = await observe(input.profileUrl, browserTarget.sessionName, expectedHandle);
  const { identity, matchedSignals } = validateObservation({
    candidateName: input.candidateName,
    candidateCompany: input.candidateCompany,
    candidateTitle: input.candidateTitle,
    observation,
  });
  const now = options.now?.() ?? Math.floor(Date.now() / 1_000);
  const evidenceId = randomBytes(12).toString("base64url");
  const identityEvidenceToken = `${run.id}.${evidenceId}.${randomBytes(24).toString("base64url")}`;
  const sessionViewerAvatarUrl = observation.sessionViewerAvatarUrl?.trim() || null;
  const avatarUrl = sanitizeAttestedLinkedInAvatarUrl(
    observation.avatarUrl,
    sessionViewerAvatarUrl,
  );
  const record: SnowballIdentityEvidenceRecord = {
    id: evidenceId,
    tokenHash: sha256(identityEvidenceToken),
    workflowRunId: run.id,
    templateId: run.templateId ?? null,
    candidateName: input.candidateName.trim(),
    candidateNameKey: normalizeHumanText(input.candidateName),
    candidateCompany: input.candidateCompany?.trim() || null,
    candidateTitle: input.candidateTitle?.trim() || null,
    proposedProfileUrl: input.profileUrl,
    platform: "linkedin",
    ...identity,
    displayName: observation.visibleName.trim(),
    headline: observation.headline.trim() || null,
    avatarUrl,
    sessionViewerAvatarUrl,
    matchedSignals,
    browserSessionName: browserTarget.sessionName,
    pageDigest: sha256(JSON.stringify({
      finalUrl: identity.platformUrl,
      visibleName: observation.visibleName,
      headline: observation.headline,
      topCardText: observation.topCardText,
      avatarUrl,
    })),
    observedAt: now,
    expiresAt: now + EVIDENCE_TTL_SECONDS,
    consumedAt: null,
    contactId: null,
    identityId: null,
  };
  writeEvidenceLedger(run, [...readEvidenceLedger(run), record]);

  return {
    identityEvidenceToken,
    workflowRunId: run.id,
    templateId: run.templateId ?? null,
    platform: "linkedin",
    platformUserId: record.platformUserId,
    platformHandle: record.platformHandle,
    platformUrl: record.platformUrl,
    displayName: record.displayName,
    headline: record.headline,
    avatarUrl: record.avatarUrl ?? null,
    matchedSignals,
    observedAt: record.observedAt,
    expiresAt: record.expiresAt,
  };
}

export function resolveSnowballIdentityScope(
  snowballScopeToken: string,
): WorkflowRunWithSteps {
  const parsedScope = parseScopeToken(snowballScopeToken);
  if (!parsedScope) {
    throw new SnowballIdentityEvidenceError(
      "scope_invalid",
      "Snowball identity scope token is malformed.",
    );
  }
  const run = getWorkflowRun(parsedScope.workflowRunId);
  if (!run) {
    throw new SnowballIdentityEvidenceError("run_not_found", "Snowball workflow run was not found.");
  }
  const config = parseJsonObject(run.config);
  if (!isNetworkSnowballTemplateConfig(config)) {
    throw new SnowballIdentityEvidenceError(
      "run_not_snowball",
      "Identity attestation scope is not bound to a Network Snowball run.",
    );
  }
  if (run.status !== "running") {
    throw new SnowballIdentityEvidenceError(
      "run_not_active",
      "Identity attestation is only available while the Network Snowball run is active.",
    );
  }
  if (!safeEqualHash(snowballScopeToken, config[SNOWBALL_IDENTITY_SCOPE_TOKEN_CONFIG_KEY])) {
    throw new SnowballIdentityEvidenceError(
      "scope_invalid",
      "Snowball identity scope token does not match this dispatch.",
    );
  }
  return run;
}

export function isRunningNetworkSnowballRun(workflowRunId: string | null | undefined): boolean {
  if (!workflowRunId) return false;
  const run = getWorkflowRun(workflowRunId);
  return Boolean(
    run?.status === "running" &&
    isNetworkSnowballTemplateConfig(parseJsonObject(run.config)),
  );
}

/**
 * Whether an attributed contact write belongs to a live LinkedIn-backed
 * Snowball run. The browser target is server-owned, so callers cannot bypass
 * the gate by omitting `platform` from a contact payload.
 */
export function isRunningLinkedInNetworkSnowballRun(
  workflowRunId: string | null | undefined,
): boolean {
  if (!workflowRunId) return false;
  const run = getWorkflowRun(workflowRunId);
  return Boolean(
    run?.status === "running" &&
    isNetworkSnowballTemplateConfig(parseJsonObject(run.config)) &&
    getNetworkSnowballTargetFromRunConfig(run.config)?.platform === "linkedin",
  );
}

export function hasRunningNetworkSnowballRun(): boolean {
  return listWorkflowRuns({ status: "running", pageSize: 100 }).data.some((run) =>
    isNetworkSnowballTemplateConfig(parseJsonObject(run.config)),
  );
}

export function claimSnowballLinkedInEvidence(input: {
  identityEvidenceToken: string;
  candidateName: string;
  candidateCompany?: string | null;
  candidateTitle?: string | null;
  workflowRunId?: string | null;
  templateId?: string | null;
  now?: number;
}): ClaimedSnowballLinkedInEvidence {
  const parsed = parseEvidenceToken(input.identityEvidenceToken);
  if (!parsed) {
    throw new SnowballIdentityEvidenceError(
      "evidence_invalid",
      "LinkedIn identity evidence token is malformed.",
    );
  }
  if (input.workflowRunId && input.workflowRunId !== parsed.workflowRunId) {
    throw new SnowballIdentityEvidenceError(
      "evidence_run_mismatch",
      "LinkedIn identity evidence is bound to a different workflow run.",
    );
  }
  const run = getWorkflowRun(parsed.workflowRunId);
  if (!run) {
    throw new SnowballIdentityEvidenceError("run_not_found", "Snowball workflow run was not found.");
  }
  if (run.status !== "running") {
    throw new SnowballIdentityEvidenceError(
      "run_not_active",
      "LinkedIn identity evidence can only be consumed while its Snowball run is active.",
    );
  }
  if (!isNetworkSnowballTemplateConfig(parseJsonObject(run.config))) {
    throw new SnowballIdentityEvidenceError(
      "run_not_snowball",
      "LinkedIn identity evidence is not bound to a Network Snowball run.",
    );
  }
  if (input.templateId && input.templateId !== run.templateId) {
    throw new SnowballIdentityEvidenceError(
      "evidence_template_mismatch",
      "LinkedIn identity evidence is bound to a different workflow template.",
    );
  }

  const ledger = readEvidenceLedger(run);
  const index = ledger.findIndex((record) => record.id === parsed.evidenceId);
  const record = index >= 0 ? ledger[index] : undefined;
  if (!record || !safeEqualHash(parsed.token, record.tokenHash)) {
    throw new SnowballIdentityEvidenceError(
      "evidence_invalid",
      "LinkedIn identity evidence token is not recognized by this workflow run.",
    );
  }
  if (record.consumedAt !== null) {
    throw new SnowballIdentityEvidenceError(
      "evidence_replayed",
      "LinkedIn identity evidence token has already been consumed.",
      { evidenceId: record.id, identityId: record.identityId },
    );
  }
  const now = input.now ?? Math.floor(Date.now() / 1_000);
  if (record.expiresAt < now) {
    throw new SnowballIdentityEvidenceError(
      "evidence_expired",
      "LinkedIn identity evidence token has expired; inspect the live profile again.",
      { evidenceId: record.id, expiresAt: record.expiresAt },
    );
  }
  assertSnowballLinkedInEvidenceMatchesCandidate(record, input);

  const consumed = { ...record, consumedAt: now };
  ledger[index] = consumed;
  writeEvidenceLedger(run, ledger);
  const { tokenHash: _tokenHash, ...claim } = consumed;
  return claim;
}

export function bindSnowballLinkedInEvidence(
  evidence: ClaimedSnowballLinkedInEvidence,
  contactId: string,
  identityId: string,
): void {
  const run = getWorkflowRun(evidence.workflowRunId);
  if (!run) {
    throw new SnowballIdentityEvidenceError("run_not_found", "Snowball workflow run was not found.");
  }
  const ledger = readEvidenceLedger(run);
  const index = ledger.findIndex((record) => record.id === evidence.id);
  const record = index >= 0 ? ledger[index] : undefined;
  if (!record || record.consumedAt === null) {
    throw new SnowballIdentityEvidenceError(
      "evidence_invalid",
      "Consumed LinkedIn identity evidence could not be bound to the persisted identity.",
    );
  }
  if (
    (record.contactId && record.contactId !== contactId) ||
    (record.identityId && record.identityId !== identityId)
  ) {
    throw new SnowballIdentityEvidenceError(
      "evidence_replayed",
      "LinkedIn identity evidence is already bound to another identity.",
      { evidenceId: record.id, contactId: record.contactId, identityId: record.identityId },
    );
  }
  ledger[index] = { ...record, contactId, identityId };
  writeEvidenceLedger(run, ledger);
}

export function snowballEvidencePlatformData(
  evidence: ClaimedSnowballLinkedInEvidence,
  callerData?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...(callerData ?? {}),
    [SNOWBALL_IDENTITY_PLATFORM_DATA_KEY]: {
      version: 1,
      evidenceId: evidence.id,
      workflowRunId: evidence.workflowRunId,
      browserSessionName: evidence.browserSessionName,
      observedAt: evidence.observedAt,
      pageDigest: evidence.pageDigest,
      matchedSignals: evidence.matchedSignals,
    },
  };
}

function sanitizeAttestedLinkedInAvatarUrl(
  avatarUrl: string | null | undefined,
  sessionViewerAvatarUrl?: string | null,
): string | null {
  const trimmed = avatarUrl?.trim() || null;
  if (!trimmed || isLinkedInNavbarThumbnailUrl(trimmed)) return null;
  if (
    sessionViewerAvatarUrl &&
    linkedInProfilePhotosCollide(trimmed, sessionViewerAvatarUrl)
  ) {
    return null;
  }
  return trimmed;
}

/**
 * Bind the avatar from browser evidence. Caller-supplied LinkedIn CDN URLs are untrusted:
 * navbar thumbs and the authenticated session viewer's photo are dropped. A server-extracted
 * top-card URL wins only when it also survives the session-viewer asset blacklist.
 */
export function resolveSnowballLinkedInAvatarUrl(
  evidence: Pick<ClaimedSnowballLinkedInEvidence, "avatarUrl" | "sessionViewerAvatarUrl">,
  candidateAvatarUrl: string | null | undefined,
): string | undefined {
  const attested = sanitizeAttestedLinkedInAvatarUrl(
    evidence.avatarUrl ?? null,
    evidence.sessionViewerAvatarUrl,
  );
  if (attested) return attested;
  return sanitizeAttestedLinkedInAvatarUrl(
    candidateAvatarUrl,
    evidence.sessionViewerAvatarUrl,
  ) ?? undefined;
}

export function assertSnowballAvatarMatchesEvidence(
  evidence: ClaimedSnowballLinkedInEvidence,
  avatarUrl: string | null | undefined,
): void {
  if (!avatarUrl) return;
  try {
    const url = new URL(avatarUrl);
    if (url.hostname.toLowerCase() !== "unavatar.io") return;
    const match = /^\/linkedin\/user:([^/?#]+)\/?$/i.exec(url.pathname);
    if (!match || match[1].toLocaleLowerCase("en-US") !== evidence.platformUserId.toLocaleLowerCase("en-US")) {
      throw new SnowballIdentityEvidenceError(
        "evidence_candidate_mismatch",
        "A LinkedIn Unavatar URL must use the exact profile slug derived from browser evidence.",
        { attestedPlatformUserId: evidence.platformUserId, avatarUrl },
      );
    }
  } catch (error) {
    if (error instanceof SnowballIdentityEvidenceError) throw error;
    // The shared avatar validator reports malformed/non-http URLs. This helper only owns
    // evidence-to-resolver binding and therefore leaves other validation to that choke point.
  }
}

export function auditSnowballLinkedInIdentityEvidence(
  run: WorkflowRunWithSteps,
  contactIds: string[],
): SnowballEvidenceAudit {
  if (!isNetworkSnowballTemplateConfig(parseJsonObject(run.config))) {
    return { errors: [], auditedIdentityIds: [] };
  }
  const ledger = readEvidenceLedger(run);
  const ledgerById = new Map(ledger.map((record) => [record.id, record]));
  const errors: string[] = [];
  const auditedIdentityIds: string[] = [];
  const runStartedAt = run.startedAt ?? run.createdAt;
  const requiresAttestedContact =
    getNetworkSnowballTargetFromRunConfig(run.config)?.platform === "linkedin";

  for (const contactId of contactIds) {
    const contact = getContactById(contactId);
    if (!contact) continue;
    const linkedInIdentities = contact.identities.filter(
      (identity) => identity.platform === "linkedin",
    );
    if (requiresAttestedContact && linkedInIdentities.length === 0) {
      errors.push(`snowball_linkedin_identity_missing:${contact.id}`);
      continue;
    }

    let validAttestedIdentity = false;
    for (const identity of linkedInIdentities) {
      const createdByRun = contact.createdWorkflowRunId === run.id;
      const identityCreatedDuringRun = identity.createdAt >= runStartedAt;
      if (!requiresAttestedContact && !createdByRun && !identityCreatedDuringRun) continue;
      auditedIdentityIds.push(identity.id);
      const platformData = parseJsonObject(identity.platformData);
      const marker = platformData[SNOWBALL_IDENTITY_PLATFORM_DATA_KEY];
      const markerObject = marker && typeof marker === "object" && !Array.isArray(marker)
        ? (marker as Record<string, unknown>)
        : null;
      const evidenceId = typeof markerObject?.evidenceId === "string"
        ? markerObject.evidenceId
        : null;
      const record = evidenceId
        ? ledgerById.get(evidenceId)
        : undefined;
      const candidateContextMatches = Boolean(
        record &&
        !findCandidateContextMismatch(record, {
          candidateName: contact.name,
          candidateCompany: contact.company ?? contact.currentEmployment?.orgName,
          candidateTitle: contact.title ?? contact.currentEmployment?.title,
        }),
      );
      const valid = Boolean(
        record &&
        candidateContextMatches &&
        record.consumedAt !== null &&
        record.workflowRunId === run.id &&
        record.contactId === contact.id &&
        record.identityId === identity.id &&
        record.platformUserId === identity.platformUserId &&
        record.platformUrl === identity.platformUrl &&
        markerObject?.workflowRunId === run.id,
      );
      if (valid) {
        validAttestedIdentity = true;
      } else if (!requiresAttestedContact) {
        errors.push(`snowball_linkedin_identity_evidence_missing:${identity.id}`);
      }
    }

    if (requiresAttestedContact && !validAttestedIdentity) {
      errors.push(`snowball_linkedin_identity_evidence_missing:${contact.id}`);
    }
  }

  return { errors, auditedIdentityIds };
}
