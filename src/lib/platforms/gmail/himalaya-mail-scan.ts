import { createContact, updateContact } from "@/lib/db/queries/contacts";
import { findContactByChannel } from "@/lib/db/queries/contact-channels";
import { ensureContactEmployment } from "@/lib/db/queries/contact-employment-writes";
import { logInteraction } from "@/lib/db/queries/interactions";
import {
  listHimalayaMailAccounts,
  type MailAccountView,
} from "@/lib/db/queries/mail-accounts";
import { ensureOrgByDomain } from "@/lib/db/queries/orgs";
import type { CreationProvenance } from "@/lib/db/creation-provenance-input";
import { updatePlatformAccount } from "@/lib/db/queries/platform-accounts";
import { getSyncCursor, updateSyncCursor } from "@/lib/db/queries/sync";
import { listHimalayaEnvelopes } from "@/lib/mail/himalaya";
import type { SyncResult } from "@/lib/platforms/adapter";
import {
  extractEnvelopeAddresses,
  parseEnvelopeTimestamp,
  type ParsedMailAddress,
} from "@/lib/platforms/gmail/address-extract";
import {
  extractEmailDomain,
  isFreemailDomain,
} from "@/lib/platforms/gmail/email-domain";

export const DEFAULT_MAX_ENVELOPES_PER_RUN = 500;
export const DEFAULT_PAGE_SIZE = 50;

export type ScanFolderKind = "received" | "sent";

export type ScanFolderConfig = {
  kind: ScanFolderKind;
  /** Try each folder name until one lists successfully (Gmail IMAP naming varies). */
  candidates: string[];
};

export const SCAN_FOLDER_CONFIGS: ScanFolderConfig[] = [
  { kind: "received", candidates: ["INBOX"] },
  { kind: "sent", candidates: ["Sent", "[Gmail]/Sent Mail", "INBOX.Sent"] },
];

export type ScanCursorPayload = {
  folderIndex: number;
  page: number;
};

type AddressActivity = {
  email: string;
  displayName: string | null;
  sentCount: number;
  receivedCount: number;
  lastEmailAt: number | null;
};

function parseCursorPayload(cursor: string | null | undefined): ScanCursorPayload {
  if (!cursor) return { folderIndex: 0, page: 1 };
  try {
    const parsed = JSON.parse(cursor) as ScanCursorPayload;
    return {
      folderIndex: Number.isFinite(parsed.folderIndex) ? parsed.folderIndex : 0,
      page: Number.isFinite(parsed.page) && parsed.page > 0 ? parsed.page : 1,
    };
  } catch {
    return { folderIndex: 0, page: 1 };
  }
}

/** Advance scan cursor after a page fetch. Exported for unit tests. */
export function computeNextScanCursor(
  current: ScanCursorPayload,
  opts: {
    folderCount: number;
    scanned: number;
    maxEnvelopes: number;
    hasMore: boolean;
    folderExhausted: boolean;
  }
): ScanCursorPayload {
  if (opts.folderExhausted || !opts.hasMore) {
    const nextIndex = current.folderIndex + 1;
    return nextIndex >= opts.folderCount
      ? { folderIndex: opts.folderCount, page: 1 }
      : { folderIndex: nextIndex, page: 1 };
  }

  if (opts.hasMore && opts.scanned < opts.maxEnvelopes) {
    return { folderIndex: current.folderIndex, page: current.page + 1 };
  }

  // Cap hit mid-folder — resume this page on the next run (idempotent upserts).
  return { folderIndex: current.folderIndex, page: current.page };
}

/** Persisted cursor wraps to the start after a full folder cycle completes. */
export function normalizePersistedScanCursor(
  position: ScanCursorPayload,
  folderCount: number
): ScanCursorPayload {
  if (position.folderIndex >= folderCount) {
    return { folderIndex: 0, page: 1 };
  }
  return position;
}

async function listEnvelopesForFolder(
  alias: string,
  folderConfig: ScanFolderConfig,
  page: number,
  pageSize: number
): Promise<{ envelopes: Awaited<ReturnType<typeof listHimalayaEnvelopes>>["envelopes"]; hasMore: boolean; folder: string } | null> {
  let lastError: Error | null = null;

  for (const folder of folderConfig.candidates) {
    try {
      const result = await listHimalayaEnvelopes(alias, folder, { page, pageSize });
      return { envelopes: result.envelopes, hasMore: result.hasMore, folder };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  if (lastError) throw lastError;
  return null;
}

function buildOwnAddressSet(account: MailAccountView, allAccounts: MailAccountView[]): Set<string> {
  const own = new Set<string>();
  for (const row of allAccounts) {
    if (row.email) own.add(row.email.toLowerCase());
    if (row.alias) own.add(row.alias.toLowerCase());
  }
  if (account.email) own.add(account.email.toLowerCase());
  return own;
}

function resolveMailAccount(mailAccountId?: string): MailAccountView {
  const accounts = listHimalayaMailAccounts();

  if (mailAccountId) {
    const account = accounts.find((row) => row.id === mailAccountId);
    if (!account) {
      throw new Error("Mail account not found");
    }
    return account;
  }

  const defaultAccount = accounts.find((row) => row.isDefault) ?? accounts[0];
  if (!defaultAccount) {
    throw new Error("No Himalaya mail accounts registered — add one in Settings");
  }
  return defaultAccount;
}

function upsertContactFromAddress(
  addr: ParsedMailAddress,
  ownAddresses: Set<string>,
  result: SyncResult,
  workflowRunId?: string,
): string | null {
  if (ownAddresses.has(addr.email)) {
    result.skipped++;
    return null;
  }

  const existing = findContactByChannel("email", addr.email);
  if (existing) {
    if (addr.displayName && (!existing.name || existing.name === addr.email)) {
      updateContact(existing.id, { name: addr.displayName });
      result.updated++;
    } else {
      result.skipped++;
    }
    return existing.id;
  }

  const contact = createContact(
    {
      name: addr.displayName || addr.email,
      email: addr.email,
    },
    {
      tag: "sync:himalaya_correspondents",
      workflowRunId: workflowRunId ?? null,
    },
  );
  result.added++;
  return contact.id;
}

function applyOrgProjection(
  contactId: string,
  email: string,
  provenance?: CreationProvenance,
): void {
  const domain = extractEmailDomain(email);
  if (!domain || isFreemailDomain(domain)) return;

  const org = ensureOrgByDomain(domain, "email_domain", provenance);
  ensureContactEmployment({
    contactId,
    orgId: org.id,
    title: null,
    isCurrent: true,
    source: "email_domain",
  });
}

function mergeActivity(
  activityByEmail: Map<string, AddressActivity>,
  addr: ParsedMailAddress,
  direction: "sent" | "received",
  occurredAt: number | null,
  thirtyDaysAgo: number
): void {
  const current = activityByEmail.get(addr.email) ?? {
    email: addr.email,
    displayName: addr.displayName,
    sentCount: 0,
    receivedCount: 0,
    lastEmailAt: null,
  };

  const inWindow = occurredAt !== null && occurredAt >= thirtyDaysAgo;
  if (inWindow) {
    if (direction === "sent") current.sentCount++;
    else current.receivedCount++;
  }

  if (occurredAt && (!current.lastEmailAt || occurredAt > current.lastEmailAt)) {
    current.lastEmailAt = occurredAt;
  }
  if (!current.displayName && addr.displayName) {
    current.displayName = addr.displayName;
  }

  activityByEmail.set(addr.email, current);
}

function applyMailActivity(activity: AddressActivity, result: SyncResult): void {
  const contact = findContactByChannel("email", activity.email);
  if (!contact) return;

  const existingMetadata = contact.metadata ? JSON.parse(contact.metadata) : {};
  const updatedMetadata = {
    ...existingMetadata,
    messageFrequency: {
      sent30d: activity.sentCount,
      received30d: activity.receivedCount,
      lastMessageAt: activity.lastEmailAt,
    },
  };

  updateContact(contact.id, { metadata: JSON.stringify(updatedMetadata) });

  if (
    activity.lastEmailAt &&
    (!contact.lastInteractionAt || activity.lastEmailAt > contact.lastInteractionAt)
  ) {
    logInteraction({
      contactId: contact.id,
      interactionType: "email",
      occurredAt: activity.lastEmailAt,
      source: "sync:himalaya_mail_activity",
      metadata: {
        sent30d: activity.sentCount,
        received30d: activity.receivedCount,
      },
    });
  }

  result.updated++;
}

export type HimalayaMailScanMode = "correspondents" | "mail_activity" | "full";

export async function syncHimalayaMailScan(
  mailAccountId: string | undefined,
  opts?: {
    mode?: HimalayaMailScanMode;
    maxEnvelopes?: number;
    pageSize?: number;
    workflowRunId?: string;
  }
): Promise<SyncResult> {
  const result: SyncResult = { added: 0, updated: 0, skipped: 0, errors: [] };
  const account = resolveMailAccount(mailAccountId);
  const allAccounts = listHimalayaMailAccounts();
  const ownAddresses = buildOwnAddressSet(account, allAccounts);
  const mode = opts?.mode ?? "full";
  const maxEnvelopes = opts?.maxEnvelopes ?? DEFAULT_MAX_ENVELOPES_PER_RUN;
  const pageSize = opts?.pageSize ?? DEFAULT_PAGE_SIZE;
  const workflowRunId = opts?.workflowRunId;
  const orgProvenance = workflowRunId
    ? { tag: "sync:himalaya_correspondents" as const, workflowRunId }
    : undefined;
  const dataType = mode === "mail_activity" ? "himalaya_mail_activity" : "himalaya_correspondents";

  const cursor = getSyncCursor(account.id, dataType);
  updateSyncCursor(cursor.id, {
    syncStatus: "syncing",
    lastSyncStartedAt: Math.floor(Date.now() / 1000),
  });

  const now = Math.floor(Date.now() / 1000);
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60;
  let scanned = 0;

  const activityByEmail = new Map<string, AddressActivity>();

  let { folderIndex, page } = parseCursorPayload(cursor.cursor);
  let cursorPosition: ScanCursorPayload = { folderIndex, page };

  try {
    while (scanned < maxEnvelopes && folderIndex < SCAN_FOLDER_CONFIGS.length) {
      const folderConfig = SCAN_FOLDER_CONFIGS[folderIndex]!;

      let listResult: Awaited<ReturnType<typeof listEnvelopesForFolder>> = null;
      try {
        listResult = await listEnvelopesForFolder(account.alias, folderConfig, page, pageSize);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        result.errors.push(
          `Skipped ${folderConfig.kind} folder (${folderConfig.candidates.join(", ")}): ${message}`
        );
        cursorPosition = computeNextScanCursor(cursorPosition, {
          folderCount: SCAN_FOLDER_CONFIGS.length,
          scanned,
          maxEnvelopes,
          hasMore: false,
          folderExhausted: true,
        });
        folderIndex = cursorPosition.folderIndex;
        page = cursorPosition.page;
        continue;
      }

      if (!listResult || listResult.envelopes.length === 0) {
        cursorPosition = computeNextScanCursor(cursorPosition, {
          folderCount: SCAN_FOLDER_CONFIGS.length,
          scanned,
          maxEnvelopes,
          hasMore: false,
          folderExhausted: true,
        });
        folderIndex = cursorPosition.folderIndex;
        page = cursorPosition.page;
        continue;
      }

      const { envelopes, hasMore } = listResult;
      const direction = folderConfig.kind === "sent" ? "sent" : "received";

      for (const envelope of envelopes) {
        if (scanned >= maxEnvelopes) break;
        scanned++;

        const occurredAt = parseEnvelopeTimestamp(envelope);
        const addresses = extractEnvelopeAddresses(envelope);

        for (const addr of addresses) {
          if (ownAddresses.has(addr.email)) continue;

          if (mode === "correspondents" || mode === "full") {
            upsertContactFromAddress(addr, ownAddresses, result, workflowRunId);
          }

          if (mode === "mail_activity" || mode === "full") {
            mergeActivity(activityByEmail, addr, direction, occurredAt, thirtyDaysAgo);
          }
        }
      }

      cursorPosition = computeNextScanCursor(cursorPosition, {
        folderCount: SCAN_FOLDER_CONFIGS.length,
        scanned,
        maxEnvelopes,
        hasMore,
        folderExhausted: false,
      });
      folderIndex = cursorPosition.folderIndex;
      page = cursorPosition.page;
    }

    if (mode === "mail_activity" || mode === "full") {
      for (const activity of activityByEmail.values()) {
        try {
          let contactId: string | null = null;
          if (mode === "mail_activity") {
            contactId = upsertContactFromAddress(
              { email: activity.email, displayName: activity.displayName },
              ownAddresses,
              result,
              workflowRunId,
            );
          } else {
            const existing = findContactByChannel("email", activity.email);
            contactId = existing?.id ?? null;
          }

          if (contactId) {
            applyOrgProjection(contactId, activity.email, orgProvenance);
          }
          applyMailActivity(activity, result);
        } catch (err) {
          result.errors.push(
            `Failed to enrich ${activity.email}: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }
    }

    const nextCursor = normalizePersistedScanCursor(cursorPosition, SCAN_FOLDER_CONFIGS.length);

    updateSyncCursor(cursor.id, {
      syncStatus: "completed",
      cursor: JSON.stringify(nextCursor),
      totalItemsSynced: (cursor.totalItemsSynced ?? 0) + scanned,
      lastSyncCompletedAt: now,
    });

    updatePlatformAccount(account.id, { lastSyncedAt: now });
  } catch (err) {
    result.errors.push(err instanceof Error ? err.message : String(err));
    updateSyncCursor(cursor.id, {
      syncStatus: "failed",
      lastSyncCompletedAt: now,
      lastError: err instanceof Error ? err.message : String(err),
    });
  }

  return result;
}

/** Scan only correspondent contacts from Himalaya headers. */
export async function syncHimalayaCorrespondents(
  mailAccountId?: string,
  opts?: { maxEnvelopes?: number; workflowRunId?: string },
): Promise<SyncResult> {
  return syncHimalayaMailScan(mailAccountId, { mode: "correspondents", ...opts });
}

/** Enrich contact mail activity metadata from Himalaya headers. */
export async function syncHimalayaMailActivity(
  mailAccountId?: string,
  opts?: { maxEnvelopes?: number }
): Promise<SyncResult> {
  return syncHimalayaMailScan(mailAccountId, { mode: "mail_activity", ...opts });
}
