import { dispatchQueuedEmail } from "@/lib/email-dispatch";
import { NextResponse } from "next/server";
import { verifyPayPalWebhook } from "@/lib/paypal";
import { applyPayPalEvent, PayPalEvent } from "@/lib/paypal-events";
import { readBody } from "@/lib/request";
export const runtime = "nodejs";
export async function POST(request: Request) {
  let event: PayPalEvent;
  try {
    event = JSON.parse((await readBody(request, 1024 * 1024)).toString("utf8"));
    if (!event?.id || !event.event_type || !event.resource?.id || !await verifyPayPalWebhook(request.headers, event)) return NextResponse.json({ error: "Invalid webhook signature." }, { status: 400 });
  } catch { return NextResponse.json({ error: "Webhook verification unavailable." }, { status: 503 }); }
  try { await applyPayPalEvent(event); }
  catch { return NextResponse.json({ error: "Payment event could not be processed. Retry required." }, { status: 500 }); }
  dispatchQueuedEmail();
  return NextResponse.json({ received: true });
}
