const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function usable(value: string | null | undefined) {
  const address = (value ?? "").trim();
  // The seed placeholder (admin@bakery.local) and other .local addresses can never be delivered.
  if (!EMAIL.test(address) || /\.local$/i.test(address)) return null;
  return address;
}

/**
 * Who gets admin order alerts. The admin setting wins when it is enabled with a usable address;
 * otherwise ADMIN_NOTIFY_EMAIL (server env) is the fallback so new orders are never silently unannounced.
 * Plain columns and a plain env var: nothing here depends on CONFIG_ENCRYPTION_KEY.
 */
export function adminNotificationRecipient(
  settings: { emailNotificationsEnabled?: boolean | null; notificationEmail?: string | null } | null | undefined,
  env: Record<string, string | undefined> = process.env
) {
  if (settings?.emailNotificationsEnabled) {
    const configured = usable(settings.notificationEmail);
    if (configured) return configured;
  }
  return usable(env.ADMIN_NOTIFY_EMAIL);
}
