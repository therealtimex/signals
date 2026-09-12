export type EventSourceConfidence = "high" | "medium" | "low";

export type EventSourceAccessScope =
  | { kind: "public" }
  | { kind: "authorized"; ownerWorkspace: string; runId: string; grantId: string };

export type EventRelationshipRole =
  | "organized_by"
  | "hosted_by"
  | "co_hosted_by"
  | "sponsored_by"
  | "venue_provided_by"
  | "listed_on_calendar"
  | "related_event"
  | "rsvp";

export type EventRsvpState =
  | "going"
  | "registered"
  | "waitlisted"
  | "declined"
  | "unknown";

export type GuestBoundaryReason =
  | "public_only"
  | "login_required"
  | "registration_required"
  | "waitlisted"
  | "permission_missing"
  | "session_changed"
  | "lease_lost"
  | "parse_failed"
  | "rate_limited"
  | null;

export type GuestBoundary = {
  state: "not_requested" | "public" | "gated" | "authorized" | "unavailable";
  reason: GuestBoundaryReason;
};

export type EventSourceEvidence = {
  eventKey: string;
  sourceUrl: string;
  targetUrl?: string;
  observedAt: number;
  observedRole: EventRelationshipRole | "event" | "aggregate" | "participant";
  confidence: EventSourceConfidence;
  scope: EventSourceAccessScope;
  provider: "luma";
  extractorVersion: number;
  observationId: string;
};

export type EventParty = {
  name: string;
  url?: string;
  entityType: "person" | "organization" | "place" | "unknown";
  role: EventRelationshipRole;
  evidence: EventSourceEvidence;
};

export type EventSource = {
  version: 1;
  key: string;
  provider: "luma";
  canonicalUrl: string;
  title: string;
  startsAt: string | null;
  endsAt: string | null;
  timezone: string | null;
  location: string | null;
  topics: string[];
  audience: { goingCount: number | null };
  status: "scheduled" | "cancelled" | "ended" | "unknown";
  observedAt: number;
  confidence: EventSourceConfidence;
  scope: { kind: "public" };
  parties: EventParty[];
  calendarUrls: string[];
  relatedEventUrls: string[];
  evidence: EventSourceEvidence[];
  guestBoundary: GuestBoundary;
};

export type AuthorizedEventParticipant = {
  subjectKey: string;
  displayName: string;
  profileUrl: string | null;
  rsvp: EventRsvpState;
  attendance: "unknown";
  evidence: EventSourceEvidence;
};

export type EventTraversalPolicy = {
  adjacentEventDepth: number;
  eventsPerCalendar: number;
  maxEvents: number;
  maxCalendarPages: number;
  maxGuestPages: number;
  maxParticipantObservations: number;
  maxProfileVisits: number;
  maxProviderRequests: number;
};

export type EventParticipantAccessConfig = {
  enabled: boolean;
  browserSessionName: string;
};
