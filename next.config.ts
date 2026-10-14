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
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "images.unsplash.com" }
    ]
  }
};

export default nextConfig;
