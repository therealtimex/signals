import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db/client";
import { platformAccounts } from "@/lib/db/schema";
import type { PlatformAccount } from "@/lib/db/types";
import {
  getDefaultMailAccountAlias,
  setDefaultMailAccountAlias,
} from "@/lib/mail/settings";
import type { HimalayaDiscoveredAccount } from "@/lib/mail/himalaya";

export type MailAccountMetadata = {
  himalayaAlias: string;
  checkStatus?: "ok" | "error" | "unknown";
  checkMessage?: string;
  lastCheckedAt?: number;
};

export type MailAccountView = {
  id: string;
  alias: string;
  email: string;
  status: "ok" | "error" | "unknown";
  isDefault: boolean;
  lastCheckedAt: number | null;
  checkMessage: string | null;
};

function parseMetadata(account: PlatformAccount): MailAccountMetadata {
  if (!account.metadata) return { himalayaAlias: account.displayName };
  try {
    const parsed = JSON.parse(account.metadata) as MailAccountMetadata;
    return {
      himalayaAlias: parsed.himalayaAlias ?? account.displayName,
      checkStatus: parsed.checkStatus,
      checkMessage: parsed.checkMessage,
      lastCheckedAt: parsed.lastCheckedAt,
    };
  } catch {
    return { himalayaAlias: account.displayName };
  }
}

function toMailAccountView(account: PlatformAccount, defaultAlias: string | null): MailAccountView {
  const meta = parseMetadata(account);
  return {
    id: account.id,
    alias: meta.himalayaAlias,
    email: account.displayName,
    status: meta.checkStatus ?? "unknown",
    isDefault: meta.himalayaAlias === defaultAlias,
    lastCheckedAt: meta.lastCheckedAt ?? null,
    checkMessage: meta.checkMessage ?? null,
  };
}

export function listHimalayaMailAccounts(): MailAccountView[] {
  const defaultAlias = getDefaultMailAccountAlias();
  return db
    .select()
    .from(platformAccounts)
    .where(
      and(eq(platformAccounts.platform, "gmail"), eq(platformAccounts.authType, "himalaya"))
    )
    .all()
    .map((account) => toMailAccountView(account, defaultAlias));
}

export function getHimalayaMailAccountById(id: string): PlatformAccount | undefined {
  const account = db.select().from(platformAccounts).where(eq(platformAccounts.id, id)).get();
  if (!account || account.platform !== "gmail" || account.authType !== "himalaya") {
    return undefined;
  }
  return account;
}

export function getHimalayaMailAccountByAlias(alias: string): PlatformAccount | undefined {
  return listHimalayaMailAccountRows().find((account) => {
    const meta = parseMetadata(account);
    return meta.himalayaAlias === alias;
  });
}

function listHimalayaMailAccountRows(): PlatformAccount[] {
  return db
    .select()
    .from(platformAccounts)
    .where(
      and(eq(platformAccounts.platform, "gmail"), eq(platformAccounts.authType, "himalaya"))
    )
    .all();
}

/** Legacy Gmail OAuth row (single-account assumption preserved for migration notice). */
export function getLegacyGmailOAuthAccount(): PlatformAccount | undefined {
  const account = db
    .select()
    .from(platformAccounts)
    .where(and(eq(platformAccounts.platform, "gmail"), eq(platformAccounts.authType, "oauth")))
    .get();
  return account;
}

export function syncMailAccountsFromHimalaya(
  discovered: HimalayaDiscoveredAccount[]
): MailAccountView[] {
  const existing = listHimalayaMailAccountRows();
  const existingByAlias = new Map(
    existing.map((account) => [parseMetadata(account).himalayaAlias, account])
  );
  const discoveredAliases = new Set(discovered.map((row) => row.alias));

  for (const row of discovered) {
    const current = existingByAlias.get(row.alias);
    if (current) {
      db.update(platformAccounts)
        .set({
          displayName: row.email,
          updatedAt: Math.floor(Date.now() / 1000),
        })
        .where(eq(platformAccounts.id, current.id))
        .run();
      continue;
    }

    const id = nanoid();
    const metadata: MailAccountMetadata = {
      himalayaAlias: row.alias,
      checkStatus: "unknown",
    };
    db.insert(platformAccounts)
      .values({
        id,
        platform: "gmail",
        displayName: row.email,
        authType: "himalaya",
        metadata: JSON.stringify(metadata),
        status: "active",
      })
      .run();
  }

  for (const account of existing) {
    const alias = parseMetadata(account).himalayaAlias;
    if (!discoveredAliases.has(alias)) {
      db.delete(platformAccounts).where(eq(platformAccounts.id, account.id)).run();
      const defaultAlias = getDefaultMailAccountAlias();
      if (defaultAlias === alias) {
        setDefaultMailAccountAlias(null);
      }
    }
  }

  const defaultAlias = getDefaultMailAccountAlias();
  if (!defaultAlias && discovered.length > 0) {
    setDefaultMailAccountAlias(discovered[0].alias);
  }

  return listHimalayaMailAccounts();
}

export function setDefaultMailAccount(id: string): MailAccountView | undefined {
  const account = getHimalayaMailAccountById(id);
  if (!account) return undefined;

  const alias = parseMetadata(account).himalayaAlias;
  setDefaultMailAccountAlias(alias);
  return toMailAccountView(account, alias);
}

export function updateMailAccountCheckStatus(
  id: string,
  result: { ok: boolean; message?: string }
): MailAccountView | undefined {
  const account = getHimalayaMailAccountById(id);
  if (!account) return undefined;

  const meta = parseMetadata(account);
  const nextMeta: MailAccountMetadata = {
    ...meta,
    checkStatus: result.ok ? "ok" : "error",
    checkMessage: result.message,
    lastCheckedAt: Math.floor(Date.now() / 1000),
  };

  db.update(platformAccounts)
    .set({
      metadata: JSON.stringify(nextMeta),
      status: result.ok ? "active" : "needs_reauth",
      updatedAt: Math.floor(Date.now() / 1000),
    })
    .where(eq(platformAccounts.id, id))
    .run();

  return toMailAccountView(getHimalayaMailAccountById(id)!, getDefaultMailAccountAlias());
}

export function unregisterMailAccount(id: string): boolean {
  const account = getHimalayaMailAccountById(id);
  if (!account) return false;

  const alias = parseMetadata(account).himalayaAlias;
  db.delete(platformAccounts).where(eq(platformAccounts.id, id)).run();

  if (getDefaultMailAccountAlias() === alias) {
    const remaining = listHimalayaMailAccounts();
    setDefaultMailAccountAlias(remaining[0]?.alias ?? null);
  }

  return true;
}

export function getDefaultMailAccount(): MailAccountView | null {
  const defaultAlias = getDefaultMailAccountAlias();
  if (!defaultAlias) return null;
  const account = getHimalayaMailAccountByAlias(defaultAlias);
  if (!account) return null;
  return toMailAccountView(account, defaultAlias);
}
