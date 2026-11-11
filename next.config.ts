import type { NextConfig } from "next";

// Public, owner-approved canonical origin for production deployments.
// Embed it in Edge/server bundles; never derive a trusted origin from request headers.
// Vercel signals production with VERCEL_ENV=production; Netlify with
// NETLIFY=true plus CONTEXT=production.
const isProductionDeploy = process.env.VERCEL_ENV === "production"
  || (process.env.NETLIFY === "true" && process.env.CONTEXT === "production");

// Enforced Content-Security-Policy (security item M4, Oct 29 2026).
// Everything is self-hosted (next/font, /_next, /brand, /menu-art, next/image proxies
// Unsplash through /_next/image) except Cloudflare Web Analytics. 'unsafe-inline' scripts
// are needed for Next.js inline bootstrap/JSON-LD; 'unsafe-eval' only in `next dev`.
// Vercel preview deployments also allow the Vercel preview toolbar (vercel.live).
const isDev = process.env.NODE_ENV === "development";
const isVercelPreview = process.env.VERCEL_ENV === "preview";
const vercelLive = isVercelPreview ? ["https://vercel.live"] : [];
const csp = [
  "default-src 'self'",
  ["script-src 'self' 'unsafe-inline'", ...(isDev ? ["'unsafe-eval'"] : []), "https://static.cloudflareinsights.com", ...vercelLive].join(" "),
  ["style-src 'self' 'unsafe-inline'", ...vercelLive].join(" "),
  ["img-src 'self' data: blob:", ...(isVercelPreview ? ["https://vercel.live", "https://vercel.com"] : [])].join(" "),
  ["font-src 'self'", ...(isVercelPreview ? ["https://vercel.live", "https://assets.vercel.com"] : [])].join(" "),
  "media-src 'self'",
  ["connect-src 'self' https://cloudflareinsights.com", ...(isDev ? ["ws:"] : []), ...(isVercelPreview ? ["https://vercel.live", "wss://ws-us3.pusher.com"] : [])].join(" "),
  isVercelPreview ? "frame-src https://vercel.live" : "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "manifest-src 'self'",
  "worker-src 'self'",
  ...(isDev ? [] : ["upgrade-insecure-requests"])
].join("; ");

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
      { key: "Content-Security-Policy", value: csp },
      ...(process.env.NODE_ENV === "production" ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }] : [])
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
