import React from "react";
import { CF_BEACON_SRC, cloudflareAnalyticsToken } from "@/lib/cloudflare-analytics";

/** Cookieless Cloudflare Web Analytics beacon. Renders nothing without a configured site token. */
export function CloudflareAnalytics() {
  const token = cloudflareAnalyticsToken();
  if (!token) return null;
  return <script defer src={CF_BEACON_SRC} data-cf-beacon={JSON.stringify({ token })} />;
}
