/** Fixed RTX Browser session name for X publish (persistent login profile). */
export const RTX_PUBLISH_SESSION_NAME = "signals-publish";

export const X_HOME_URL = "https://x.com/home";

/** Shorter verification polling in unit tests (`SIGNALS_RTX_PUBLISH_TEST=1`). */
export function getVerifyPollIntervalMs(): number {
  return process.env.SIGNALS_RTX_PUBLISH_TEST === "1" ? 0 : 2000;
}

export function getAutoVerifyTimeoutMs(): number {
  return process.env.SIGNALS_RTX_PUBLISH_TEST === "1" ? 0 : 20_000;
}

export function getReviewVerifyTimeoutMs(): number {
  return process.env.SIGNALS_RTX_PUBLISH_TEST === "1" ? 0 : 15_000;
}

/** Shorter profile timeline polling in unit tests (`SIGNALS_RTX_PUBLISH_TEST=1`). */
export function getProfileTimelinePollMs(): number {
  return process.env.SIGNALS_RTX_PUBLISH_TEST === "1" ? 0 : 1000;
}

export function getProfileTimelineTimeoutMs(): number {
  return process.env.SIGNALS_RTX_PUBLISH_TEST === "1" ? 50 : 30_000;
}
