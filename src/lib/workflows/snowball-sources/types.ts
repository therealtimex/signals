export type SnowballSourceProvider =
  | "luma"
  | "x"
  | "linkedin"
  | "facebook"
  | "generic";

export type SnowballSourceKind =
  | "event"
  | "calendar"
  | "post"
  | "profile"
  | "organization"
  | "article"
  | "page"
  | "unknown";

export type SnowballSourceCapabilities = {
  publicRead: boolean;
  signedInRead: boolean;
  participantExpansion: boolean;
};

export type ResolvedSnowballSource = {
  version: 1;
  canonicalUrl: string;
  provider: SnowballSourceProvider;
  kind: SnowballSourceKind;
  classification: {
    basis: "url" | "metadata" | "visible_content" | "fallback";
    confidence: "high" | "medium" | "low";
  };
  capabilities: SnowballSourceCapabilities;
};

export type SnowballSourceFact = {
  label: string;
  value: string;
};

export type SnowballSourceLink = {
  label: string;
  url: string;
};

/** Bounded public evidence. Raw HTML and credential material never cross this boundary. */
export type PublicSnowballSourceEnvelope = {
  version: 1;
  canonicalUrl: string;
  title: string;
  provider: SnowballSourceProvider;
  kind: SnowballSourceKind;
  observedAt: number;
  extractor: string;
  scope: "public";
  facts: SnowballSourceFact[];
  links: SnowballSourceLink[];
};

export type SnowballSourceAccessPlan = {
  mode: "public_only" | "public_and_signed_in";
  signedInRequested: boolean;
  signedInSupported: boolean;
  reason: string | null;
};

export type SnowballSourcePreparation = {
  resolvedSource: ResolvedSnowballSource;
  accessPlan: SnowballSourceAccessPlan;
  publicSource: PublicSnowballSourceEnvelope | null;
  contentItemIds: string[];
  errors: string[];
  partial: boolean;
  eventReportCapability?: {
    token: string;
    expiresAt: number;
    participantCount: number;
  };
};

export type SnowballSourcePreview = Pick<
  SnowballSourcePreparation,
  "resolvedSource" | "accessPlan" | "publicSource" | "errors"
>;
