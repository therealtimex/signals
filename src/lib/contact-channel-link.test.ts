import { describe, expect, it } from "vitest";
import { channelHref, isExternalChannelHref } from "@/lib/contact-channel-link";
import { normalizeChannelValue, type ChannelType } from "@/lib/db/channel-types";

function href(channelType: ChannelType, value: string): string | null {
  return channelHref({ channelType, value, valueNormalized: normalizeChannelValue(channelType, value) });
}

describe("channelHref", () => {
  it.each<[ChannelType, string, string | null]>([
    ["email", "bui-sy.giang@mes-engineering.com.vn", "mailto:bui-sy.giang@mes-engineering.com.vn"],
    ["phone", "+84 91 303 9986", "tel:+84913039986"],
    ["phone", "0913 039 986", "tel:0913039986"],
    ["phone", "ext 12", null],
    ["imessage", "+1 (555) 111-2222", "tel:+15551112222"],
    ["whatsapp", "+84 91 303 9986", "https://wa.me/84913039986"],
    ["whatsapp", "123", null],
    ["telegram", "@Giang_Bui", "https://t.me/giang_bui"],
    ["telegram", "not a handle!", null],
    ["zalo", "+84 91 303 9986", "https://zalo.me/84913039986"],
    ["zalo", "0913039986", "https://zalo.me/0913039986"],
    ["zalo", "@giang.mes", "https://zalo.me/giang.mes"],
    ["zalo", "giang bui", null],
    ["slack", "@giang", null],
    ["other", "pager 42", null],
  ])("%s %j -> %j", (channelType, value, expected) => {
    expect(href(channelType, value)).toBe(expected);
  });

  it("marks only https links as external", () => {
    expect(isExternalChannelHref("https://zalo.me/0913039986")).toBe(true);
    expect(isExternalChannelHref("mailto:a@b.co")).toBe(false);
    expect(isExternalChannelHref("tel:+84913039986")).toBe(false);
  });
});
