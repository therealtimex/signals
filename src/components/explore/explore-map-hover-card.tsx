"use client";

import { contactDisplayInitials } from "@/lib/contact-avatar-client";
import type { ExploreMapHoverContact } from "@/components/explore/explore-map-canvas";

type ExploreMapHoverCardProps = {
  contact: ExploreMapHoverContact | null;
};

export function ExploreMapHoverCard({ contact }: ExploreMapHoverCardProps) {
  if (!contact) return null;

  const initials = contactDisplayInitials({ name: contact.label });

  return (
    <div
      className="pointer-events-none absolute z-20 w-56 rounded-xl border border-border/60 bg-background/95 p-3 shadow-lg backdrop-blur-md"
      style={{
        left: contact.screenX + 14,
        top: contact.screenY - 12,
      }}
      data-testid="explore-map-hover-card"
    >
      <div className="flex items-start gap-3">
        {contact.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={contact.avatarUrl}
            alt=""
            className="h-10 w-10 shrink-0 rounded-full object-cover"
          />
        ) : (
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
            {initials}
          </div>
        )}
        <div className="min-w-0 space-y-0.5">
          <p className="truncate text-sm font-semibold">{contact.label}</p>
          <p className="text-xs text-muted-foreground">Click for full explore card</p>
        </div>
      </div>
    </div>
  );
}
