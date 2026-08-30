import {
  type PersonalitySourceRevisions,
  type PersonalitySourceSnapshot,
  type PersonalitySources,
  personalitySourceSnapshotSchema,
  sourceRevisionsSchema,
} from "@/lib/personality/contracts";
import { sha256Canonical } from "@/lib/writing/hash";

export function buildSourceSnapshot(
  sources: PersonalitySources,
  revisions: { self: number; org?: number },
): PersonalitySourceSnapshot {
  return personalitySourceSnapshotSchema.parse({
    schemaVersion: 1,
    self: {
      contactId: sources.identity.contactId,
      revision: revisions.self,
      input: sources.identity,
    },
    org: sources.brand
      ? {
          orgId: sources.brand.orgId,
          revision: revisions.org,
          input: sources.brand,
        }
      : null,
    voice: sources.voice
      ? {
          id: sources.voice.profile.id,
          version: sources.voice.profile.version,
          hash: sources.voice.profile.hash,
          input: sources.voice,
        }
      : null,
    statements: sources.statements
      ? {
          hash: sources.statements.hash,
          values: sources.statements.values,
          boundaries: sources.statements.boundaries,
        }
      : null,
  });
}

export function computeSourceHash(snapshot: PersonalitySourceSnapshot): string {
  return sha256Canonical({
    schemaVersion: snapshot.schemaVersion,
    self: { contactId: snapshot.self.contactId, input: snapshot.self.input },
    org: snapshot.org
      ? { orgId: snapshot.org.orgId, input: snapshot.org.input }
      : null,
    voice: snapshot.voice,
    statements: snapshot.statements,
  });
}

export function sourceRevisions(
  snapshot: PersonalitySourceSnapshot,
): PersonalitySourceRevisions {
  return sourceRevisionsSchema.parse({
    self: snapshot.self.revision,
    ...(snapshot.org ? { org: snapshot.org.revision } : {}),
    ...(snapshot.voice
      ? {
          voice: {
            id: snapshot.voice.id,
            version: snapshot.voice.version,
            hash: snapshot.voice.hash,
          },
        }
      : {}),
    ...(snapshot.statements ? { statements: snapshot.statements.hash } : {}),
  });
}
