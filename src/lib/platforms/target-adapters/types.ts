import type { Page } from "playwright";
import type { PlatformTarget } from "@/lib/db/types";
import type {
  PlatformTargetCapability,
  PlatformTargetKind,
  PlatformTargetPlatform,
} from "@/lib/platforms/target-identity";

export type DiscoveredPlatformTarget = {
  platform: PlatformTargetPlatform;
  kind: PlatformTargetKind;
  externalId?: string | null;
  name: string;
  handle?: string | null;
  canonicalUrl?: string | null;
  capabilities: PlatformTargetCapability[];
};

export type PlatformTargetVerification = {
  loggedIn: boolean;
  active: boolean;
  detectedHandle: string | null;
};

export type PlatformTargetActivation = PlatformTargetVerification & {
  switched: boolean;
};

export type PlatformTargetAdapter = {
  discover(page: Page): Promise<DiscoveredPlatformTarget[]>;
  activate(page: Page, target: PlatformTarget): Promise<PlatformTargetActivation>;
  verify(page: Page, target: PlatformTarget): Promise<PlatformTargetVerification>;
};
