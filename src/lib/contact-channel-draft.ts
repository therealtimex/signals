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
