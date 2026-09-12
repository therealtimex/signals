import type { GuestBoundary, GuestBoundaryReason } from "@/lib/workflows/event-sources/types";

const REASON_LABELS: Record<Exclude<GuestBoundaryReason, null>, string> = {
  public_only: "signed-in guest access was not requested",
  login_required: "the selected session must sign in",
  registration_required: "event registration is required",
  waitlisted: "the selected viewer is waitlisted",
  permission_missing: "the guest list is not visibly accessible",
  session_changed: "the visible browser identity changed",
  lease_lost: "the browser lease expired or changed",
  parse_failed: "the guest boundary could not be verified",
  rate_limited: "the provider request budget was exhausted",
};

export function describeGuestBoundary(boundary: GuestBoundary): string {
  if (boundary.state === "authorized") return "Authorized guest access verified";
  if (boundary.state === "public") return "Guest information is publicly visible";
  if (boundary.state === "not_requested") {
    return "Public-only; signed-in guest access was not requested";
  }
  const reason = boundary.reason ? REASON_LABELS[boundary.reason] : "the boundary is unknown";
  return boundary.state === "gated"
    ? `Guest list gated: ${reason}`
    : `Signed-in guest access unavailable: ${reason}`;
}
