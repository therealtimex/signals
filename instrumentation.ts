export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Run base schema migrations
    try {
      const { runMigrations } = await import("@/lib/db/migrate");
      runMigrations();
    } catch (e) {
      console.warn("[instrumentation] Base schema migrations skipped:", (e as Error).message);
    }

    try {
      const { ensureContactScalarColumns } = await import("@/lib/db/migrate-contact-scalars");
      const scalarRestore = ensureContactScalarColumns();
      if (scalarRestore.restored.length > 0) {
        console.log("[instrumentation] Restored contact scalar columns:", scalarRestore.restored);
      }
    } catch (e) {
      console.warn("[instrumentation] Contact scalar restore skipped:", (e as Error).message);
    }

    try {
      const { backfillChannels } = await import("@/lib/db/backfills/channels");
      const channelBackfill = backfillChannels();
      if (channelBackfill.emails > 0 || channelBackfill.phones > 0) {
        console.log("[instrumentation] Channel backfill applied:", channelBackfill);
      }
    } catch (e) {
      console.warn("[instrumentation] Channel backfill skipped:", (e as Error).message);
    }

    try {
      const { backfillEmployments } = await import("@/lib/db/backfills/employments");
      const employmentBackfill = backfillEmployments();
      if (employmentBackfill.inserted > 0) {
        console.log("[instrumentation] Employment backfill applied:", employmentBackfill);
      }
    } catch (e) {
      console.warn("[instrumentation] Employment backfill skipped:", (e as Error).message);
    }

    try {
      const { sweepContactProfileEmbeddingsAfterEmploymentMigration } = await import(
        "@/lib/db/queries/embeddings"
      );
      const embedSweep = sweepContactProfileEmbeddingsAfterEmploymentMigration();
      if (!embedSweep.skipped && embedSweep.deleted > 0) {
        console.log("[instrumentation] Contact profile embedding sweep:", embedSweep);
      }
    } catch (e) {
      console.warn("[instrumentation] Contact profile embedding sweep skipped:", (e as Error).message);
    }

    // Run identity migration
    try {
      const { migrateContactIdentities } = await import("@/lib/db/migrate-identities");
      migrateContactIdentities();
    } catch (e) {
      console.warn("[instrumentation] Identity migration skipped:", (e as Error).message);
    }

    try {
      const { migrateIdentityStats } = await import("@/lib/db/migrate-identity-stats");
      const statsResult = migrateIdentityStats();
      if (statsResult.migrated > 0) {
        console.log(`[instrumentation] Lifted identity stats for ${statsResult.migrated} identities`);
      }
    } catch (e) {
      console.warn("[instrumentation] Identity stats migration skipped:", (e as Error).message);
    }

    try {
      const { runGraphBackfills } = await import("@/lib/db/backfills");
      const graphBackfill = runGraphBackfills();
      const total =
        graphBackfill.orgs.inserted +
        graphBackfill.worksAt.upserted +
        graphBackfill.interactions.inserted +
        graphBackfill.engagedWith.upserted +
        graphBackfill.niches.nichesCreated +
        graphBackfill.niches.edgesUpserted +
        graphBackfill.interactionParity.updated;
      if (total > 0) {
        console.log("[instrumentation] Graph backfills applied:", graphBackfill);
      }
    } catch (e) {
      console.warn("[instrumentation] Graph backfill skipped:", (e as Error).message);
    }

    try {
      const { runGraphIntegrityJob } = await import("@/lib/db/graph-integrity");
      const integrity = runGraphIntegrityJob({ repair: true });
      if (integrity.repairedCount > 0) {
        console.log(
          `[instrumentation] Graph integrity repaired ${integrity.repairedCount} edge(s)`,
        );
      }
    } catch (e) {
      console.warn("[instrumentation] Graph integrity job skipped:", (e as Error).message);
    }

    // Run idempotent migrations before anything else
    try {
      const { migrateTemplateUserColumns } = await import("@/lib/db/migrations/add-template-user-columns");
      const result = migrateTemplateUserColumns();
      if (result.migrated) {
        console.log("[instrumentation] Template user columns migration applied");
      }
    } catch (e) {
      // Migration may fail on first run before tables exist
      console.warn("[instrumentation] Migration skipped:", (e as Error).message);
    }

    // Seed new templates (idempotent — only seeds missing system templates)
    try {
      const { seedTemplates } = await import("@/lib/db/seed-templates");
      const result = seedTemplates();
      if (result.seeded > 0) {
        console.log(`[instrumentation] Seeded ${result.seeded} workflow templates`);
      }
      if (result.updated > 0) {
        console.log(`[instrumentation] Updated ${result.updated} workflow template prompts`);
      }
    } catch (e) {
      // Seed may fail if tables don't exist yet
      console.warn("[instrumentation] Seeding skipped:", (e as Error).message);
    }

    try {
      const { bootstrapRtxIfEmbedded } = await import("@/lib/rtx/bootstrap");
      await bootstrapRtxIfEmbedded();
    } catch (e) {
      console.warn("[instrumentation] RTX bootstrap skipped:", (e as Error).message);
    }

    const { initScheduler } = await import("@/lib/scheduler/runner");
    initScheduler();
  }
}
