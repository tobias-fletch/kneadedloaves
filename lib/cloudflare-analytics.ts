/**
 * Cloudflare Web Analytics (cookieless JS beacon).
 * The site token is public, not a secret. The beacon uses NEXT_PUBLIC_CF_ANALYTICS_TOKEN
 * when it is set, otherwise the committed kneadedloaves.com token below.
 */
export const CF_BEACON_SRC = "https://static.cloudflareinsights.com/beacon.min.js";

/** Cloudflare Web Analytics site token for kneadedloaves.com (public). */
export const CF_ANALYTICS_SITE_TOKEN = "447634b9537041c28cc36f327332db2f";

/** The token the beacon uses: NEXT_PUBLIC_CF_ANALYTICS_TOKEN if set, otherwise the committed token. */
export function beaconTokenForPage(envValue: string | null | undefined = process.env.NEXT_PUBLIC_CF_ANALYTICS_TOKEN) {
  return cloudflareAnalyticsToken(envValue?.trim() || CF_ANALYTICS_SITE_TOKEN);
}

export function cloudflareAnalyticsToken(value: string | null | undefined = process.env.NEXT_PUBLIC_CF_ANALYTICS_TOKEN) {
  const token = value?.trim() ?? "";
  return /^[A-Za-z0-9]{16,64}$/.test(token) ? token : null;
}

/**
 * Google Search Console URL-prefix verification for https://kneadedloaves.com/ (HTML tag method).
 * Public value, not a secret. Keep it in place after verifying: Google re-checks it.
 */
export const SEARCH_CONSOLE_VERIFICATION = "xnKInryqMG81gSlWH-MzzMaTYBqfPKOE4cm5utQ7b8s";

/** The value rendered in <head>: NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION if set, otherwise the committed value. */
export function siteVerificationForHead(envValue: string | null | undefined = process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION) {
  return googleSiteVerification(envValue?.trim() || SEARCH_CONSOLE_VERIFICATION);
}

/**
 * Validates a Search Console verification value; returns null for empty or malformed values.
 */
export function googleSiteVerification(value: string | null | undefined = process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION) {
  const token = value?.trim() ?? "";
  return /^[A-Za-z0-9_-]{10,100}$/.test(token) ? token : null;
}
