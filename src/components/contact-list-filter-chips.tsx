import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import type { ContactListFilterChip } from "@/lib/contacts/list-filter-state";

type ContactListFilterChipsProps = {
  chips: ContactListFilterChip[];
  onRemove: (chip: ContactListFilterChip) => void;
};

export function ContactListFilterChips({ chips, onRemove }: ContactListFilterChipsProps) {
  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {chips.map((chip) => (
        <Badge
          key={chip.id}
          variant="secondary"
          className="gap-1 pr-1 font-normal max-w-full"
        >
          <span className="truncate">{chip.label}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-5 w-5 shrink-0 hover:bg-transparent"
            aria-label={`Remove ${chip.label}`}
            onClick={() => onRemove(chip)}
          >
            <X className="h-3 w-3" />
          </Button>
        </Badge>
      ))}
    </div>
  );
}
