"use client";

import { useCallback, useEffect, useState } from "react";
import type { ContactWithIdentities } from "@/lib/db/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type ExploreSelfPickerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentOwnerId: string | null;
  onOwnerChanged: () => void;
};

function contactSubtitle(contact: ContactWithIdentities): string {
  if (contact.company && contact.title) {
    return `${contact.company} · ${contact.title}`;
  }
  if (contact.company) return contact.company;
  if (contact.email) return contact.email;
  if (contact.headline) return contact.headline;
  return "";
}

export function ExploreSelfPicker({
  open,
  onOpenChange,
  currentOwnerId,
  onOwnerChanged,
}: ExploreSelfPickerProps) {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [contacts, setContacts] = useState<ContactWithIdentities[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const loadContacts = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ pageSize: "20" });
      if (debouncedSearch) {
        params.set("search", debouncedSearch);
      }
      const res = await fetch(`/api/contacts?${params.toString()}`);
      if (!res.ok) {
        throw new Error("Failed to load contacts");
      }
      const body = (await res.json()) as { data: ContactWithIdentities[] };
      setContacts(body.data);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load contacts");
      setContacts([]);
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch]);

  useEffect(() => {
    if (!open) return;
    setSelectedId(null);
    setError(null);
    void loadContacts();
  }, [open, loadContacts]);

  async function handleConfirm() {
    if (!selectedId) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/contacts/${selectedId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isSelf: true }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Request failed (${res.status})`);
      }
      onOpenChange(false);
      onOwnerChanged();
    } catch (confirmError) {
      setError(confirmError instanceof Error ? confirmError.message : "Failed to set self contact");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Who are you?</DialogTitle>
          <DialogDescription>
            Pick the contact that represents you. Signals keeps at most one self contact.
          </DialogDescription>
        </DialogHeader>
        <Input
          placeholder="Search contacts..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <div className="max-h-64 space-y-1 overflow-y-auto">
          {loading ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Loading contacts...</p>
          ) : contacts.length === 0 ? (
            <div className="py-4 text-center text-sm text-muted-foreground">
              <p>No contacts match</p>
              <p className="mt-1">You can create your profile instead.</p>
            </div>
          ) : (
            contacts.map((contact) => {
              const isCurrent = contact.id === currentOwnerId;
              const isSelected = contact.id === selectedId;
              return (
                <button
                  key={contact.id}
                  type="button"
                  disabled={isCurrent}
                  onClick={() => setSelectedId(contact.id)}
                  className={`flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                    isCurrent
                      ? "cursor-not-allowed border-border bg-muted/40 opacity-70"
                      : isSelected
                        ? "border-primary bg-primary/5"
                        : "border-transparent hover:bg-muted/50"
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block font-medium truncate">{contact.name}</span>
                    {contactSubtitle(contact) ? (
                      <span className="block truncate text-xs text-muted-foreground">
                        {contactSubtitle(contact)}
                      </span>
                    ) : null}
                  </span>
                  {isCurrent ? <Badge variant="secondary">Current</Badge> : null}
                </button>
              );
            })
          )}
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void handleConfirm()} disabled={!selectedId || saving}>
            {saving ? "Saving..." : "Set as me"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
