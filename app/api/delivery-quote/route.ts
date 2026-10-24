import { NextResponse } from "next/server";
import { defaultDeliveryDeps, handleDeliveryQuote } from "@/lib/delivery-distance";
import { readJson, rateLimit } from "@/lib/request";

export const dynamic = "force-dynamic";

// Returns only { feeCents, inRange, message }. Never the distance or the bakery origin.
export async function POST(request: Request) {
  if (!await rateLimit(request, "delivery-quote", 120)) return NextResponse.json({ error: "Please wait a moment before checking another address." }, { status: 429, headers: { "Cache-Control": "no-store" } });
  const result = await handleDeliveryQuote(await readJson(request), defaultDeliveryDeps());
  return NextResponse.json(result.body, { status: result.status, headers: { "Cache-Control": "no-store" } });
}
