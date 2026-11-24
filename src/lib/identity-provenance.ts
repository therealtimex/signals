/**
 * Where a contact identity came from (#571). Stored on contact_identities as three nullable
 * columns; null means unknown (every identity written before provenance existed).
 *
 * Strength is a strict order: self_declared > agent_verified > inferred > null.
 * - self_declared: the subject attached this account to a profile they control (their Luma
 *   profile, personal site, X bio). First-party ownership evidence.
 * - agent_verified: an agent checked the account against corroborating evidence (name,
 *   company, role). Second-party, so it ranks below self_declared: a later verification must
 *   not erase the record that the subject linked the account themselves.
 * - inferred: matched from weaker signals such as a search result or a name match.
 */
export const IDENTITY_PROVENANCE_KIND_ENUM = ["self_declared", "agent_verified", "inferred"] as const;

export type IdentityProvenanceKind = (typeof IDENTITY_PROVENANCE_KIND_ENUM)[number];

export const IDENTITY_PROVENANCE_SOURCE_URL_MAX_LENGTH = 2_048;

/** Upper bound that catches millisecond timestamps passed where unix seconds are expected. */
export const IDENTITY_PROVENANCE_OBSERVED_AT_MAX = 9_999_999_999;

const RANK: Record<IdentityProvenanceKind, number> = {
  inferred: 1,
  agent_verified: 2,
  self_declared: 3,
};

export function identityProvenanceRank(kind: IdentityProvenanceKind | null | undefined): number {
  return kind ? RANK[kind] : 0;
}

export type IdentityProvenanceInput = {
  kind: IdentityProvenanceKind;
  sourceUrl?: string | null;
  observedAt?: number | null;
};

export type IdentityProvenanceColumns = {
  provenanceKind: IdentityProvenanceKind | null;
  provenanceSourceUrl: string | null;
  provenanceObservedAt: number | null;
};

export type IdentityProvenanceWriteOutcome = "applied" | "kept_existing" | "not_provided";

/**
 * Decide whether an incoming provenance replaces the stored one. The same or a stronger kind
 * replaces all three fields (an omitted sourceUrl clears it, an omitted observedAt defaults
 * to now); a weaker kind leaves the stored provenance untouched.
 */
export function resolveIdentityProvenanceWrite(
  existing: Pick<IdentityProvenanceColumns, "provenanceKind">,
  incoming: IdentityProvenanceInput | undefined,
  now: number = Math.floor(Date.now() / 1000),
): { outcome: IdentityProvenanceWriteOutcome; columns?: IdentityProvenanceColumns } {
  if (!incoming) return { outcome: "not_provided" };
  if (identityProvenanceRank(incoming.kind) < identityProvenanceRank(existing.provenanceKind)) {
    return { outcome: "kept_existing" };
  }
  return {
    outcome: "applied",
    columns: {
      provenanceKind: incoming.kind,
      provenanceSourceUrl: incoming.sourceUrl ?? null,
      provenanceObservedAt: incoming.observedAt ?? now,
    },
  };
}

export type SerializedIdentityProvenance = {
  kind: IdentityProvenanceKind;
  sourceUrl: string | null;
  observedAt: number | null;
} | null;

export function serializeIdentityProvenance(
  identity: IdentityProvenanceColumns,
): SerializedIdentityProvenance {
  if (!identity.provenanceKind) return null;
  return {
    kind: identity.provenanceKind,
    sourceUrl: identity.provenanceSourceUrl,
    observedAt: identity.provenanceObservedAt,
  };
}
