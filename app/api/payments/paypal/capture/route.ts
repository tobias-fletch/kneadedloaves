import { dispatchQueuedEmail } from "@/lib/email-dispatch";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { readJson, rateLimit } from "@/lib/request";
import { hasReceiptAccess } from "@/lib/payment-rules";
import { lockOrder } from "@/lib/payment-state";
import { paypalRequest, PayPalOrder } from "@/lib/paypal";
import { confirmPayPalOrder, assertPayPalOrderMatches } from "@/lib/paypal-events";
export const runtime = "nodejs";
export async function POST(request: Request) {
  if (!await rateLimit(request, "paypal-capture", 30)) return NextResponse.json({ error: "Please wait before retrying." }, { status: 429 });
  const body = await readJson(request);
  if (typeof body.orderId !== "string") return NextResponse.json({ error: "Invalid order." }, { status: 400 });
  const order = await prisma.order.findUnique({ where: { id: body.orderId } });
  if (!order || !hasReceiptAccess(body.receiptToken, order.receiptTokenHash) || order.paymentProvider !== "PAYPAL" || !order.paypalOrderId) return NextResponse.json({ error: "Order not found." }, { status: 404 });
  try {
    const result = await prisma.$transaction(async tx => {
      const current = await lockOrder(tx, order.id);
      if (current.paymentState !== "PENDING") return current;
      let remote = await paypalRequest<PayPalOrder>(`/v2/checkout/orders/${order.paypalOrderId}`);
      assertPayPalOrderMatches(current, remote);
      if (remote.status === "APPROVED") {
        if (current.status !== "PENDING" || !current.reservationExpiresAt || current.reservationExpiresAt <= new Date()) throw new Error("Reservation expired.");
        remote = await paypalRequest<PayPalOrder>(`/v2/checkout/orders/${order.paypalOrderId}/capture`, "POST", {}, `capture-${order.id}`);
      }
      return confirmPayPalOrder(tx, order.id, remote);
    }, { timeout: 40000 });
    dispatchQueuedEmail();
    return NextResponse.json({ paymentState: result.paymentState });
  } catch { return NextResponse.json({ error: "Payment is not yet confirmed. Refresh the order status or contact the bakery before trying a new order." }, { status: 502 }); }
}
