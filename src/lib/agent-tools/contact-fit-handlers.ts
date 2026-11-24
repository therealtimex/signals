import { eq } from "drizzle-orm";
import type { z } from "zod";
import { db } from "@/lib/db/client";
import { contacts } from "@/lib/db/schema";
import { isContactArchived } from "@/lib/db/contact-archive";
import {
  scoreContactFitItemSchema,
  type scoreContactFitSchema,
} from "@/lib/agent-tools/schemas";

type ScoreContactFitItem = z.infer<typeof scoreContactFitItemSchema>;

export type ScoreContactFitResult =
  | { index: number; contactId: string; status: "ok"; fitScoredAt: number }
  | {
      index: number;
      contactId: string;
      status: "skipped";
      reason: "archived" | "self" | "platform_actor";
      message: string;
      mergedIntoContactId?: string;
    }
  | {
      index: number;
      contactId: string | null;
      status: "error";
      reason: "invalid_input" | "not_found" | "duplicate_in_batch";
      message: string;
      issues?: unknown;
    };

function readMetadata(metadata: string | null): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(metadata ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function rawContactId(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const value = (raw as { contactId?: unknown }).contactId;
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Batch-write ICP fit onto contacts (#570).
 *
 * Every row is validated and resolved on its own, so one bad row yields an `error`
 * result for that row while the rest are written. A written row overwrites all seven
 * fit fields — omitted optional fields become null — so rescoring is idempotent and
 * never leaves a stale rationale from an older rubric behind. Self, archived (incl.
 * merged) and internal platform-actor contacts are skipped, matching the enrichment
 * pipeline's contact universe.
 */
export async function handleScoreContactFit(input: z.infer<typeof scoreContactFitSchema>) {
  const fitScoredAt = Math.floor(Date.now() / 1000);
  const results: ScoreContactFitResult[] = [];

  db.transaction((tx) => {
    const seen = new Set<string>();

    input.items.forEach((raw, index) => {
      const parsed = scoreContactFitItemSchema.safeParse(raw);
      if (!parsed.success) {
        results.push({
          index,
          contactId: rawContactId(raw),
          status: "error",
          reason: "invalid_input",
          message: parsed.error.issues
            .map((issue) => `${issue.path.join(".") || "item"}: ${issue.message}`)
            .join("; "),
          issues: parsed.error.flatten(),
        });
        return;
      }

      const item: ScoreContactFitItem = parsed.data;
      const { contactId } = item;
      if (seen.has(contactId)) {
        results.push({
          index,
          contactId,
          status: "error",
          reason: "duplicate_in_batch",
          message: `contactId ${contactId} already appears earlier in this batch; the first row was used.`,
        });
        return;
      }
      seen.add(contactId);

      const row = tx
        .select({ id: contacts.id, isSelf: contacts.isSelf, metadata: contacts.metadata })
        .from(contacts)
        .where(eq(contacts.id, contactId))
        .get();
      if (!row) {
        results.push({
          index,
          contactId,
          status: "error",
          reason: "not_found",
          message: `Contact not found: ${contactId}`,
        });
        return;
      }

      const metadata = readMetadata(row.metadata);
      if (isContactArchived(row.metadata)) {
        const mergedInto = metadata.mergedIntoContactId;
        results.push({
          index,
          contactId,
          status: "skipped",
          reason: "archived",
          message:
            typeof mergedInto === "string"
              ? `Contact ${contactId} was merged into ${mergedInto}; score the surviving contact.`
              : `Contact ${contactId} is archived.`,
          ...(typeof mergedInto === "string" ? { mergedIntoContactId: mergedInto } : {}),
        });
        return;
      }
      if (metadata.platformActor === 1) {
        results.push({
          index,
          contactId,
          status: "skipped",
          reason: "platform_actor",
          message: `Contact ${contactId} is an internal platform actor, not a prospect.`,
        });
        return;
      }
      if (row.isSelf) {
        results.push({
          index,
          contactId,
          status: "skipped",
          reason: "self",
          message: `Contact ${contactId} is the operator's own contact.`,
        });
        return;
      }

      tx.update(contacts)
        .set({
          fitScore: item.fitScore,
          fitTier: item.fitTier,
          fitProduct: item.fitProduct ?? null,
          fitConfidence: item.fitConfidence ?? null,
          fitRationale: item.fitRationale ?? null,
          fitScoreVersion: item.fitScoreVersion ?? input.fitScoreVersion ?? null,
          fitScoredAt,
          updatedAt: fitScoredAt,
        })
        .where(eq(contacts.id, contactId))
        .run();
      results.push({ index, contactId, status: "ok", fitScoredAt });
    });
  });

  return {
    fitScoredAt,
    summary: {
      total: results.length,
      ok: results.filter((result) => result.status === "ok").length,
      skipped: results.filter((result) => result.status === "skipped").length,
      error: results.filter((result) => result.status === "error").length,
    },
    results,
  };
}
