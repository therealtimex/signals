import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db/client";
import { platformAccounts } from "@/lib/db/schema";
import {
  listHimalayaMailAccounts,
  setDefaultMailAccount,
  syncMailAccountsFromHimalaya,
  unregisterMailAccount,
} from "@/lib/db/queries/mail-accounts";
import { getDefaultMailAccountAlias } from "@/lib/mail/settings";

describe("mail-accounts queries", () => {
  beforeEach(() => {
    db.delete(platformAccounts).run();
  });

  it("syncs discovered Himalaya accounts and sets first as default", () => {
    const accounts = syncMailAccountsFromHimalaya([
      { alias: "work", email: "work@company.com" },
      { alias: "personal", email: "me@gmail.com" },
    ]);

    expect(accounts).toHaveLength(2);
    expect(getDefaultMailAccountAlias()).toBe("work");
    expect(listHimalayaMailAccounts().find((row) => row.alias === "work")?.isDefault).toBe(true);
  });

  it("updates default mail account", () => {
    const synced = syncMailAccountsFromHimalaya([
      { alias: "work", email: "work@company.com" },
      { alias: "personal", email: "me@gmail.com" },
    ]);
    const personal = synced.find((row) => row.alias === "personal");
    expect(personal).toBeTruthy();

    const updated = setDefaultMailAccount(personal!.id);
    expect(updated?.isDefault).toBe(true);
    expect(getDefaultMailAccountAlias()).toBe("personal");
  });

  it("unregisters account and reassigns default", () => {
    const synced = syncMailAccountsFromHimalaya([
      { alias: "work", email: "work@company.com" },
      { alias: "personal", email: "me@gmail.com" },
    ]);
    const work = synced.find((row) => row.alias === "work");
    expect(work).toBeTruthy();

    unregisterMailAccount(work!.id);
    expect(listHimalayaMailAccounts()).toHaveLength(1);
    expect(getDefaultMailAccountAlias()).toBe("personal");
  });
});
