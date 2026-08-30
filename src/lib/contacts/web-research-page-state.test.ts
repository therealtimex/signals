import { describe, expect, it } from "vitest";
import {
  classifyResearchPageUrl,
  isBlockedResearchUrl,
} from "@/lib/contacts/web-research-page-state";

describe("research page URL classification", () => {
  it.each([
    ["https://www.linkedin.com/authwall?trk=foo", "authwall"],
    ["https://linkedin.com/uas/login", "login"],
    ["https://www.linkedin.com/checkpoint/challenge", "authwall"],
    ["https://www.google.com/sorry/index", "captcha"],
    ["https://accounts.google.com/signin", "login"],
    ["https://x.com/i/flow/login", "login"],
    ["https://mobile.twitter.com/login", "login"],
    ["https://www.facebook.com/checkpoint/123", "authwall"],
    ["https://example.com/recaptcha/challenge", "captcha"],
  ] as const)("classifies %s as %s", (url, state) => {
    expect(classifyResearchPageUrl(url)).toBe(state);
    expect(isBlockedResearchUrl(url)).toBe(true);
  });

  it.each([
    "https://www.linkedin.com/in/example",
    "https://notlinkedin.com/authwall",
    "https://google.com.example.test/sorry/index",
    "https://x.com/example",
    "not a url",
  ])("does not substring-match content URL %s", (url) => {
    expect(classifyResearchPageUrl(url)).toBe("content");
    expect(isBlockedResearchUrl(url)).toBe(false);
  });
});
