import { BAKERY_CONTACT_EMAIL, BAKERY_INSTAGRAM_HANDLE } from "@/lib/config-messages";

/** Public canonical origin (matches metadataBase in app/layout.tsx). */
export const SITE_URL = "https://kneadedloaves.com";

/** Public pages that belong in the sitemap. Never list /admin, /account, /orders, auth or API routes. */
export const PUBLIC_SITEMAP_PATHS = ["/", "/contact"] as const;

/** Bakery structured data built only from facts already shown on the site. */
export function bakeryJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "Bakery",
    name: "Kneaded Loaves",
    url: `${SITE_URL}/`,
    logo: `${SITE_URL}/icon-512.png`,
    image: `${SITE_URL}/opengraph-image.png`,
    email: BAKERY_CONTACT_EMAIL,
    sameAs: [`https://www.instagram.com/${BAKERY_INSTAGRAM_HANDLE}/`],
    address: {
      "@type": "PostalAddress",
      addressLocality: "Brooklyn",
      addressRegion: "NY",
      postalCode: "11217",
      addressCountry: "US"
    },
    areaServed: { "@type": "City", name: "Brooklyn, NY" }
  };
}
