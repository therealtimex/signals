export function getLaunchDetailHref(launchId: string): string {
  return `/dashboard/launches/${launchId}`;
}

export function isLaunchRowActivationKey(key: string): boolean {
  return key === "Enter" || key === " ";
}
