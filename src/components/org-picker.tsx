"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Building2, Loader2, Plus, X } from "lucide-react";
import type { Org } from "@/lib/db/types";

type OrgPickerValue = {
  orgId: string;
  company: string;
};

interface OrgPickerProps {
  id?: string;
  label?: string;
  defaultOrgId?: string;
  defaultOrgName?: string;
  onChange: (value: OrgPickerValue | { orgId: ""; company: "" }) => void;
}

export function OrgPicker({
  id,
  label = "Organization",
  defaultOrgId = "",
  defaultOrgName = "",
  onChange,
}: OrgPickerProps) {
  const listId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState(defaultOrgName);
  const [selected, setSelected] = useState<OrgPickerValue | null>(
    defaultOrgId && defaultOrgName ? { orgId: defaultOrgId, company: defaultOrgName } : null,
  );
  const [results, setResults] = useState<Org[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingCommitted, setEditingCommitted] = useState(false);

  function emitEditedValue(trimmed: string) {
    onChange(trimmed ? { orgId: "", company: trimmed } : { orgId: "", company: "" });
  }

  const searchOrgs = useCallback(async (term: string) => {
    const params = new URLSearchParams();
    if (term.trim()) params.set("search", term.trim());
    params.set("pageSize", "10");

    setLoading(true);
    try {
      const res = await fetch(`/api/orgs?${params.toString()}`);
      if (!res.ok) {
        setResults([]);
        return;
      }
      const body = (await res.json()) as { data: Org[] };
      setResults(body.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const handle = window.setTimeout(() => {
      void searchOrgs(query);
    }, 200);
    return () => window.clearTimeout(handle);
  }, [open, query, searchOrgs]);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  function selectOrg(org: Org) {
    const value = { orgId: org.id, company: org.name };
    setSelected(value);
    setQuery(org.name);
    setOpen(false);
    setError(null);
    setEditingCommitted(false);
    onChange(value);
  }

  function clearSelection() {
    setSelected(null);
    setQuery("");
    setResults([]);
    setOpen(false);
    setError(null);
    setEditingCommitted(false);
    onChange({ orgId: "", company: "" });
  }

  async function createOrg(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;

    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/orgs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(typeof body.error === "string" ? body.error : "Failed to create organization");
        return;
      }
      const org = (await res.json()) as Org;
      selectOrg(org);
    } finally {
      setCreating(false);
    }
  }

  const trimmedQuery = query.trim();
  const exactMatch = results.some(
    (org) => org.name.localeCompare(trimmedQuery, undefined, { sensitivity: "accent" }) === 0,
  );
  const showCreate = trimmedQuery.length > 0 && !exactMatch;

  return (
    <div ref={containerRef} className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Building2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          id={id}
          value={query}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          className={cn("pl-9", selected ? "pr-9" : undefined)}
          placeholder="Search organizations..."
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            const next = e.target.value;
            setQuery(next);
            setOpen(true);

            const trimmed = next.trim();
            const hadCommittedOrg = Boolean(selected) || Boolean(defaultOrgName.trim());

            if (selected) {
              setSelected(null);
              setEditingCommitted(true);
              emitEditedValue(trimmed);
              return;
            }

            if (editingCommitted) {
              emitEditedValue(trimmed);
              return;
            }

            if (hadCommittedOrg) {
              setEditingCommitted(true);
              emitEditedValue(trimmed);
              return;
            }

            if (!trimmed) {
              onChange({ orgId: "", company: "" });
            }
          }}
        />
        {selected ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2"
            onClick={clearSelection}
            aria-label="Clear organization"
          >
            <X className="h-4 w-4" />
          </Button>
        ) : null}
        {open ? (
          <div
            id={listId}
            role="listbox"
            className="absolute z-50 mt-1 max-h-56 w-full overflow-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
          >
            {loading ? (
              <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Searching...
              </div>
            ) : null}
            {!loading && results.length === 0 && !showCreate ? (
              <div className="px-3 py-2 text-sm text-muted-foreground">No organizations found</div>
            ) : null}
            {results.map((org) => (
              <button
                key={org.id}
                type="button"
                role="option"
                aria-selected={selected?.orgId === org.id}
                className="flex w-full items-center rounded-sm px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => selectOrg(org)}
              >
                <span className="font-medium">{org.name}</span>
                {org.domain ? (
                  <span className="ml-2 truncate text-muted-foreground">{org.domain}</span>
                ) : null}
              </button>
            ))}
            {showCreate ? (
              <button
                type="button"
                role="option"
                aria-selected={false}
                className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                disabled={creating}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => void createOrg(trimmedQuery)}
              >
                {creating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                Create &ldquo;{trimmedQuery}&rdquo;
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
