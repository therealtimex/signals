import {
  type ContactListFilterState,
  contactListFiltersEqual,
  contactListFiltersToSearchParams,
} from "@/lib/contacts/list-filter-state";

export type ContactListSavedView = {
  id: string;
  name: string;
  filters: ContactListFilterState;
  builtin?: boolean;
};

export const BUILTIN_CONTACT_LIST_VIEWS: ContactListSavedView[] = [
  {
    id: "needs-enrichment",
    name: "Needs enrichment",
    builtin: true,
    filters: {
      maxEnrichmentScore: "39",
      sort: "enrichmentScore",
      order: "asc",
    },
  },
  {
    id: "follow-back-queue",
    name: "Follow-back queue",
    builtin: true,
    filters: {
      relationshipGoal: "follow_back",
    },
  },
  {
    id: "sparse-prospects",
    name: "Sparse prospects",
    builtin: true,
    filters: {
      funnelStage: "prospect",
      enrichmentTier: "sparse",
    },
  },
  {
    id: "active-goals",
    name: "Has relationship goal",
    builtin: true,
    filters: {
      hasRelationshipGoal: true,
    },
  },
  {
    id: "agent-created",
    name: "Agent-created",
    builtin: true,
    filters: {
      createdSource: "agent",
    },
  },
  {
    id: "linkedin",
    name: "LinkedIn contacts",
    builtin: true,
    filters: {
      platform: "linkedin",
    },
  },
  {
    id: "imported",
    name: "Imported contacts",
    builtin: true,
    filters: {
      createdSource: "import",
    },
  },
];

const STORAGE_KEY = "signals.contact-list.saved-views";
const MAX_CUSTOM_VIEWS = 12;

export type StoredContactListView = {
  id: string;
  name: string;
  filters: ContactListFilterState;
  createdAt: number;
};

export function savedViewToQueryString(view: ContactListSavedView | StoredContactListView): string {
  return contactListFiltersToSearchParams(view.filters).toString();
}

export function matchBuiltinContactListView(
  filters: ContactListFilterState,
): ContactListSavedView | null {
  return BUILTIN_CONTACT_LIST_VIEWS.find((view) => contactListFiltersEqual(view.filters, filters)) ?? null;
}

export function loadCustomContactListViews(): StoredContactListView[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredContactListView[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((view) => view?.id && view?.name && view?.filters)
      .slice(0, MAX_CUSTOM_VIEWS);
  } catch {
    return [];
  }
}

export function saveCustomContactListView(name: string, filters: ContactListFilterState): StoredContactListView[] {
  const trimmed = name.trim();
  if (!trimmed) return loadCustomContactListViews();

  const existing = loadCustomContactListViews();
  const duplicate = existing.find((view) => contactListFiltersEqual(view.filters, filters));
  if (duplicate) {
    return existing;
  }

  const entry: StoredContactListView = {
    id: `custom-${Date.now()}`,
    name: trimmed,
    filters,
    createdAt: Date.now(),
  };

  const next = [entry, ...existing].slice(0, MAX_CUSTOM_VIEWS);
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }
  return next;
}

export function deleteCustomContactListView(id: string): StoredContactListView[] {
  const next = loadCustomContactListViews().filter((view) => view.id !== id);
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }
  return next;
}
