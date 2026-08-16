import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { contacts, contactIdentities } from "@/lib/db/schema";
import { createContact, updateContact, recalcEnrichment } from "@/lib/db/queries/contacts";
import { findContactByChannel } from "@/lib/db/queries/contact-channels";
import { createIdentity } from "@/lib/db/queries/identities";
import type { SyncResult } from "@/lib/platforms/adapter";

/** Shape of a single row from LinkedIn's Connections CSV export. */
export interface LinkedInCsvRow {
  firstName: string;
  lastName: string;
  url: string;
  email: string;
  company: string;
  position: string;
  connectedOn: string;
}

/**
 * Parse a LinkedIn Connections CSV string into typed rows.
 *
 * LinkedIn exports clean UTF-8 CSVs with this header:
 *   First Name,Last Name,URL,Email Address,Company,Position,Connected On
 *
 * Handles optional BOM, quoted fields, and empty trailing lines.
 */
export function parseLinkedInCsv(text: string): LinkedInCsvRow[] {
  // Strip UTF-8 BOM if present
  const cleaned = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const lines = cleaned.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return []; // Need at least header + one data row

  // LinkedIn CSVs may have a "Notes:" preamble before the actual header.
  // Scan for the real header line containing "First Name".
  let headerLineIdx = 0;
  for (let i = 0; i < Math.min(lines.length, 10); i++) {
    if (lines[i].toLowerCase().includes("first name")) {
      headerLineIdx = i;
      break;
    }
  }

  // Parse header to discover column indices (LinkedIn may vary casing/order)
  const headerFields = parseCsvLine(lines[headerLineIdx]);
  const colMap = new Map<string, number>();
  for (let i = 0; i < headerFields.length; i++) {
    colMap.set(headerFields[i].trim().toLowerCase(), i);
  }

  // Map known column names
  const firstNameIdx = colMap.get("first name") ?? -1;
  const lastNameIdx = colMap.get("last name") ?? -1;
  const urlIdx = colMap.get("url") ?? -1;
  const emailIdx = colMap.get("email address") ?? -1;
  const companyIdx = colMap.get("company") ?? -1;
  const positionIdx = colMap.get("position") ?? -1;
  const connectedOnIdx = colMap.get("connected on") ?? -1;

  // Require at least firstName + lastName columns
  if (firstNameIdx === -1 || lastNameIdx === -1) {
    throw new Error("Invalid LinkedIn CSV: missing 'First Name' or 'Last Name' columns");
  }

  const rows: LinkedInCsvRow[] = [];
  for (let i = headerLineIdx + 1; i < lines.length; i++) {
    const fields = parseCsvLine(lines[i]);
    const firstName = (fields[firstNameIdx] ?? "").trim();
    const lastName = (fields[lastNameIdx] ?? "").trim();

    // Skip rows with no name (LinkedIn CSVs sometimes have empty trailing rows)
    if (!firstName && !lastName) continue;

    rows.push({
      firstName,
      lastName,
      url: (fields[urlIdx] ?? "").trim(),
      email: (fields[emailIdx] ?? "").trim(),
      company: (fields[companyIdx] ?? "").trim(),
      position: (fields[positionIdx] ?? "").trim(),
      connectedOn: (fields[connectedOnIdx] ?? "").trim(),
    });
  }

  return rows;
}

/**
 * Parse a single CSV line, handling quoted fields with commas.
 * Returns array of field values with quotes stripped.
 */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (inQuotes) {
      if (ch === '"') {
        // Check for escaped quote (double-quote)
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++; // skip the next quote
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        fields.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
  }

  fields.push(current); // Last field
  return fields;
}

/**
 * Extract the LinkedIn vanity name (slug) from a profile URL.
 * e.g. "https://www.linkedin.com/in/john-smith" → "john-smith"
 *      "https://www.linkedin.com/in/john-smith/" → "john-smith"
 */
function extractVanityName(url: string): string | null {
  if (!url) return null;
  const match = url.match(/linkedin\.com\/in\/([^/?#]+)/);
  if (!match) return null;
  return match[1].replace(/\/+$/, "");
}

/**
 * Import LinkedIn CSV rows into Signals contacts.
 *
 * Dedup strategy:
 *   1. Check contactIdentities for platform="linkedin" + matching vanityName
 *   2. If no identity match but email exists, check contact_channels (email)
 *   3. Otherwise create new contact + identity
 *
 * CSV provides company + position fields that API sync doesn't,
 * so we always update those when merging.
 */
export function importLinkedInCsv(rows: LinkedInCsvRow[]): SyncResult {
  const result: SyncResult = { added: 0, updated: 0, skipped: 0, errors: [] };

  for (const row of rows) {
    try {
      processRow(row, result);
    } catch (err) {
      const name = `${row.firstName} ${row.lastName}`.trim();
      result.errors.push(
        `Failed to process ${name}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  return result;
}

/** Process a single CSV row — create, update, or enrich an existing contact. */
function processRow(row: LinkedInCsvRow, result: SyncResult): void {
  const vanityName = extractVanityName(row.url);
  const fullName = [row.firstName, row.lastName].filter(Boolean).join(" ");

  if (!vanityName && !fullName) {
    // Row has no usable identifier — skip it (e.g. all-empty rows with just a date)
    result.skipped++;
    return;
  }

  // Skip rows where name is just whitespace artifacts from malformed CSV
  if (!fullName && !row.email) {
    result.skipped++;
    return;
  }

  // --- Tier 1: match by LinkedIn identity ---
  if (vanityName) {
    const existingIdentity = db
      .select()
      .from(contactIdentities)
      .where(
        and(
          eq(contactIdentities.platform, "linkedin"),
          eq(contactIdentities.platformUserId, vanityName)
        )
      )
      .get();

    if (existingIdentity) {
      // Update existing contact with CSV data (company, title, email)
      const updates: Record<string, string | undefined> = {};
      if (row.company) updates.company = row.company;
      if (row.position) updates.title = row.position;
      if (row.email) updates.email = row.email;

      if (Object.keys(updates).length > 0) {
        updateContact(existingIdentity.contactId, updates);
      }

      recalcEnrichment(existingIdentity.contactId);
      result.updated++;
      return;
    }
  }

  // --- Tier 2: match by email channel ---
  if (row.email) {
    const existingContact = findContactByChannel("email", row.email);

    if (existingContact) {
      // Update contact fields from CSV
      const updates: Record<string, string | undefined> = {};
      if (row.company) updates.company = row.company;
      if (row.position) updates.title = row.position;

      if (Object.keys(updates).length > 0) {
        updateContact(existingContact.id, updates);
      }

      // Add LinkedIn identity to existing contact
      if (vanityName) {
        createIdentity({
          contactId: existingContact.id,
          platform: "linkedin",
          platformUserId: vanityName,
          platformHandle: vanityName || fullName,
          platformUrl: row.url || null,
          platformData: JSON.stringify({
            source: "csv_import",
            connectedOn: row.connectedOn,
          }),
        });
      }

      recalcEnrichment(existingContact.id);
      result.updated++;
      return;
    }
  }

  // --- Tier 3: create new contact + identity ---
  const contact = createContact({
    name: fullName || "Unknown",
    firstName: row.firstName || undefined,
    lastName: row.lastName || undefined,
    email: row.email || undefined,
    company: row.company || undefined,
    title: row.position || undefined,
    profileUrl: row.url || undefined,
  }, "import:linkedin_csv");

  if (vanityName) {
    createIdentity({
      contactId: contact.id,
      platform: "linkedin",
      platformUserId: vanityName,
      platformHandle: vanityName || fullName,
      platformUrl: row.url || null,
      platformData: JSON.stringify({
        source: "csv_import",
        connectedOn: row.connectedOn,
      }),
    });

    recalcEnrichment(contact.id);
  }

  result.added++;
}
