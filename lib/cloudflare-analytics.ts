/**
 * Cloudflare Web Analytics (cookieless JS beacon).
 * The site token is public, not a secret. The beacon renders only when
 * NEXT_PUBLIC_CF_ANALYTICS_TOKEN is set to a valid token; otherwise nothing loads.
 */
export const CF_BEACON_SRC = "https://static.cloudflareinsights.com/beacon.min.js";

export function cloudflareAnalyticsToken(value: string | null | undefined = process.env.NEXT_PUBLIC_CF_ANALYTICS_TOKEN) {
  const token = value?.trim() ?? "";
  return /^[A-Za-z0-9]{16,64}$/.test(token) ? token : null;
}

/**
 * Google Search Console URL-prefix verification (HTML tag method). Public value.
 * The meta tag renders only when NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION is set.
 */
export function googleSiteVerification(value: string | null | undefined = process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION) {
  const token = value?.trim() ?? "";
  return /^[A-Za-z0-9_-]{10,100}$/.test(token) ? token : null;
}
