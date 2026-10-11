import { assertPaymentMatches } from "@/lib/payment-rules";
import Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { confirmPayment, lockOrder, processPaymentEvent, recordRefund, releaseReservation } from "@/lib/payment-state";

export async function applyStripeEvent(stripe: Stripe, event: Stripe.Event) {
  if (["checkout.session.completed", "checkout.session.async_payment_succeeded", "checkout.session.expired", "checkout.session.async_payment_failed"].includes(event.type)) {
    const received = event.data.object as Stripe.Checkout.Session;
    const checkout = await stripe.checkout.sessions.retrieve(received.id);
    const id = checkout.metadata?.orderId;
    if (!id) return;
    const order = await prisma.order.findUnique({ where: { id } });
    if (!order) return;
    if (checkout.livemode !== event.livemode || checkout.client_reference_id !== id || checkout.mode !== "payment") throw new Error("Invalid checkout identity.");
    await processPaymentEvent("STRIPE", event.id, event.type, id, async tx => {
      const current = await lockOrder(tx, id);
      if (current.paymentProvider !== "STRIPE" || (current.stripeCheckoutSessionId && current.stripeCheckoutSessionId !== checkout.id)) throw new Error("Unexpected payment session.");
      if (checkout.payment_status === "paid" && checkout.status === "complete") {
        const paymentId = typeof checkout.payment_intent === "string" ? checkout.payment_intent : checkout.payment_intent?.id;
        if (!paymentId || checkout.amount_total === null || !checkout.currency) throw new Error("Payment details are incomplete.");
        assertPaymentMatches(current, { orderId: id, amountCents: checkout.amount_total, currency: checkout.currency });
        if (current.providerPaymentId && current.providerPaymentId !== paymentId) throw new Error("Payment identity mismatch.");
        const intent = await stripe.paymentIntents.retrieve(paymentId, { expand: ["latest_charge"] });
        const charge = intent.latest_charge && typeof intent.latest_charge !== "string" ? intent.latest_charge : null;
        if (charge?.amount_refunded && current.providerPaymentId === paymentId && ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"].includes(current.paymentState) && !charge.disputed) {
          await recordRefund(tx, id, charge.amount_refunded);
          return;
        }
        if (charge?.disputed || charge?.amount_refunded) {
          await tx.order.update({ where: { id }, data: { paymentState: "REVIEW", providerPaymentId: paymentId, stripeCheckoutSessionId: checkout.id, refundedCents: Math.max(current.refundedCents, charge.amount_refunded) } });
          return;
        }
        await confirmPayment(tx, { orderId: id, provider: "STRIPE", providerOrderId: checkout.id, paymentId, amountCents: checkout.amount_total, currency: checkout.currency });
      } else if (checkout.status === "expired") {
        await releaseReservation(tx, id, "EXPIRED");
      } else if (event.type === "checkout.session.async_payment_failed" && checkout.payment_status === "unpaid") {
        await releaseReservation(tx, id, "FAILED");
      }
    });
    return;
  }
  if (event.type === "charge.refunded" || event.type === "charge.dispute.created") {
    const received = event.data.object as Stripe.Charge | Stripe.Dispute;
    const chargeId = event.type === "charge.refunded" ? received.id : typeof (received as Stripe.Dispute).charge === "string" ? (received as Stripe.Dispute).charge as string : ((received as Stripe.Dispute).charge as Stripe.Charge).id;
    const charge = await stripe.charges.retrieve(chargeId);
    const paymentId = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
    if (!paymentId) return;
    const intent = await stripe.paymentIntents.retrieve(paymentId);
    const id = intent.metadata.orderId;
    if (!id) return;
    const order = await prisma.order.findUnique({ where: { id } });
    if (!order) return;
    if (order.paymentProvider !== "STRIPE" || charge.amount !== order.totalCents || charge.currency !== "usd" || (order.providerPaymentId && order.providerPaymentId !== paymentId)) throw new Error("Refund does not match order.");
    await processPaymentEvent("STRIPE", event.id, event.type, id, async tx => {
      const current = await lockOrder(tx, id);
      if (!current.providerPaymentId || charge.disputed) {
        await tx.order.update({ where: { id }, data: { paymentState: "REVIEW", providerPaymentId: paymentId, refundedCents: Math.max(current.refundedCents, charge.amount_refunded) } });
      } else await recordRefund(tx, id, charge.amount_refunded);
    });
  }
}
