/** X compose/publish DOM selectors (centralized for fragility management). */
export const X_SELECTORS = {
  primaryColumn: '[data-testid="primaryColumn"]',
  loginButton: '[data-testid="loginButton"]',
  composeButton: '[data-testid="SideNav_NewTweet_Button"]',
  accountSwitcher: '[data-testid="SideNav_AccountSwitcher_Button"]',
  tweetTextarea: (index: number) => `[data-testid="tweetTextarea_${index}"]`,
  tweetButton: '[data-testid="tweetButton"]',
  addButton: '[data-testid="addButton"]',
  fileInput: 'input[data-testid="fileInput"]',
  attachments: '[data-testid="attachments"]',
  profileLink: '[data-testid="AppTabBar_Profile_Link"]',
  desktopProfileLink: 'a[aria-label="Profile"]',
  statusLink: 'article a[href*="/status/"]',
} as const;

/** Any visible marker is enough to treat the session as logged in (desktop or mobile). */
export const X_LOGGED_IN_MARKERS = [
  X_SELECTORS.primaryColumn,
  X_SELECTORS.composeButton,
  X_SELECTORS.accountSwitcher,
  X_SELECTORS.profileLink,
  X_SELECTORS.desktopProfileLink,
] as const;

/** Profile nav links that expose the logged-in handle in `href`. */
export const X_PROFILE_HANDLE_SELECTORS = [
  X_SELECTORS.profileLink,
  X_SELECTORS.desktopProfileLink,
  `${X_SELECTORS.accountSwitcher} a[href^="/"]`,
] as const;
