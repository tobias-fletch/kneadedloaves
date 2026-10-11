import { dispatchQueuedEmail } from "@/lib/email-dispatch";
import { NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { getAppConfigValue } from "@/lib/app-config";
import { applyStripeEvent } from "@/lib/stripe-events";
import { readBody } from "@/lib/request";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const stripe = await getStripe();
  const secret = await getAppConfigValue("STRIPE_WEBHOOK_SECRET");
  if (!stripe || !secret) return NextResponse.json({ error: "Webhook is not configured." }, { status: 503 });
  let event;
  try {
    event = stripe.webhooks.constructEvent(await readBody(request, 1024 * 1024), request.headers.get("stripe-signature") || "", secret);
    const test = (await getAppConfigValue("STRIPE_TEST_MODE")) === "true";
    if (event.livemode === test) throw new Error("Webhook mode mismatch.");
  } catch { return NextResponse.json({ error: "Invalid webhook signature." }, { status: 400 }); }
  try { await applyStripeEvent(stripe, event); }
  catch { return NextResponse.json({ error: "Payment event could not be processed. Retry required." }, { status: 500 }); }
  dispatchQueuedEmail();
  return NextResponse.json({ received: true });
}
