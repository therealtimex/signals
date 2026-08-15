/** Sentinel strings seeded in private CRM fields — must never appear in simulation outputs. */
export const PRIVACY_SENTINELS = {
  email: "SENTINEL_PRIVATE_EMAIL@example.com",
  phone: "SENTINEL_PRIVATE_PHONE",
  tags: "SENTINEL_PRIVATE_TAGS",
  platformData: "SENTINEL_PLATFORM_DATA",
  syncErrors: "SENTINEL_SYNC_ERRORS",
  personaArchetype: "SENTINEL_LOCAL_PERSONA",
  propertiesPrivate: "SENTINEL_PROPERTIES_PRIVATE",
} as const;

export function assertNoPrivacySentinels(payload: unknown): void {
  const text = JSON.stringify(payload);
  for (const sentinel of Object.values(PRIVACY_SENTINELS)) {
    if (text.includes(sentinel)) {
      throw new Error(`Privacy sentinel leaked into simulation payload: ${sentinel}`);
    }
  }
}
