import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db/client";
import {
  snowballEventAccessGrants,
  snowballEventObservations,
} from "@/lib/db/schema";
import type { AuthorizedEventParticipant } from "@/lib/workflows/event-sources/types";

const EVENT_REPORT_TTL_SECONDS = 60 * 60;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function hashesEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export type EventAccessMaterial = {
  grantId: string;
  capability: string;
  capabilityHash: string;
};

export function mintEventAccessMaterial(): EventAccessMaterial {
  const capability = randomBytes(32).toString("base64url");
  return {
    grantId: `event_grant_${nanoid()}`,
    capability,
    capabilityHash: sha256(capability),
  };
}

export function persistAuthorizedEventObservations(input: {
  material: EventAccessMaterial;
  runId: string;
  ownerWorkspace: string;
  connectionId: string;
  sessionName: string;
  viewerIdentity: string;
  eventKey: string;
  participants: AuthorizedEventParticipant[];
  now?: number;
}): void {
  const now = input.now ?? Math.floor(Date.now() / 1000);
  db.transaction((tx) => {
    tx.insert(snowballEventAccessGrants)
      .values({
        id: input.material.grantId,
        runId: input.runId,
        ownerWorkspace: input.ownerWorkspace,
        connectionId: input.connectionId,
        sessionName: input.sessionName,
        viewerIdentityHash: sha256(input.viewerIdentity),
        capabilityHash: input.material.capabilityHash,
        status: "active",
        issuedAt: now,
        expiresAt: now + EVENT_REPORT_TTL_SECONDS,
      })
      .run();

    for (const participant of input.participants) {
      tx.insert(snowballEventObservations)
        .values({
          id: `event_observation_${nanoid()}`,
          runId: input.runId,
          ownerWorkspace: input.ownerWorkspace,
          grantId: input.material.grantId,
          eventKey: input.eventKey,
          subjectKey: participant.subjectKey,
          observationKind: "participant",
          scope: "authorized",
          payloadJson: JSON.stringify(participant),
          observedAt: participant.evidence.observedAt,
        })
        .onConflictDoNothing()
        .run();
    }
  });
}

export function revokeEventAccessGrant(grantId: string): void {
  const now = Math.floor(Date.now() / 1000);
  db.update(snowballEventAccessGrants)
    .set({ status: "revoked", revokedAt: now, updatedAt: now })
    .where(eq(snowballEventAccessGrants.id, grantId))
    .run();
}

export function readAuthorizedEventReport(input: {
  runId: string;
  ownerWorkspace: string;
  capability: string;
}): {
  grantId: string;
  expiresAt: number;
  session: { name: string; authorizedAt: number };
  participants: AuthorizedEventParticipant[];
} | null {
  const presentedHash = sha256(input.capability);
  const grant = db
    .select()
    .from(snowballEventAccessGrants)
    .where(
      and(
        eq(snowballEventAccessGrants.runId, input.runId),
        eq(snowballEventAccessGrants.ownerWorkspace, input.ownerWorkspace),
        eq(snowballEventAccessGrants.capabilityHash, presentedHash),
      ),
    )
    .get();
  if (!grant || !hashesEqual(grant.capabilityHash, presentedHash)) return null;
  const now = Math.floor(Date.now() / 1000);
  if (grant.status !== "active" || grant.expiresAt <= now) {
    if (grant.status === "active") {
      db.update(snowballEventAccessGrants)
        .set({ status: "expired", updatedAt: now })
        .where(eq(snowballEventAccessGrants.id, grant.id))
        .run();
    }
    return null;
  }

  const participants = db
    .select({ payloadJson: snowballEventObservations.payloadJson })
    .from(snowballEventObservations)
    .where(
      and(
        eq(snowballEventObservations.runId, input.runId),
        eq(snowballEventObservations.ownerWorkspace, input.ownerWorkspace),
        eq(snowballEventObservations.grantId, grant.id),
      ),
    )
    .all()
    .flatMap(({ payloadJson }) => {
      try {
        return [JSON.parse(payloadJson) as AuthorizedEventParticipant];
      } catch {
        return [];
      }
    });
  return {
    grantId: grant.id,
    expiresAt: grant.expiresAt,
    session: { name: grant.sessionName, authorizedAt: grant.issuedAt },
    participants,
  };
}
