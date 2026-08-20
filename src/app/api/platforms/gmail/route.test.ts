import { beforeEach, describe, expect, it, vi } from "vitest";
import { nanoid } from "nanoid";
import { DELETE, GET } from "@/app/api/platforms/gmail/route";
import { db } from "@/lib/db/client";
import { platformAccounts } from "@/lib/db/schema";
import { listHimalayaMailAccounts, syncMailAccountsFromHimalaya } from "@/lib/db/queries/mail-accounts";
import { disconnectGmailAccount } from "@/lib/platforms/gmail/auth";
import { resetCoreTables } from "@/test/db";

vi.mock("@/lib/platforms/gmail/auth", () => ({
  disconnectGmailAccount: vi.fn(),
}));

vi.mock("@/lib/platforms/gmail/client", () => ({
  getGoogleContacts: vi.fn(),
}));

describe("/api/platforms/gmail legacy OAuth scoping", () => {
  beforeEach(() => {
    resetCoreTables();
    db.delete(platformAccounts).run();
    vi.clearAllMocks();
  });

  it("GET reports disconnected when only Himalaya mail accounts exist", async () => {
    syncMailAccountsFromHimalaya([{ alias: "work", email: "work@company.com" }]);

    const res = await GET();
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.connected).toBe(false);
    expect(listHimalayaMailAccounts()).toHaveLength(1);
  });

  it("DELETE does not remove Himalaya mail accounts", async () => {
    syncMailAccountsFromHimalaya([{ alias: "work", email: "work@company.com" }]);

    const res = await DELETE();
    const data = await res.json();

    expect(res.status).toBe(404);
    expect(data.error).toMatch(/No Gmail account connected/i);
    expect(listHimalayaMailAccounts()).toHaveLength(1);
    expect(disconnectGmailAccount).not.toHaveBeenCalled();
  });

  it("DELETE disconnects only legacy OAuth gmail rows", async () => {
    const oauthId = nanoid();
    db.insert(platformAccounts)
      .values({
        id: oauthId,
        platform: "gmail",
        displayName: "Legacy OAuth",
        authType: "oauth",
        credentialsEncrypted: "enc",
      })
      .run();
    syncMailAccountsFromHimalaya([{ alias: "work", email: "work@company.com" }]);
    vi.mocked(disconnectGmailAccount).mockResolvedValue(undefined);

    const res = await DELETE();
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(disconnectGmailAccount).toHaveBeenCalledWith(oauthId);
    expect(listHimalayaMailAccounts()).toHaveLength(1);
  });
});
