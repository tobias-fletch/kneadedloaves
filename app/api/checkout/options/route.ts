import { NextResponse } from "next/server";
import { getEligibleOrderWindows } from "@/lib/order-window";
import { getCheckoutReadiness } from "@/lib/checkout-readiness";
import { formatBakeryDate } from "@/lib/bakery-time";
export const dynamic = "force-dynamic";
export async function GET() {
  if (!process.env.DATABASE_URL?.trim()) return NextResponse.json({ providers: [], windows: [], available: false }, { headers: { "Cache-Control": "no-store" } });
  const [windows, readiness] = await Promise.all([getEligibleOrderWindows(), getCheckoutReadiness()]);
  return NextResponse.json({ providers: readiness.providers, windows: windows.map(window => ({ id: window.id, name: window.name, label: `${window.name} · ${formatBakeryDate(window.fulfillmentDate, { weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" })}`, cutoff: formatBakeryDate(window.closesAt, { weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }) })) }, { headers: { "Cache-Control": "no-store" } });
}
