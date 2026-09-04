import { beforeEach, describe, expect, it, vi } from "vitest";
import { nanoid } from "nanoid";
import { createContact } from "@/lib/db/queries/contacts";
import { db } from "@/lib/db/client";
import { contactIdentities, scheduledJobs } from "@/lib/db/schema";
import { loadContactAvatarUploadAssetId } from "@/lib/db/queries/contact-dto";
import {
  AVATAR_CACHE_SWEEP_JOB_TYPE,
  planAvatarCacheSweep,
  AVATAR_CACHE_SWEEP_TRANSIENT_LIMIT,
  ensureAvatarCacheSweepJob,
  runAvatarCacheSweep,
} from "@/lib/db/avatar-cache-sweep";
import { resetCoreTables } from "@/test/db";

const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function seedContactNeedingAvatar(name: string): string {
  const contact = createContact({ name });
  db.insert(contactIdentities)
    .values({
      id: nanoid(),
      contactId: contact.id,
      platform: "x",
      platformUserId: nanoid(8),
      platformHandle: `h${nanoid(6).replace(/[^a-zA-Z0-9]/g, "a")}`,
      isPrimary: 1,
      isActive: 1,
    })
    .run();
  return contact.id;
}

function imageFetch(): typeof fetch {
  return vi.fn(async () =>
    new Response(PIXEL.buffer.slice(0) as ArrayBuffer, {
      status: 200,
      headers: { "content-type": "image/png" },
    }),
  ) as unknown as typeof fetch;
}

function throttledFetch(): typeof fetch {
  return vi.fn(async () => new Response(null, { status: 429 })) as unknown as typeof fetch;
}

describe("runAvatarCacheSweep", () => {
  beforeEach(() => {
    resetCoreTables();
    vi.restoreAllMocks();
  });

  it("caches avatars without running hydration or persona work", async () => {
    // The whole point: a stalled X breaker or missing LLM must not hold avatar caching hostage.
    const ids = ["A", "B", "C"].map(seedContactNeedingAvatar);

    const report = await runAvatarCacheSweep({ limit: 10, fetchImpl: imageFetch() });

    expect(report.cached).toBe(3);
    expect(report.complete).toBe(true);
    expect(report.remaining).toBe(0);
    for (const id of ids) {
      expect(loadContactAvatarUploadAssetId(id)).toBeTruthy();
    }
  });

  it("gives up after consecutive throttles instead of burning the daily quota", async () => {
    for (let i = 0; i < 10; i++) seedContactNeedingAvatar(`Throttled ${i}`);
    const fetchImpl = throttledFetch();

    const report = await runAvatarCacheSweep({ limit: 10, fetchImpl });

    expect(report.stoppedEarly).toBe(true);
    expect(report.transient).toBe(AVATAR_CACHE_SWEEP_TRANSIENT_LIMIT);
    expect(report.cached).toBe(0);
    // Stopped at the limit rather than walking all ten.
    expect((fetchImpl as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(
      AVATAR_CACHE_SWEEP_TRANSIENT_LIMIT,
    );
  });

  it("reports incomplete while work remains", async () => {
    for (let i = 0; i < 4; i++) seedContactNeedingAvatar(`Batch ${i}`);

    const report = await runAvatarCacheSweep({ limit: 2, fetchImpl: imageFetch() });

    expect(report.selected).toBe(2);
    expect(report.cached).toBe(2);
    expect(report.complete).toBe(false);
    expect(report.remaining).toBe(2);
  });
});

describe("planAvatarCacheSweep", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("selects CDN-backed contacts ahead of resolver-only ones", () => {
    // The general backlog is ordered by enrichment score, so without an explicit pull the handful
    // of CDN-backed contacts never appear in a small window and the sweep trips its transient
    // guard on resolver-only contacts instead (#435).
    const resolverOnly: string[] = [];
    for (let i = 0; i < 30; i++) resolverOnly.push(seedContactNeedingAvatar(`Resolver ${i}`));

    const cdnBacked = createContact({ name: "CDN backed" });
    db.insert(contactIdentities)
      .values({
        id: nanoid(),
        contactId: cdnBacked.id,
        platform: "linkedin",
        platformUserId: "cdn-backed",
        avatarUrl: "https://media.licdn.com/dms/image/photo.jpg",
        isPrimary: 1,
        isActive: 1,
      })
      .run();

    const plan = planAvatarCacheSweep(5);

    expect(plan.contactIds[0]).toBe(cdnBacked.id);
    expect(plan.contactIds).toHaveLength(5);
    expect(plan.backlogTotal).toBeGreaterThan(5);
  });

  it("still fills the batch from the general backlog when no unmetered work exists", () => {
    for (let i = 0; i < 4; i++) seedContactNeedingAvatar(`Resolver ${i}`);

    const plan = planAvatarCacheSweep(10);

    expect(plan.contactIds).toHaveLength(4);
  });
});

describe("ensureAvatarCacheSweepJob", () => {
  beforeEach(() => {
    resetCoreTables();
    db.delete(scheduledJobs).run();
  });

  it("arms one job while work remains and does not stack duplicates", () => {
    seedContactNeedingAvatar("Needs avatar");

    expect(ensureAvatarCacheSweepJob()).toBe(true);
    expect(ensureAvatarCacheSweepJob()).toBe(false);

    const jobs = db
      .select()
      .from(scheduledJobs)
      .all()
      .filter((job) => job.jobType === AVATAR_CACHE_SWEEP_JOB_TYPE);
    expect(jobs).toHaveLength(1);
  });

  it("does not arm when nothing needs an avatar", () => {
    expect(ensureAvatarCacheSweepJob()).toBe(false);
    expect(db.select().from(scheduledJobs).all()).toHaveLength(0);
  });
});
