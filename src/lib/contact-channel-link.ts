import type { ContactChannel } from "@/lib/db/types";

type LinkableChannel = Pick<ContactChannel, "channelType" | "value" | "valueNormalized">;

const MIN_PHONE_DIGITS = 8;
const PHONE_LIKE = /^\+?[\d\s().-]+$/;
const HANDLE = /^[a-z0-9_.]+$/i;

function digitsOf(value: string): string {
  return value.replace(/\D/g, "");
}

function isPhoneLike(value: string): boolean {
  return PHONE_LIKE.test(value.trim()) && digitsOf(value).length >= MIN_PHONE_DIGITS;
}

/**
 * Where a channel row links to, or null when the stored value cannot form a
 * safe link. `mailto:`/`tel:` open in place; `https:` links open a new tab.
 */
export function channelHref(channel: LinkableChannel): string | null {
  const value = channel.value.trim();
  const normalized = channel.valueNormalized.trim();
  if (!value || !normalized) return null;

  switch (channel.channelType) {
    case "email":
      return `mailto:${value}`;
    case "phone":
    case "imessage": {
      const digits = digitsOf(normalized).length;
      return (normalized.startsWith("+") && digits > 0) || digits >= MIN_PHONE_DIGITS
        ? `tel:${normalized}`
        : null;
    }
    case "whatsapp": {
      const digits = digitsOf(normalized);
      return digits.length >= MIN_PHONE_DIGITS ? `https://wa.me/${digits}` : null;
    }
    case "telegram":
      return HANDLE.test(normalized) ? `https://t.me/${normalized}` : null;
    case "zalo":
      if (isPhoneLike(value)) return `https://zalo.me/${digitsOf(value)}`;
      return HANDLE.test(normalized) ? `https://zalo.me/${normalized}` : null;
    default:
      return null;
  }
}

export function isExternalChannelHref(href: string): boolean {
  return href.startsWith("https:");
}
