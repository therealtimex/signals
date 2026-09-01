import type { Platform } from "@/lib/db/platforms";
import { SURFACE_IDS, type SurfaceId } from "@/lib/writing/surfaces";

export type PublishCapability =
  | "direct"
  | "beta"
  | "draft_only"
  | "export_only"
  | "unsupported";

export type CapabilityState = "supported" | "beta" | "unsupported";

export type SurfaceCapabilities = {
  research: CapabilityState;
  draft: CapabilityState;
  audit: CapabilityState;
  export: CapabilityState;
  target: CapabilityState;
  publish: PublishCapability;
  metrics: CapabilityState;
  engage: CapabilityState;
  notes?: string;
};

const supportedPublish = (
  publish: "direct" | "beta",
  metrics: CapabilityState,
  notes: string,
): SurfaceCapabilities => ({
  research: "supported",
  draft: "supported",
  audit: "supported",
  export: "supported",
  target: "supported",
  publish,
  metrics,
  engage: "unsupported",
  notes,
});

/**
 * A surface Signals can research, draft, audit, and export, but never send.
 *
 * Replies, comments, and direct messages have no publish adapter and are not getting one here
 * (#377 keeps nurture `assist_only`), so `publish` stays `draft_only` and `engage` stays
 * `unsupported`. Draft and audit are supported because the shared writing-intent lane needs a real
 * audited artifact before approval.
 */
const assistOnlySurface = (notes: string): SurfaceCapabilities => ({
  research: "supported",
  draft: "supported",
  audit: "supported",
  export: "supported",
  target: "supported",
  publish: "draft_only",
  metrics: "unsupported",
  engage: "unsupported",
  notes,
});

const futureSurface = (
  publish: "draft_only" | "export_only",
  target: CapabilityState,
  notes: string,
): SurfaceCapabilities => ({
  research: "unsupported",
  draft: "unsupported",
  audit: "unsupported",
  export: publish === "export_only" ? "supported" : "unsupported",
  target,
  publish,
  metrics: "unsupported",
  engage: "unsupported",
  notes,
});

export const WRITING_SURFACE_CAPABILITIES: Record<SurfaceId, SurfaceCapabilities> = {
  "x/post": supportedPublish("direct", "supported", "x-publish.cjs"),
  "x/thread": supportedPublish("direct", "supported", "x-publish.cjs"),
  "x/reply": assistOnlySurface("Draft/audit only; reply submission has no adapter."),
  "x/quote": futureSurface(
    "draft_only",
    "supported",
    "Quote publish exists; its writing overlay lands in #353.",
  ),
  "x/direct_message": assistOnlySurface("Draft/audit only; DM sending has no adapter."),
  "linkedin/post": supportedPublish(
    "beta",
    "supported",
    "Shared connections are verify-only; use a dedicated connection for multiple members.",
  ),
  "linkedin/comment": assistOnlySurface("Draft/audit only; comment submission has no adapter."),
  "linkedin/direct_message": assistOnlySurface(
    "Draft/audit only; message and InMail sending have no adapter.",
  ),
  "facebook/post": supportedPublish(
    "direct",
    "beta",
    "Target kind may be profile or page; publisher is facebook-publish.cjs.",
  ),
  "facebook/comment": assistOnlySurface("Draft/audit only; comment submission has no adapter."),
  "facebook/direct_message": assistOnlySurface(
    "Draft/audit only; message sending has no adapter.",
  ),
  "threads/post": futureSurface("draft_only", "unsupported", "No target adapter or publisher."),
  "threads/thread": futureSurface("draft_only", "unsupported", "No target adapter or publisher."),
  "instagram/caption": futureSurface("draft_only", "unsupported", "No target adapter or publisher."),
  "instagram/carousel": futureSurface("draft_only", "unsupported", "No target adapter or publisher."),
  "tiktok/caption": futureSurface("draft_only", "unsupported", "No target adapter or publisher."),
  "tiktok/script": futureSurface("draft_only", "unsupported", "No target adapter or publisher."),
  "youtube/title": futureSurface("draft_only", "unsupported", "No target adapter or publisher."),
  "youtube/description": futureSurface("draft_only", "unsupported", "No target adapter or publisher."),
  "youtube/community_post": futureSurface("draft_only", "unsupported", "No target adapter or publisher."),
  "youtube/hook_script": futureSurface("draft_only", "unsupported", "No target adapter or publisher."),
  "youtube/thumbnail_brief": futureSurface(
    "export_only",
    "unsupported",
    "Exportable brief; no target adapter or publisher.",
  ),
};

export function getSurfaceCapabilities(surface: SurfaceId): SurfaceCapabilities {
  return WRITING_SURFACE_CAPABILITIES[surface];
}

/**
 * Whether a surface may reach a publish/send adapter at all.
 *
 * The publish lane asks this instead of re-deriving the `direct | beta` pair, so a surface added
 * with `draft_only`/`export_only`/`unsupported` is unreachable by construction.
 */
export function canReachPublishAdapter(capability: PublishCapability): boolean {
  return capability === "direct" || capability === "beta";
}

const PUBLISH_RANK: Record<PublishCapability, number> = {
  unsupported: 0,
  export_only: 1,
  draft_only: 2,
  beta: 3,
  direct: 4,
};

export function publishCapabilityForPlatform(platform: Platform): PublishCapability {
  let capability: PublishCapability = "draft_only";
  for (const surface of SURFACE_IDS) {
    if (!surface.startsWith(`${platform}/`)) continue;
    const candidate = WRITING_SURFACE_CAPABILITIES[surface].publish;
    if (PUBLISH_RANK[candidate] > PUBLISH_RANK[capability]) capability = candidate;
  }
  return capability;
}

function collectPublishCapablePlatforms(): readonly Platform[] {
  const platforms = new Set<Platform>();
  for (const surface of SURFACE_IDS) {
    const publish = WRITING_SURFACE_CAPABILITIES[surface].publish;
    if (publish === "direct" || publish === "beta") {
      platforms.add(surface.split("/")[0] as Platform);
    }
  }
  return [...platforms];
}

export const PUBLISH_CAPABLE_PLATFORMS = collectPublishCapablePlatforms();
