import { CHANNEL_TYPES } from "@/lib/db/channel-types";
import type { ContactChannel } from "@/lib/db/types";

export type DraftContactChannel = {
  id?: string;
  channelType: string;
  value: string;
  label?: string;
  isPrimary?: boolean;
  isVerified?: boolean;
};

export const CONTACT_CHANNEL_TYPES = CHANNEL_TYPES;

export const channelTypeLabels: Record<string, string> = {
  email: "Email",
  phone: "Phone",
  whatsapp: "WhatsApp",
  telegram: "Telegram",
  signal: "Signal",
  imessage: "iMessage",
  wechat: "WeChat",
  zalo: "Zalo",
  discord: "Discord",
  slack: "Slack",
  other: "Other",
};

export function emptyDraftChannel(): DraftContactChannel {
  return {
    channelType: "email",
    value: "",
    isPrimary: false,
    isVerified: false,
  };
}

export function draftFromContactChannel(channel: ContactChannel): DraftContactChannel {
  return {
    id: channel.id,
    channelType: channel.channelType,
    value: channel.value,
    label: channel.label ?? undefined,
    isPrimary: channel.isPrimary,
    isVerified: channel.isVerified,
  };
}

/** Label presets offered in the channel dialog; storage stays free text (ADR-534-5). */
export const CHANNEL_LABEL_PRESETS = ["work", "personal", "other"] as const;

const channelLabelPresetText: Record<string, string> = {
  work: "Work",
  personal: "Personal",
  other: "Other",
};

/** Display text for a stored label: presets get their title, anything else shows as stored. */
export function channelLabelText(label: string | null | undefined): string | null {
  const trimmed = label?.trim();
  if (!trimmed) return null;
  return channelLabelPresetText[trimmed] ?? trimmed;
}

/** Channel types whose Verified switch the dialog shows (the API accepts it for any type). */
export const VERIFIABLE_CHANNEL_TYPES: readonly string[] = ["email", "phone"];

export function channelValuePlaceholder(channelType: string): string {
  switch (channelType) {
    case "email":
      return "email@example.com";
    case "phone":
    case "whatsapp":
    case "imessage":
      return "+84 9x xxx xxxx";
    case "other":
      return "";
    default:
      return "@handle";
  }
}

/** "This contact already has that …" noun for the duplicate (409) message. */
export function channelDuplicateNoun(channelType: string): string {
  if (channelType === "email") return "email address";
  if (channelType === "phone") return "phone number";
  return `${channelTypeLabels[channelType] ?? channelType} channel`;
}
