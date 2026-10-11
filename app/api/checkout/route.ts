import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { cartOwner } from "@/lib/order-rules";
import { readJson, rateLimit } from "@/lib/request";
import { prisma } from "@/lib/prisma";
import { orderSchema } from "@/lib/validation";
import { getCheckoutReadiness } from "@/lib/checkout-readiness";
import { createProviderCheckout } from "@/lib/payment-checkout";
import { reserveCheckout } from "@/lib/checkout-order";
import { expireAbandonedPayPalOrders } from "@/lib/payment-reconciliation";

export const runtime = "nodejs";
export async function POST(request: Request) {
  if (!await rateLimit(request, "checkout", 20)) return NextResponse.json({ error: "Please wait before trying checkout again." }, { status: 429 });
  const parsed = orderSchema.safeParse(await readJson(request));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid order." }, { status: 400 });
  const readiness = await getCheckoutReadiness();
  if (!readiness.providers.includes(parsed.data.paymentProvider)) return NextResponse.json({ error: "Online checkout is not available yet. Please contact the bakery." }, { status: 503 });
  const session = await getSession();
  const owner = cartOwner(session?.sub, (await cookies()).get("bakery_cart")?.value);
  if (!owner) return NextResponse.json({ error: "Your cart is empty." }, { status: 400 });
  const cart = await prisma.cart.findUnique({ where: owner });
  if (!cart) return NextResponse.json({ error: "Your cart is empty." }, { status: 400 });
  const input = parsed.data;
  await expireAbandonedPayPalOrders().catch(() => { console.error("An abandoned payment reservation could not be reconciled."); });
  let orderId: string;
  try {
    orderId = await reserveCheckout(input, cart.id, session?.sub);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not reserve this order." }, { status: 409 });
  }
  try {
    return NextResponse.json(await createProviderCheckout(orderId));
  } catch {
    // An upstream timeout can mean a session was created. Keep the reservation and
    // retry the SAME provider idempotency key, never create a second charge/order.
    return NextResponse.json({ error: "The payment provider could not start checkout. Your cart is saved. Retry with the same details; if this continues, contact the bakery.", retryable: true }, { status: 502 });
  }
}
