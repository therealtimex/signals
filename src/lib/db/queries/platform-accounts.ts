import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db/client";
import { platformAccounts } from "@/lib/db/schema";
import type { PlatformAccount, NewPlatformAccount } from "@/lib/db/types";
import type { Platform } from "@/lib/db/platforms";

export function getPlatformAccountById(id: string): PlatformAccount | undefined {
  return db.select().from(platformAccounts).where(eq(platformAccounts.id, id)).get();
}

/** Find the account for a platform (single-user app — one account per platform). */
export function getPlatformAccountByPlatform(platform: Platform): PlatformAccount | undefined {
  return db
    .select()
    .from(platformAccounts)
    .where(eq(platformAccounts.platform, platform))
    .get();
}

export function createPlatformAccount(data: Omit<NewPlatformAccount, "id">): PlatformAccount {
  const id = nanoid();
  db.insert(platformAccounts).values({ ...data, id }).run();
  return getPlatformAccountById(id)!;
}

export function updatePlatformAccount(
  id: string,
  data: Partial<Omit<NewPlatformAccount, "id">>
): PlatformAccount | undefined {
  const existing = getPlatformAccountById(id);
  if (!existing) return undefined;

  db.update(platformAccounts)
    .set({ ...data, updatedAt: Math.floor(Date.now() / 1000) })
    .where(eq(platformAccounts.id, id))
    .run();

  return getPlatformAccountById(id);
}

export function deletePlatformAccount(id: string): boolean {
  const existing = getPlatformAccountById(id);
  if (!existing) return false;

  db.delete(platformAccounts).where(eq(platformAccounts.id, id)).run();
  return true;
}

export function listPlatformAccounts(): PlatformAccount[] {
  return db.select().from(platformAccounts).all();
}
