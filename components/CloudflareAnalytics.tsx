import React from "react";
import { CF_BEACON_SRC, beaconTokenForPage } from "@/lib/cloudflare-analytics";

/** Cookieless Cloudflare Web Analytics beacon for kneadedloaves.com. Renders nothing if the token is malformed. */
export function CloudflareAnalytics() {
  const token = beaconTokenForPage();
  if (!token) return null;
  return <script defer src={CF_BEACON_SRC} data-cf-beacon={JSON.stringify({ token })} />;
}
