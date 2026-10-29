import type { NextConfig } from "next";

// Public, owner-approved canonical origin for production deployments.
// Embed it in Edge/server bundles; never derive a trusted origin from request headers.
// Vercel signals production with VERCEL_ENV=production; Netlify with
// NETLIFY=true plus CONTEXT=production.
const isProductionDeploy = process.env.VERCEL_ENV === "production"
  || (process.env.NETLIFY === "true" && process.env.CONTEXT === "production");

const nextConfig: NextConfig = {
  ...(isProductionDeploy ? { env: { APP_URL: "https://kneadedloaves.com" } } : {}),
  distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      ...(process.env.NODE_ENV === "production" ? [{ key: "Strict-Transport-Security", value: "max-age=31536000" }] : [])
    ] }];
  },
  // Answer /shop at the edge instead of invoking a server function just to
  // redirect (app/shop/page.tsx stays as a fallback). Temporary so the path
  // can become a real page later without browsers caching the redirect.
  // /menu and /order have no page of their own; the menu with its Add to Cart
  // buttons is the home page's #shop section. Permanent (308): these are
  // aliases for that section, not future pages. Next's default trailing-slash
  // handling sends /menu/ and /order/ to the bare path first.
  async redirects() {
    return [
      { source: "/shop", destination: "/#shop", permanent: false },
      { source: "/menu", destination: "/#shop", permanent: true },
      { source: "/order", destination: "/#shop", permanent: true }
    ];
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "images.unsplash.com" }
    ]
  }
};

export default nextConfig;
