import type { Metadata } from "next";
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
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = {
  title: "Kneaded Loaves",
  description: "Small-batch bakery ordering and admin dashboard.",
  appleWebApp: { capable: true, title: "Kneaded Loaves" }
};

export const dynamic = "force-dynamic";

const anton = Anton({ weight: "400", subsets: ["latin"], variable: "--font-anton" });
const oswald = Oswald({ weight: ["400", "500", "600", "700"], subsets: ["latin"], variable: "--font-oswald" });
const inter = Inter({ weight: ["400", "500", "600", "700", "800"], subsets: ["latin"], variable: "--font-inter" });

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  const [settings, deliveryZones, pickupLocations, appearance, contact] = await Promise.all([
    prisma.adminSettings.findFirst().catch(() => null),
    prisma.deliveryZone.findMany({ where: { active: true } }).catch(() => []),
    prisma.pickupLocation.findMany({ where: { active: true } }).catch(() => []),
    getAppearance(),
    getContactDetails()
  ]);
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
          <nav className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
            <Link href="/" className="flex items-center gap-3">
              <span className="hidden h-9 w-2.5 bg-jam sm:block" aria-hidden="true" />
              <span className="font-display text-2xl uppercase leading-none tracking-wide text-ink">
                {publicSettings.bakeryName}
              </span>
            </Link>
            <div className="flex items-center gap-2">
              <CartDrawerButton deliveryZones={deliveryZones} pickupLocations={pickupLocations} />
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
