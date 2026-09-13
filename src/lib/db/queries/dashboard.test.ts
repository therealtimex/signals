import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { contacts } from "@/lib/db/schema";
import {
  archiveContact,
  createContact,
  listContacts,
  updateContact,
} from "@/lib/db/queries/contacts";
import { getDashboardMetrics, getFunnelDistribution } from "@/lib/db/queries/dashboard";
import { resetCoreTables } from "@/test/db";

describe("dashboard contact population", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("keeps empty dashboard and Contacts totals aligned", () => {
    expect(getDashboardMetrics().totalContacts).toBe(0);
    expect(listContacts().total).toBe(0);
    expect(getFunnelDistribution().every(({ count }) => count === 0)).toBe(true);
  });

  it("uses the default Contacts membership for dashboard totals, funnel, and recents", () => {
    const visible = createContact({ name: "Visible contact" });
    const self = createContact({ name: "Self contact" });
    updateContact(self.id, { isSelf: true });

    const archived = createContact({ name: "Archived contact" });
    archiveContact(archived.id, "fixture");

    const platformActor = createContact({ name: "Platform actor" });
    db.update(contacts)
      .set({ metadata: JSON.stringify({ platformActor: 1 }) })
      .where(eq(contacts.id, platformActor.id))
      .run();

    const contactList = listContacts({ pageSize: 10 });
    const dashboard = getDashboardMetrics();
    const funnelTotal = getFunnelDistribution().reduce((sum, stage) => sum + stage.count, 0);

    expect(contactList.total).toBe(2);
    expect(new Set(contactList.data.map(({ id }) => id))).toEqual(new Set([visible.id, self.id]));
    expect(dashboard.totalContacts).toBe(contactList.total);
    expect(new Set(dashboard.recentContacts.map(({ id }) => id))).toEqual(
      new Set([visible.id, self.id]),
    );
    expect(funnelTotal).toBe(contactList.total);
    expect(listContacts({ includeArchived: true }).total).toBe(3);
  });
});
