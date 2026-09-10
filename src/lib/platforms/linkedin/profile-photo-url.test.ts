import { describe, expect, it } from "vitest";
import {
  isLinkedInNavbarThumbnailUrl,
  isLinkedInProfilePhotoUrl,
  linkedInProfilePhotoAssetId,
  linkedInProfilePhotosCollide,
  preferLinkedInProfilePhotoUrl,
} from "@/lib/platforms/linkedin/profile-photo-url";

const VIEWER_100 =
  "https://media.licdn.com/dms/image/v2/C5103AQHThgCA9BePxw/profile-displayphoto-shrink_100_100/profile-displayphoto-shrink_100_100/0/1517533488652?e=1790812800&v=beta&t=YPbwo7jzLM3XpUBdrH1RlGwqgmogWE3t6QplKhXaVRE";
const VIEWER_400 =
  "https://media.licdn.com/dms/image/v2/C5103AQHThgCA9BePxw/profile-displayphoto-shrink_400_400/profile-displayphoto-shrink_400_400/0/1517533488652?e=1790812800&v=beta&t=other";
const CONTACT_400 =
  "https://media.licdn.com/dms/image/v2/D4E03AQOtherAsset99/profile-displayphoto-shrink_400_400/0/1";
const FRAMED =
  "https://media.licdn.com/dms/image/v2/D4E03AQOtherAsset99/profile-framedphoto-shrink_800_800/0/1";

describe("LinkedIn profile photo URLs", () => {
  it("recognizes CDN profile photos and navbar thumbs", () => {
    expect(isLinkedInProfilePhotoUrl(VIEWER_100)).toBe(true);
    expect(isLinkedInNavbarThumbnailUrl(VIEWER_100)).toBe(true);
    expect(isLinkedInNavbarThumbnailUrl(CONTACT_400)).toBe(false);
    expect(isLinkedInNavbarThumbnailUrl("https://unavatar.io/linkedin/user:jane")).toBe(false);
  });

  it("treats shrink variants of the same asset as a collision", () => {
    expect(linkedInProfilePhotoAssetId(VIEWER_100)).toBe("C5103AQHThgCA9BePxw");
    expect(linkedInProfilePhotosCollide(VIEWER_100, VIEWER_400)).toBe(true);
    expect(linkedInProfilePhotosCollide(VIEWER_100, CONTACT_400)).toBe(false);
  });

  it("prefers framed and larger shrink sizes over navbar thumbs", () => {
    expect(preferLinkedInProfilePhotoUrl([VIEWER_100, CONTACT_400, FRAMED])).toBe(FRAMED);
    expect(preferLinkedInProfilePhotoUrl([VIEWER_100, CONTACT_400])).toBe(CONTACT_400);
  });
});
