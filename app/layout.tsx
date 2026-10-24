import type { Metadata, Viewport } from "next";
import { Anton, Inter, Oswald } from "next/font/google";
import Link from "next/link";
import { UserRound } from "lucide-react";
import { CartDrawerButton } from "@/components/CartDrawerButton";
import { ContactFooter } from "@/components/ContactFooter";
import { InlineAdminPanel } from "@/components/InlineAdminPanel";
import "./globals.css";
import { appearanceToCssVars, defaultAppearance, getAppearance } from "@/lib/appearance";
import { getSession } from "@/lib/auth";
import { getContactDetails } from "@/lib/contact";
import { getManualPaymentConfig } from "@/lib/manual-payment-config";
import { storefrontCheckoutAccess } from "@/lib/storefront-ordering";
import { prisma } from "@/lib/prisma";
import { SHARE_DESCRIPTION } from "@/lib/site-metadata";

export const metadata: Metadata = {
  metadataBase: new URL("https://kneadedloaves.com"),
  title: "Kneaded Loaves",
  description: SHARE_DESCRIPTION,
  appleWebApp: { capable: true, title: "Kneaded Loaves" },
  openGraph: {
    siteName: "Kneaded Loaves",
    title: "Kneaded Loaves",
    description: SHARE_DESCRIPTION,
    type: "website"
  },
  twitter: {
    card: "summary_large_image",
    title: "Kneaded Loaves",
    description: SHARE_DESCRIPTION
  }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#3B4527"
};

export const dynamic = "force-dynamic";

const anton = Anton({ weight: "400", subsets: ["latin"], variable: "--font-anton" });
const oswald = Oswald({ weight: ["400", "500", "600", "700"], subsets: ["latin"], variable: "--font-oswald" });
const inter = Inter({ weight: ["400", "500", "600", "700", "800"], subsets: ["latin"], variable: "--font-inter" });

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  const [settings, deliveryZones, pickupLocations, appearance, contact, payment] = await Promise.all([
    prisma.adminSettings.findFirst().catch(() => null),
    prisma.deliveryZone.findMany({ where: { active: true } }).catch(() => []),
    prisma.pickupLocation.findMany({ where: { active: true } }).catch(() => []),
    getAppearance(),
    getContactDetails(),
    getManualPaymentConfig().catch(() => null)
  ]);
  const orderingAccess = payment ? storefrontCheckoutAccess(payment, session?.role === "ADMIN") : null;
  const checkoutReady = Boolean(orderingAccess?.checkoutReady);
  const publicSettings = {
    bakeryName: settings?.bakeryName ?? "Kneaded Loaves",
    businessDescription: settings?.businessDescription ?? "Small-batch breads and pastries baked for limited weekly order windows.",
    orderingOpenMessage: settings?.orderingOpenMessage ?? "Orders are open for this week's bake.",
    orderingClosedMessage: settings?.orderingClosedMessage ?? "Ordering is closed right now. Check back for the next bake."
  };

  return (
    <html lang="en" className={`${anton.variable} ${oswald.variable} ${inter.variable}`}>
      <body style={appearanceToCssVars(appearance ?? defaultAppearance)}>
        <header className="sticky top-0 z-30 border-b-4 border-ink bg-[rgb(var(--color-page-rgb)/0.97)] backdrop-blur">
          <nav className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-3 px-4 py-3 sm:flex-nowrap sm:px-6 lg:px-8">
            <Link href="/" className="block w-full min-w-0 max-w-[370px] sm:w-auto sm:flex-1">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/brand/kl-c1-header.svg"
                alt="Kneaded Loaves"
                width={370}
                height={56}
                className="block h-auto w-full"
              />
            </Link>
            <div className="ml-auto flex shrink-0 items-center gap-2">
              <CartDrawerButton checkoutReady={checkoutReady} adminTestMode={orderingAccess?.adminTestMode ?? false} adminSetupReasons={orderingAccess?.adminSetupReasons ?? []} contactEmail={contact.email} deliveryZones={deliveryZones} pickupLocations={pickupLocations} />
              {session?.role === "ADMIN" ? (
                <Link className="btn-primary px-3" href="/admin">
                  Admin
                </Link>
              ) : (
                <Link className="btn-secondary px-3" href="/account" aria-label="Account">
                  <UserRound size={18} />
                </Link>
              )}
            </div>
          </nav>
        </header>
        {children}
        <ContactFooter contact={contact} />
        {session?.role === "ADMIN" ? <InlineAdminPanel initialSettings={publicSettings} initialAppearance={appearance} /> : null}
      </body>
    </html>
  );
}
