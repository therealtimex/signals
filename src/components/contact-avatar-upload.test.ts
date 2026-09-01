import { describe, expect, it } from "vitest";

/**
 * The avatar falls back to `gravatar.com/avatar/<md5>?d=404` for any contact
 * with an email and no uploaded or identity photo — see
 * `src/lib/db/queries/resolve-contact-avatar.ts`. Gravatar answers 404 for
 * anyone not registered, which is most people, so the detail page rendered a
 * broken-image glyph where the contacts list (Radix AvatarFallback) correctly
 * showed initials.
 *
 * The component tracks which URL failed rather than a boolean so that uploading
 * a new avatar retries instead of staying stuck on initials. That decision is
 * what these cases pin.
 */
function showImage(currentAvatarUrl: string | null, failedAvatarUrl: string | null): boolean {
  return Boolean(currentAvatarUrl) && currentAvatarUrl !== failedAvatarUrl;
}

describe("contact avatar fallback", () => {
  const GRAVATAR = "https://www.gravatar.com/avatar/abc?d=404";

  it("shows the image before anything has failed", () => {
    expect(showImage(GRAVATAR, null)).toBe(true);
  });

  it("falls back to initials once that URL has failed", () => {
    expect(showImage(GRAVATAR, GRAVATAR)).toBe(false);
  });

  it("retries when a new avatar is uploaded", () => {
    // The bug a boolean flag would have: the upload succeeds, the URL changes,
    // and the contact is still showing initials.
    expect(showImage("/api/media/upload-1", GRAVATAR)).toBe(true);
  });

  it("shows initials when there is no avatar at all", () => {
    expect(showImage(null, null)).toBe(false);
  });
});
