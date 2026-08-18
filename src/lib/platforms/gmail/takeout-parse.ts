/** Parsed contact row from Google Takeout vCard or Contacts CSV. */
export interface TakeoutContactRow {
  resourceId: string;
  firstName: string;
  lastName: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  title: string | null;
  location: string | null;
  notes: string | null;
}

function unfoldVcardLines(text: string): string[] {
  const raw = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines: string[] = [];
  for (const line of raw.split("\n")) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1);
    } else {
      lines.push(line);
    }
  }
  return lines;
}

function parseVcardProperty(line: string): { key: string; value: string } | null {
  const colon = line.indexOf(":");
  if (colon === -1) return null;
  const left = line.slice(0, colon);
  const value = line.slice(colon + 1).trim();
  const key = left.split(";")[0]?.toUpperCase() ?? "";
  if (!key) return null;
  return { key, value };
}

function parseStructuredName(value: string): { firstName: string; lastName: string } {
  const parts = value.split(";").map((part) => part.trim());
  const lastName = parts[0] ?? "";
  const firstName = parts[1] ?? "";
  return { firstName, lastName };
}

function makeResourceId(email: string | null, uid: string | null, index: number): string {
  if (uid) return `takeout:${uid}`;
  if (email) return `takeout:${email.toLowerCase()}`;
  return `takeout:unknown-${index}`;
}

/** Parse one or more vCard blocks from Takeout export text. */
export function parseTakeoutVcards(text: string): TakeoutContactRow[] {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const blocks = normalized.split(/BEGIN:VCARD/i).slice(1);
  const rows: TakeoutContactRow[] = [];

  blocks.forEach((block, index) => {
    const body = block.split(/END:VCARD/i)[0] ?? "";
    const props = new Map<string, string[]>();

    for (const line of unfoldVcardLines(body)) {
      const parsed = parseVcardProperty(line.trim());
      if (!parsed || !parsed.value) continue;
      const existing = props.get(parsed.key) ?? [];
      existing.push(parsed.value);
      props.set(parsed.key, existing);
    }

    const fn = props.get("FN")?.[0] ?? "";
    const n = props.get("N")?.[0];
    const nameParts = n ? parseStructuredName(n) : { firstName: "", lastName: "" };
    const email =
      props.get("EMAIL")?.find(Boolean)?.toLowerCase() ??
      props.get("ITEM1.EMAIL")?.find(Boolean)?.toLowerCase() ??
      null;
    const phone = props.get("TEL")?.find(Boolean) ?? null;
    const orgRaw = props.get("ORG")?.[0] ?? "";
    const [company = "", title = ""] = orgRaw.split(";").map((part) => part.trim());
    const location = props.get("ADR")?.[0]?.split(";").filter(Boolean).join(", ") ?? null;
    const notes = props.get("NOTE")?.[0] ?? null;
    const uid = props.get("UID")?.[0] ?? props.get("X-ABUID")?.[0] ?? null;

    const displayName =
      fn ||
      [nameParts.firstName, nameParts.lastName].filter(Boolean).join(" ") ||
      email ||
      "";

    if (!displayName && !email) return;

    rows.push({
      resourceId: makeResourceId(email, uid, index),
      firstName: nameParts.firstName,
      lastName: nameParts.lastName,
      displayName: displayName || "Unknown",
      email,
      phone,
      company: company || null,
      title: title || null,
      location,
      notes,
    });
  });

  return rows;
}

function parseCsvRecords(text: string): string[][] {
  const cleaned = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const records: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];

    if (inQuotes) {
      if (ch === '"') {
        if (cleaned[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && cleaned[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((value) => value.trim().length > 0)) {
        records.push(row);
      }
      row = [];
    } else {
      field += ch;
    }
  }

  row.push(field);
  if (row.some((value) => value.trim().length > 0)) {
    records.push(row);
  }

  return records;
}

/** Parse Google Contacts CSV export (Takeout or direct CSV). */
export function parseTakeoutContactsCsv(text: string): TakeoutContactRow[] {
  const records = parseCsvRecords(text);
  if (records.length < 2) return [];

  const headerFields = records[0]!;
  const colMap = new Map<string, number>();
  for (let i = 0; i < headerFields.length; i++) {
    colMap.set(headerFields[i].trim().toLowerCase(), i);
  }

  const pick = (...names: string[]) => {
    for (const name of names) {
      const idx = colMap.get(name.toLowerCase());
      if (idx !== undefined) return (fields: string[]) => (fields[idx] ?? "").trim();
    }
    return () => "";
  };

  const getGiven = pick("given name", "first name");
  const getFamily = pick("family name", "last name");
  const getName = pick("name");
  const getEmail = pick("e-mail 1 - value", "email", "e-mail address");
  const getPhone = pick("phone 1 - value", "phone");
  const getOrg = pick(
    "organization 1 - name",
    "organization name",
    "organization",
    "company"
  );
  const getTitle = pick("organization 1 - title", "organization title", "title", "position");
  const getLocation = pick("address 1 - formatted", "location");

  const rows: TakeoutContactRow[] = [];

  for (let i = 1; i < records.length; i++) {
    const fields = records[i]!;
    const firstName = getGiven(fields);
    const lastName = getFamily(fields);
    const displayName =
      getName(fields) || [firstName, lastName].filter(Boolean).join(" ") || getEmail(fields);
    const email = getEmail(fields).toLowerCase() || null;

    if (!displayName && !email) continue;

    rows.push({
      resourceId: makeResourceId(email, null, i),
      firstName,
      lastName,
      displayName: displayName || "Unknown",
      email,
      phone: getPhone(fields) || null,
      company: getOrg(fields) || null,
      title: getTitle(fields) || null,
      location: getLocation(fields) || null,
      notes: null,
    });
  }

  return rows;
}

/** Parse Takeout text as vCard or Google Contacts CSV. */
export function parseTakeoutContactsText(text: string, fileName: string): TakeoutContactRow[] {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".csv")) {
    return parseTakeoutContactsCsv(text);
  }
  if (/BEGIN:VCARD/i.test(text)) {
    return parseTakeoutVcards(text);
  }
  return parseTakeoutContactsCsv(text);
}
