export const VALID_SETTINGS_TABS = ["platforms", "agents"] as const;
export type SettingsTab = (typeof VALID_SETTINGS_TABS)[number];

export function parseSettingsTab(value: string | null | undefined): SettingsTab {
  if (value && (VALID_SETTINGS_TABS as readonly string[]).includes(value)) {
    return value as SettingsTab;
  }
  return "platforms";
}

export function settingsTabHref(tab: SettingsTab): string {
  return `/dashboard/settings?tab=${tab}`;
}
