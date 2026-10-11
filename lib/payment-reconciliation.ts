import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";
import { lockOrder, releaseReservation } from "@/lib/payment-state";
import { paypalRequest, PayPalOrder } from "@/lib/paypal";
import { assertPayPalOrderMatches, confirmPayPalOrder } from "@/lib/paypal-events";
import { applyStripeEvent } from "@/lib/stripe-events";
import { createProviderCheckout } from "@/lib/payment-checkout";
import type Stripe from "stripe";

export async function expireAbandonedPayPalOrders(limit = 1) {
  const orders = await prisma.order.findMany({ where: { paymentProvider: "PAYPAL", paymentState: "PENDING", status: "PENDING", reservationExpiresAt: { lt: new Date() } }, select: { id: true }, orderBy: { updatedAt: "asc" }, take: limit });
  let reviewed = 0;
  for (const order of orders) {
    try { await prisma.$transaction(async tx => {
      const current = await lockOrder(tx, order.id);
      if (current.paymentState !== "PENDING" || !current.reservationExpiresAt || current.reservationExpiresAt >= new Date()) return;
      if (current.paypalOrderId) {
        const remote = await paypalRequest<PayPalOrder>(`/v2/checkout/orders/${current.paypalOrderId}`);
        assertPayPalOrderMatches(current, remote);
        if (remote.status === "COMPLETED") {
          const updated = await confirmPayPalOrder(tx, current.id, remote);
          if (updated.paymentState === "PENDING") await tx.order.update({ where: { id: current.id }, data: { paymentState: "REVIEW", paymentReviewReason: "CAPTURE_PENDING" } });
          return;
        }
        // Unknown or pending provider states keep their reservation for review.
        if (!["CREATED", "SAVED", "APPROVED", "PAYER_ACTION_REQUIRED", "VOIDED"].includes(remote.status)) return;
      }
      await releaseReservation(tx, order.id, "EXPIRED");
    }, { timeout: 30000 });
    reviewed++;
    } catch {
      await prisma.order.updateMany({ where: { id: order.id, paymentState: "PENDING" }, data: { paymentReviewReason: "PROVIDER_CHECK_FAILED" } });
    } finally {
      await prisma.order.updateMany({ where: { id: order.id, paymentState: "PENDING" }, data: { updatedAt: new Date() } });
    }
  }
  return reviewed;
}
export async function reconcilePayments() {
  const deadline = Date.now() + 25000;
  const paypal = await expireAbandonedPayPalOrders(1);
  const unknown = await prisma.order.findMany({ where: { paymentProvider: "STRIPE", OR: [{ paymentState: "PENDING" }, { paymentState: "REVIEW", paymentReviewReason: "CREATION_UNKNOWN" }], stripeCheckoutSessionId: null }, orderBy: { updatedAt: "asc" }, take: 5 });
  const recoveryStripe = unknown.length ? await getStripe().catch(() => null) : null;
  for (const order of unknown) {
    if (Date.now() >= deadline) break;
    try {
      if (!recoveryStripe) throw new Error("Stripe unavailable.");
      let cursor: string | undefined;
      let recovered: Stripe.Checkout.Session | undefined;
      // Bounded scan of the original creation interval. A missing match never
      // proves absence and never releases stock; rotate the batch by updatedAt.
      for (let page = 0; page < 5; page++) {
        if (Date.now() >= deadline) throw new Error("Continue recovery in the next batch.");
        const sessions = await recoveryStripe.checkout.sessions.list({ limit: 100, created: { gte: Math.floor(order.createdAt.getTime() / 1000) - 60, lte: Math.floor((order.reservationExpiresAt || order.createdAt).getTime() / 1000) }, ...(cursor ? { starting_after: cursor } : {}) });
        for (const session of sessions.data) if (session.metadata?.orderId === order.id && session.client_reference_id === order.id) {
          if (recovered || session.amount_total !== order.totalCents || session.currency !== "usd" || session.mode !== "payment") throw new Error("Ambiguous recovered session.");
          recovered = session;
        }
        if (!sessions.has_more) break;
        cursor = sessions.data.at(-1)?.id;
        if (!cursor || page === 4) throw new Error("Recovery scan incomplete.");
      }
      if (recovered) {
        await prisma.$transaction(async tx => {
          const current = await lockOrder(tx, order.id);
          if (current.providerPaymentId || (current.paymentState !== "PENDING" && current.paymentReviewReason !== "CREATION_UNKNOWN")) return;
          await tx.order.update({ where: { id: order.id }, data: { stripeCheckoutSessionId: recovered!.id, paymentUrl: recovered!.url, paymentState: "PENDING", paymentReviewReason: null } });
        });
      } else {
        await createProviderCheckout(order.id);
      }
    } catch {
      await prisma.order.updateMany({ where: { id: order.id, OR: [{ paymentState: "PENDING" }, { paymentState: "REVIEW", paymentReviewReason: "CREATION_UNKNOWN" }], stripeCheckoutSessionId: null }, data: { paymentState: "REVIEW", paymentReviewReason: "CREATION_UNKNOWN" } });
    }
  }
  const orders = await prisma.order.findMany({ where: { paymentProvider: "STRIPE", paymentState: "PENDING", status: "PENDING", stripeCheckoutSessionId: { not: null } }, orderBy: { updatedAt: "asc" }, take: 20 });
  const stripe = orders.length ? await getStripe().catch(() => null) : null;
  let checked = 0;
  for (const order of orders) {
    if (Date.now() >= deadline) break;
    if (!stripe || !order.stripeCheckoutSessionId) continue;
    try {
    const checkout = await stripe.checkout.sessions.retrieve(order.stripeCheckoutSessionId);
    if (checkout.status !== "complete" && checkout.status !== "expired") continue;
    // This is authenticated server reconciliation, with the same canonical API
    // verification and idempotent transition used by signature-verified events.
    await applyStripeEvent(stripe, {
      object: "event", api_version: "2024-06-20", created: Math.floor(Date.now() / 1000), pending_webhooks: 0, request: null,
      id: `reconcile:${checkout.id}:${checkout.status}:${checkout.payment_status}`, type: checkout.status === "expired" ? "checkout.session.expired" : "checkout.session.completed",
      livemode: checkout.livemode, data: { object: checkout }
    } as Stripe.Event);
    checked++;
    } catch {
      await prisma.order.updateMany({ where: { id: order.id, paymentState: "PENDING" }, data: { paymentReviewReason: "PROVIDER_CHECK_FAILED" } });
    } finally {
      await prisma.order.updateMany({ where: { id: order.id, paymentState: "PENDING" }, data: { updatedAt: new Date() } });
    }
  }
  const unresolved = await prisma.order.count({ where: { paymentProvider: { not: null }, paymentState: { in: ["PENDING", "REVIEW"] }, reservationExpiresAt: { lt: new Date() } } });
  return { paypal, stripe: checked, unresolved };
}
