import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/mail-accounts/route";
import { PATCH, DELETE } from "@/app/api/mail-accounts/[id]/route";
import { db } from "@/lib/db/client";
import { platformAccounts } from "@/lib/db/schema";
import { syncMailAccountsFromHimalaya } from "@/lib/db/queries/mail-accounts";
import * as himalaya from "@/lib/mail/himalaya";

describe("/api/mail-accounts", () => {
  beforeEach(() => {
    db.delete(platformAccounts).run();
  });

  it("GET lists registered accounts", async () => {
    syncMailAccountsFromHimalaya([{ alias: "work", email: "work@company.com" }]);
    const res = await GET();
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.accounts).toHaveLength(1);
    expect(data.accounts[0].alias).toBe("work");
    expect(data.configPath).toBeTruthy();
  });

  it("POST syncs from Himalaya discovery", async () => {
    vi.spyOn(himalaya, "listHimalayaAccounts").mockResolvedValue([
      { alias: "work", email: "work@company.com" },
    ]);

    const res = await POST();
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.discoveredCount).toBe(1);
    expect(data.accounts[0].email).toBe("work@company.com");
  });

  it("PATCH sets default account", async () => {
    const [account] = syncMailAccountsFromHimalaya([
      { alias: "work", email: "work@company.com" },
      { alias: "personal", email: "me@gmail.com" },
    ]);
    const personal = syncMailAccountsFromHimalaya([
      { alias: "work", email: "work@company.com" },
      { alias: "personal", email: "me@gmail.com" },
    ]).find((row) => row.alias === "personal");

    const res = await PATCH(
      new NextRequest("http://localhost/api/mail-accounts/x", {
        method: "PATCH",
        body: JSON.stringify({ default: true }),
      }),
      { params: Promise.resolve({ id: personal!.id }) }
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.account.isDefault).toBe(true);
    expect(account).toBeTruthy();
  });

  it("DELETE unregisters account", async () => {
    const [account] = syncMailAccountsFromHimalaya([{ alias: "work", email: "work@company.com" }]);

    const res = await DELETE(
      new NextRequest("http://localhost/api/mail-accounts/x", { method: "DELETE" }),
      { params: Promise.resolve({ id: account.id }) }
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.warning).toMatch(/Himalaya config/i);
  });
});
