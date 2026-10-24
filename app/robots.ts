import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/account", "/orders", "/api/", "/login", "/register", "/forgot-password", "/reset-password"]
    }],
    sitemap: `${SITE_URL}/sitemap.xml`
  };
}
