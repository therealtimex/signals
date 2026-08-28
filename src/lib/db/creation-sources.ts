export const CREATED_SOURCES = ["manual", "agent", "import", "sync", "api"] as const;
export type CreatedSource = (typeof CREATED_SOURCES)[number];

/**
 * Canonical creation tags. The tag IS the child-row `source` string the same
 * path writes (channels/employments), so birth and child provenance can never
 * drift. `createdSource` is derived from the prefix; `createdSourceDetail`
 * stores the full tag.
 */
export const CREATION_TAGS = {
  "manual:create_contact": "manual",
  "manual:create_org": "manual",
  "api:create_contact": "api",
  "api:create_org": "api",
  "agent:create_contact": "agent",
  "agent:create_org": "agent",
  "import:x_archive": "import",
  "import:linkedin_csv": "import",
  "import:gmail_takeout": "import",
  "sync:x_contacts": "sync",
  "sync:linkedin_contacts": "sync",
  "sync:gmail_contacts": "sync",
  "sync:himalaya_correspondents": "sync",
} as const satisfies Record<string, CreatedSource>;

export type CreationTag = keyof typeof CREATION_TAGS;

export const CREATION_TAG_LABELS: Record<CreationTag, string> = {
  "manual:create_contact": "Added manually",
  "manual:create_org": "Added manually",
  "api:create_contact": "Created via API",
  "api:create_org": "Created via API",
  "agent:create_contact": "Agent (create_contact)",
  "agent:create_org": "Agent (create_org)",
  "import:x_archive": "X archive import",
  "import:linkedin_csv": "LinkedIn CSV import",
  "import:gmail_takeout": "Gmail Takeout import",
  "sync:x_contacts": "Synced from X",
  "sync:linkedin_contacts": "Synced from LinkedIn",
  "sync:gmail_contacts": "Synced from Gmail",
  "sync:himalaya_correspondents": "Mail scan",
};

export const BIRTH_FIELD_KEYS = [
  "createdSource",
  "createdSourceDetail",
  "createdWorkflowRunId",
  "createdTemplateId",
] as const;

export type BirthFieldKey = (typeof BIRTH_FIELD_KEYS)[number];

export function isCreationTag(value: string): value is CreationTag {
  return value in CREATION_TAGS;
}

export function assertCreationTag(value: string): CreationTag {
  if (!isCreationTag(value)) {
    throw new Error(`Invalid creation tag: ${value}`);
  }
  return value;
}

export function createdSourceFromTag(tag: CreationTag): CreatedSource {
  return CREATION_TAGS[tag];
}

export type CreationDetailFilterResolution =
  | { kind: "tag"; tag: CreationTag }
  | { kind: "exact"; value: string }
  | { kind: "ambiguous"; value: string; candidates: CreationTag[] };

/**
 * Resolve a `createdSourceDetail` filter value. Canonical tags pass through;
 * bare suffixes map when exactly one registry tag matches.
 */
export function resolveCreationDetailFilter(value: string): CreationDetailFilterResolution {
  if (value.includes(":")) {
    if (isCreationTag(value)) {
      return { kind: "tag", tag: value };
    }
    return { kind: "exact", value };
  }

  const candidates = (Object.keys(CREATION_TAGS) as CreationTag[]).filter((tag) =>
    tag.endsWith(`:${value}`),
  );

  if (candidates.length === 1) {
    return { kind: "tag", tag: candidates[0]! };
  }
  if (candidates.length > 1) {
    return { kind: "ambiguous", value, candidates };
  }
  return { kind: "exact", value };
}

export function formatAmbiguousCreationDetailError(resolution: {
  kind: "ambiguous";
  value: string;
  candidates: CreationTag[];
}): string {
  return `Ambiguous createdSourceDetail "${resolution.value}": matches ${resolution.candidates.join(", ")}`;
}

export class CreatedSourceDetailFilterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CreatedSourceDetailFilterError";
  }
}

/** Resolve a list-filter detail value to the canonical tag or exact raw value. */
export function resolveCreatedSourceDetailForFilter(value: string): string {
  const resolution = resolveCreationDetailFilter(value);
  if (resolution.kind === "ambiguous") {
    throw new CreatedSourceDetailFilterError(formatAmbiguousCreationDetailError(resolution));
  }
  if (resolution.kind === "tag") {
    return resolution.tag;
  }
  return resolution.value;
}

const SYNC_PLATFORM_LABELS: Partial<Record<CreationTag, string>> = {
  "sync:x_contacts": "X",
  "sync:linkedin_contacts": "LinkedIn",
  "sync:gmail_contacts": "Gmail",
  "sync:himalaya_correspondents": "Mail scan",
};

export function formatContactSourceLine(input: {
  createdSource: CreatedSource;
  createdSourceDetail: string | null;
  createdWorkflowRunId: string | null;
  createdAt: number;
  createdTemplateName?: string | null;
}): string {
  const date = new Date(input.createdAt * 1000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const runFragment = input.createdWorkflowRunId
    ? ` · run ${input.createdWorkflowRunId.slice(0, 8)}`
    : "";

  switch (input.createdSource) {
    case "manual":
      return `Added manually · ${date}`;
    case "agent": {
      if (input.createdTemplateName) {
        return `${input.createdTemplateName} agent${runFragment} · ${date}`;
      }
      return `Agent (create_contact)${runFragment} · ${date}`;
    }
    case "import": {
      const detail = input.createdSourceDetail as CreationTag | null;
      const label =
        detail && detail in CREATION_TAG_LABELS
          ? CREATION_TAG_LABELS[detail as CreationTag]
          : "Import";
      return `${label}${runFragment} · ${date}`;
    }
    case "sync": {
      const detail = input.createdSourceDetail as CreationTag | null;
      const platform =
        detail && detail in SYNC_PLATFORM_LABELS
          ? SYNC_PLATFORM_LABELS[detail as CreationTag]
          : "platform";
      return `Synced from ${platform} · ${date}`;
    }
    case "api":
      return `Created via API${runFragment} · ${date}`;
    default:
      return `Created · ${date}`;
  }
}
