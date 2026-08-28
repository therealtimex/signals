"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { BookmarkPlus, Trash2 } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  type ContactListFilterState,
  contactListFiltersToSearchParams,
  contactListHasUserFilters,
} from "@/lib/contacts/list-filter-state";
import {
  BUILTIN_CONTACT_LIST_VIEWS,
  deleteCustomContactListView,
  loadCustomContactListViews,
  matchBuiltinContactListView,
  saveCustomContactListView,
  type StoredContactListView,
} from "@/lib/contacts/list-saved-views";

type ContactListSavedViewsToolbarProps = {
  filters: ContactListFilterState;
};

export function ContactListSavedViewsToolbar({ filters }: ContactListSavedViewsToolbarProps) {
  const router = useRouter();
  const [customViews, setCustomViews] = useState<StoredContactListView[]>([]);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [selectedViewId, setSelectedViewId] = useState("default");

  useEffect(() => {
    setCustomViews(loadCustomContactListViews());
  }, []);

  const activeBuiltin = useMemo(() => matchBuiltinContactListView(filters), [filters]);
  const activeCustom = useMemo(
    () =>
      customViews.find(
        (view) =>
          contactListFiltersToSearchParams(view.filters).toString() ===
          contactListFiltersToSearchParams(filters).toString(),
      ),
    [customViews, filters],
  );

  useEffect(() => {
    if (activeCustom) {
      setSelectedViewId(activeCustom.id);
      return;
    }
    if (activeBuiltin) {
      setSelectedViewId(activeBuiltin.id);
      return;
    }
    if (!contactListHasUserFilters(filters)) {
      setSelectedViewId("default");
    }
  }, [activeBuiltin, activeCustom, filters]);

  function navigateToFilters(next: ContactListFilterState) {
    const params = contactListFiltersToSearchParams(next);
    if (next.archived) {
      params.set("archived", "true");
    }
    router.push(`/dashboard/contacts?${params.toString()}`);
  }

  function applyView(viewId: string) {
    if (viewId === "default") {
      navigateToFilters({ archived: filters.archived });
      return;
    }

    const builtin = BUILTIN_CONTACT_LIST_VIEWS.find((view) => view.id === viewId);
    if (builtin) {
      navigateToFilters({ ...builtin.filters, archived: filters.archived });
      return;
    }

    const custom = customViews.find((view) => view.id === viewId);
    if (custom) {
      navigateToFilters({ ...custom.filters, archived: filters.archived });
    }
  }

  function handleSaveView() {
    const trimmed = saveName.trim();
    if (!trimmed || !contactListHasUserFilters(filters)) return;
    const next = saveCustomContactListView(trimmed, filters);
    setCustomViews(next);
    setSaveName("");
    setSaveOpen(false);
    const saved = next[0];
    if (saved) setSelectedViewId(saved.id);
  }

  function handleDeleteCustomView(id: string) {
    const next = deleteCustomContactListView(id);
    setCustomViews(next);
    if (selectedViewId === id) {
      setSelectedViewId("default");
      navigateToFilters({ archived: filters.archived });
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={selectedViewId} onValueChange={applyView}>
        <SelectTrigger className="w-[220px]">
          <SelectValue placeholder="Saved views" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="default">All contacts</SelectItem>
          <SelectSeparator />
          <SelectGroup>
            <SelectLabel>Suggested</SelectLabel>
            {BUILTIN_CONTACT_LIST_VIEWS.map((view) => (
              <SelectItem key={view.id} value={view.id}>
                {view.name}
              </SelectItem>
            ))}
          </SelectGroup>
          {customViews.length > 0 ? (
            <>
              <SelectSeparator />
              <SelectGroup>
                <SelectLabel>Your views</SelectLabel>
                {customViews.map((view) => (
                  <SelectItem key={view.id} value={view.id}>
                    {view.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </>
          ) : null}
        </SelectContent>
      </Select>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-1.5"
        disabled={!contactListHasUserFilters(filters)}
        onClick={() => setSaveOpen(true)}
      >
        <BookmarkPlus className="h-3.5 w-3.5" />
        Save view
      </Button>
      {activeCustom ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="gap-1.5 text-muted-foreground"
          onClick={() => handleDeleteCustomView(activeCustom.id)}
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete view
        </Button>
      ) : null}

      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save contact view</DialogTitle>
            <DialogDescription>
              Save the current filters as a quick view. Stored locally in this browser.
            </DialogDescription>
          </DialogHeader>
          <Input
            placeholder="View name"
            value={saveName}
            onChange={(event) => setSaveName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") handleSaveView();
            }}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setSaveOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={handleSaveView} disabled={!saveName.trim()}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
