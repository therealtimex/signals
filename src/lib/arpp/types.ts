export type ArppVisibility = "internal" | "public";

export type ArppConformanceLevel = "L0" | "L1" | "L2" | "L3";
export type ArooConformanceLevel = "O0" | "O1" | "O2" | "O3";

export type ArppProjectionOptions = {
  visibility?: ArppVisibility;
  baseIriPrefix?: string;
  canonicalPersonIri?: string;
  canonicalUrl?: string;
  publisherIri?: string;
  includeEmail?: boolean;
};

export type ArooProjectionOptions = {
  visibility?: ArppVisibility;
  baseIriPrefix?: string;
  canonicalOrgIri?: string;
  canonicalUrl?: string;
};

export type ArppIdentifier = {
  scheme: string;
  value: string;
  iri: string;
};

export type ArppProfileVerification = {
  method?: string;
  status: "claimed" | "challenge-passed" | "signed" | "unknown";
  checkedAt?: string;
};

export type ArppProfile = {
  network: string;
  url: string;
  username?: string | null;
  verification?: ArppProfileVerification;
};

export type ArppOrganizationRef = {
  "@type": "Organization";
  name: string;
  url?: string | null;
  sameAs?: string[];
};

export type ArppExperience = {
  id: string;
  role: string | null;
  employmentType?: string;
  organization: ArppOrganizationRef;
  timePeriod: {
    start: string | null;
    end: string | null;
    current: boolean;
  };
};

export type ArppPersonDocument = {
  $schema: string;
  "@context": string[];
  "@type": "Person";
  "@id": string;
  id: string;
  spec: "arpp/1.1";
  meta: {
    version: string;
    revision: number;
    generatedAt: string;
    lastUpdated: string;
    visibility: ArppVisibility;
    canonicalUrl?: string;
    publisher?: string;
  };
  identity: {
    fullName: string;
    givenName?: string | null;
    familyName?: string | null;
    preferredName?: string | null;
    biography?: string | null;
    disambiguatingDescription?: string | null;
    jobTitle?: string | null;
    url?: string | null;
    email?: string | null;
    image?: { "@type": "ImageObject"; url: string };
    contact?: {
      preferredChannel?: string;
      url?: string | null;
    };
  };
  identifiers: ArppIdentifier[];
  sameAs: string[];
  profiles: ArppProfile[];
  competencies: [];
  experience: ArppExperience[];
  education: [];
  credentials: [];
  works: [];
  knowsAbout: [];
  signals: {
    contactId: string;
    enrichmentScore: number;
    conformance: ArppConformanceLevel;
  };
};

export type ArooDomain = {
  domain: string;
  kind: "primary" | "alias";
  verified: boolean;
};

export type ArooOrganizationDocument = {
  $schema: string;
  "@context": string[];
  "@type": "Organization";
  "@id": string;
  id: string;
  spec: "aroo/1.0";
  meta: {
    version: string;
    revision: number;
    generatedAt: string;
    lastUpdated: string;
    visibility: ArppVisibility;
    canonicalUrl?: string;
  };
  identity: {
    name: string;
    legalName?: string | null;
    description?: string | null;
    url?: string | null;
    industry?: string | null;
    organizationType?: string;
    logo?: { "@type": "ImageObject"; url: string };
    numberOfEmployees?: { min: number; max: number | null; unitText: string };
    location?: { type: string; addressLocality?: string; addressCountry?: string };
  };
  identifiers: ArppIdentifier[];
  sameAs: string[];
  domains: ArooDomain[];
  profiles: ArppProfile[];
  signals: {
    orgId: string;
    enrichmentScore: number;
    conformance: ArooConformanceLevel;
    accountStage?: string | null;
    ownerContactId?: string | null;
  };
};
