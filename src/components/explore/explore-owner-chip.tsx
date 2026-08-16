import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type ExploreOwnerChipProps = {
  name: string;
  onChange: () => void;
  className?: string;
};

export function ExploreOwnerChip({ name, onChange, className }: ExploreOwnerChipProps) {
  return (
    <div className={`flex items-center gap-2 ${className ?? ""}`}>
      <Badge variant="secondary">You: {name}</Badge>
      <Button variant="ghost" size="sm" onClick={onChange}>
        Change
      </Button>
    </div>
  );
}
