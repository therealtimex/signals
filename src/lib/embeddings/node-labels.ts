import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { contacts, contentItems, launches, niches, orgs, variants } from "@/lib/db/schema";
import type { GraphNodeType } from "@/lib/db/types";

export function getNodeDisplayLabel(nodeType: GraphNodeType, nodeId: string): string | null {
  switch (nodeType) {
    case "contact": {
      const row = db.select({ name: contacts.name }).from(contacts).where(eq(contacts.id, nodeId)).get();
      return row?.name ?? null;
    }
    case "org": {
      const row = db.select({ name: orgs.name }).from(orgs).where(eq(orgs.id, nodeId)).get();
      return row?.name ?? null;
    }
    case "niche": {
      const row = db.select({ name: niches.name }).from(niches).where(eq(niches.id, nodeId)).get();
      return row?.name ?? null;
    }
    case "launch": {
      const row = db.select({ name: launches.name }).from(launches).where(eq(launches.id, nodeId)).get();
      return row?.name ?? null;
    }
    case "content": {
      const row = db
        .select({ title: contentItems.title, body: contentItems.body })
        .from(contentItems)
        .where(eq(contentItems.id, nodeId))
        .get();
      if (!row) return null;
      return row.title?.trim() || row.body?.trim()?.slice(0, 80) || null;
    }
    case "variant": {
      const row = db.select({ label: variants.label }).from(variants).where(eq(variants.id, nodeId)).get();
      return row?.label ?? null;
    }
    default:
      return null;
  }
}
