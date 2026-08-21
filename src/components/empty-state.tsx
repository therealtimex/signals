import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { SignalsMascot } from "@/components/signals-mascot";
import type { SignalsMascotMood } from "@/components/signals-mascot-mood";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  /** Expression the mascot wears for this particular empty screen. */
  mood?: SignalsMascotMood;
  cta?: {
    label: string;
    href: string;
  };
  action?: ReactNode;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  mood = "curious",
  cta,
  action,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 animate-fade-slide-in">
      <div className="relative mb-4">
        <SignalsMascot mood={mood} size={72} />
        <div className="gradient-brand absolute -bottom-1 -right-1 rounded-full p-2 ring-4 ring-background">
          <Icon className="h-4 w-4 text-white" />
        </div>
      </div>
      <h2 className="text-heading-2 mb-2">{title}</h2>
      <p className="text-muted-foreground text-center max-w-md mb-6">
        {description}
      </p>
      {cta && (
        <Button asChild>
          <Link href={cta.href}>{cta.label}</Link>
        </Button>
      )}
      {action}
    </div>
  );
}
