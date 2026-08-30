export type ResearchPageState = "content" | "authwall" | "login" | "captcha";

function hostMatches(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

export function classifyResearchPageUrl(value: string): ResearchPageState {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "content";
  }

  const host = url.hostname.toLowerCase();
  const path = url.pathname.toLowerCase();
  const full = `${host}${path}${url.search}`.toLowerCase();

  if (hostMatches(host, "accounts.google.com")) return "login";
  if (full.includes("recaptcha")) return "captcha";
  if (hostMatches(host, "google.com") && path.startsWith("/sorry/")) return "captcha";

  if (hostMatches(host, "linkedin.com")) {
    if (path.startsWith("/authwall")) return "authwall";
    if (path.startsWith("/login") || path.startsWith("/uas/login")) return "login";
    if (path.startsWith("/checkpoint/")) return "authwall";
  }

  if (hostMatches(host, "x.com") || hostMatches(host, "twitter.com")) {
    if (path.startsWith("/i/flow/login") || path === "/login" || path.startsWith("/login/")) {
      return "login";
    }
  }

  if (hostMatches(host, "facebook.com")) {
    if (path === "/login" || path.startsWith("/login/")) return "login";
    if (path.startsWith("/checkpoint/")) return "authwall";
  }

  return "content";
}

export function isBlockedResearchUrl(url: string): boolean {
  return classifyResearchPageUrl(url) !== "content";
}
