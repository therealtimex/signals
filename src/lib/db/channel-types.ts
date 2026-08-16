/** Canonical channel-type registry — validate open-text writes (contact-golden-record §2.5). */
export const CHANNEL_TYPES = [
  "email",
  "phone",
  "whatsapp",
  "telegram",
  "signal",
  "imessage",
  "wechat",
  "zalo",
  "discord",
  "slack",
  "other",
] as const;

export type ChannelType = (typeof CHANNEL_TYPES)[number];

const HANDLE_TYPES = new Set<ChannelType>([
  "telegram",
  "discord",
  "slack",
  "signal",
  "zalo",
  "wechat",
]);

const PHONE_LIKE_TYPES = new Set<ChannelType>(["phone", "whatsapp", "imessage"]);

export function isChannelType(value: string): value is ChannelType {
  return (CHANNEL_TYPES as readonly string[]).includes(value);
}

export function assertChannelType(value: string): ChannelType {
  if (!isChannelType(value)) {
    throw new Error(`Invalid channel type: ${value}`);
  }
  return value;
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function normalizePhoneLike(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("+")) {
    return `+${trimmed.slice(1).replace(/\D/g, "")}`;
  }
  return trimmed.replace(/\D/g, "");
}

function normalizeHandle(value: string): string {
  const trimmed = value.trim().toLowerCase();
  return trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
}

/** Machine dedup key — never accept from clients (ADR-092-6). */
export function normalizeChannelValue(channelType: ChannelType, value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Channel value is required");
  }

  if (channelType === "email") {
    return normalizeEmail(trimmed);
  }
  if (PHONE_LIKE_TYPES.has(channelType)) {
    return normalizePhoneLike(trimmed);
  }
  if (HANDLE_TYPES.has(channelType)) {
    return normalizeHandle(trimmed);
  }
  if (channelType === "other") {
    return trimmed.toLowerCase();
  }
  return trimmed;
}
