import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  cta?: {
    label: string;
    href: string;
  };
  action?: ReactNode;
}

export function EmptyState({ icon: Icon, title, description, cta, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 animate-fade-slide-in">
      <div className="gradient-brand rounded-full p-4 mb-4">
        <Icon className="h-8 w-8 text-white" />
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
