import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { browserConnectionOrigins, browserConnections } from "@/lib/db/schema";
import {
  addConnectionOrigin,
  listConnectionOrigins,
  removeConnectionOrigin,
} from "@/lib/db/queries/browser-connection-origins";
import { ensureBrowserConnection } from "@/lib/db/queries/platform-targets";
import { resetCoreTables } from "@/test/db";

describe("browser connection origins", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("adds an origin once and reports the duplicate without a second row", () => {
    const connection = ensureBrowserConnection({ sessionName: "signals-publish" });

    const first = addConnectionOrigin({
      connectionId: connection.id,
      origin: "https://example.org",
      source: "settings",
    });
    const second = addConnectionOrigin({
      connectionId: connection.id,
      origin: "https://example.org",
      source: "recovery",
    });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    // The first row wins: a later add from a run doesn't rewrite where it came from.
    expect(second.row).toEqual(first.row);
    expect(listConnectionOrigins(connection.id)).toHaveLength(1);
  });

  it("keeps each connection's list separate", () => {
    const shared = ensureBrowserConnection({ sessionName: "signals-publish" });
    const dedicated = ensureBrowserConnection({ sessionName: "brand-x", kind: "dedicated" });

    addConnectionOrigin({ connectionId: shared.id, origin: "https://example.org", source: "settings" });
    addConnectionOrigin({ connectionId: dedicated.id, origin: "https://example.org", source: "settings" });
    addConnectionOrigin({ connectionId: dedicated.id, origin: "https://other.example", source: "settings" });

    expect(listConnectionOrigins(shared.id).map((row) => row.origin)).toEqual([
      "https://example.org",
    ]);
    expect(listConnectionOrigins(dedicated.id)).toHaveLength(2);
  });

  it("lists newest first, including rows added within the same second", () => {
    const connection = ensureBrowserConnection({ sessionName: "signals-publish" });
    for (const origin of ["https://a.example", "https://b.example", "https://c.example"]) {
      addConnectionOrigin({ connectionId: connection.id, origin, source: "settings" });
    }
    db.update(browserConnectionOrigins)
      .set({ createdAt: 1_700_000_000 })
      .where(eq(browserConnectionOrigins.origin, "https://c.example"))
      .run();

    expect(listConnectionOrigins(connection.id).map((row) => row.origin)).toEqual([
      "https://b.example",
      "https://a.example",
      "https://c.example",
    ]);
  });

  it("removes an origin and reports whether a row was deleted", () => {
    const connection = ensureBrowserConnection({ sessionName: "signals-publish" });
    addConnectionOrigin({ connectionId: connection.id, origin: "https://example.org", source: "settings" });

    expect(removeConnectionOrigin(connection.id, "https://example.org")).toBe(true);
    expect(removeConnectionOrigin(connection.id, "https://example.org")).toBe(false);
    expect(listConnectionOrigins(connection.id)).toEqual([]);
  });

  it("deletes a connection's origins with the connection", () => {
    const connection = ensureBrowserConnection({ sessionName: "brand-x", kind: "dedicated" });
    addConnectionOrigin({ connectionId: connection.id, origin: "https://example.org", source: "recovery" });

    db.delete(browserConnections).where(eq(browserConnections.id, connection.id)).run();

    expect(db.select().from(browserConnectionOrigins).all()).toEqual([]);
  });
});
