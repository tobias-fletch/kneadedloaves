import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { PayPalOrder, paypalRequest } from "@/lib/paypal";
import { confirmPayment, lockOrder, processPaymentEvent, recordRefund } from "@/lib/payment-state";
import { assertPaymentMatches, dollarsToCents } from "@/lib/payment-rules";

export function assertPayPalOrderMatches(order: { id: string; totalCents: number; paymentProvider: string | null; paypalOrderId: string | null }, remote: PayPalOrder) {
  if (order.paymentProvider !== "PAYPAL" || order.paypalOrderId !== remote.id) throw new Error("PayPal order mismatch.");
  const unit = remote.purchase_units?.[0];
  if (remote.purchase_units?.length !== 1 || !unit?.amount) throw new Error("Invalid PayPal order.");
  assertPaymentMatches(order, { orderId: unit.custom_id, amountCents: dollarsToCents(unit.amount.value), currency: unit.amount.currency_code });
}
export async function confirmPayPalOrder(tx: Prisma.TransactionClient, localId: string, remote: PayPalOrder) {
  const order = await lockOrder(tx, localId);
  assertPayPalOrderMatches(order, remote);
  const unit = remote.purchase_units![0];
  const capture = unit.payments?.captures?.[0];
  if (remote.status !== "COMPLETED" || unit.payments?.captures?.length !== 1 || !capture) return order;
  assertPaymentMatches(order, { orderId: unit.custom_id, amountCents: dollarsToCents(capture.amount.value), currency: capture.amount.currency_code });
  if (order.providerPaymentId && order.providerPaymentId !== capture.id) throw new Error("Capture identity mismatch.");
  if (["REFUNDED", "PARTIALLY_REFUNDED"].includes(capture.status)) {
    if (!order.providerPaymentId) await tx.order.update({ where: { id: order.id }, data: { providerPaymentId: capture.id, paymentState: "REVIEW", paymentReviewReason: "REFUND_BEFORE_CONFIRMATION" } });
    if (capture.status === "REFUNDED") return recordRefund(tx, order.id, order.totalCents);
    return tx.order.findUniqueOrThrow({ where: { id: order.id } });
  }
  if (capture.status !== "COMPLETED") return order;
  return confirmPayment(tx, { orderId: localId, provider: "PAYPAL", providerOrderId: remote.id, paymentId: capture.id, amountCents: dollarsToCents(capture.amount.value), currency: capture.amount.currency_code });
}
export type PayPalEvent = { id: string; event_type: string; resource: { id: string; supplementary_data?: { related_ids?: { order_id?: string; capture_id?: string } }; links?: { rel: string; href: string }[] } };
export async function applyPayPalEvent(event: PayPalEvent) {
  if (["CHECKOUT.ORDER.APPROVED", "PAYMENT.CAPTURE.COMPLETED", "PAYMENT.CAPTURE.DENIED", "PAYMENT.CAPTURE.REVERSED"].includes(event.event_type)) {
    const remoteId = event.event_type === "CHECKOUT.ORDER.APPROVED" ? event.resource.id : event.resource.supplementary_data?.related_ids?.order_id;
    if (!remoteId || !/^[A-Za-z0-9]+$/.test(remoteId)) throw new Error("Missing PayPal order identity.");
    const order = await prisma.order.findUnique({ where: { paypalOrderId: remoteId } });
    if (!order) return;
    // Approved does not mean captured. This verified event can recover an interrupted return.
    await processPaymentEvent("PAYPAL", event.id, event.event_type, order.id, async tx => {
      const current = await lockOrder(tx, order.id);
      let remote = await paypalRequest<PayPalOrder>(`/v2/checkout/orders/${remoteId}`);
      assertPayPalOrderMatches(current, remote);
      if (remote.status === "APPROVED" && current.paymentState === "PENDING" && current.status === "PENDING" && current.reservationExpiresAt && current.reservationExpiresAt > new Date()) {
        // The local order lock also serializes expiry and browser-triggered capture.
        remote = await paypalRequest<PayPalOrder>(`/v2/checkout/orders/${remoteId}/capture`, "POST", {}, `capture-${order.id}`);
      }
      if (["PAYMENT.CAPTURE.DENIED", "PAYMENT.CAPTURE.REVERSED"].includes(event.event_type)) {
        await tx.order.update({ where: { id: order.id }, data: { paymentState: "REVIEW" } });
        return;
      }
      await confirmPayPalOrder(tx, order.id, remote);
    });
  } else if (event.event_type === "PAYMENT.CAPTURE.REFUNDED") {
    if (!/^[A-Za-z0-9]+$/.test(event.resource.id)) throw new Error("Invalid refund identity.");
    const refund = await paypalRequest<{ id: string; status: string; amount: { currency_code: string; value: string }; links?: { rel: string; href: string }[] }>(`/v2/payments/refunds/${event.resource.id}`);
    if (refund.status !== "COMPLETED") return;
    // Parse only the capture identifier. Never fetch a URL supplied by a webhook.
    const up = refund.links?.find(link => link.rel === "up")?.href || "";
    const captureId = /\/v2\/payments\/captures\/([A-Za-z0-9]+)$/.exec(up)?.[1];
    if (!captureId) throw new Error("Missing refund capture identity.");
    const capture = await paypalRequest<{ id: string; status: string; amount: { currency_code: string; value: string }; supplementary_data?: { related_ids?: { order_id?: string } } }>(`/v2/payments/captures/${captureId}`);
    let order = await prisma.order.findUnique({ where: { providerPaymentId: captureId } });
    let remote: PayPalOrder | null = null;
    if (!order) {
      const remoteId = capture.supplementary_data?.related_ids?.order_id;
      if (!remoteId || !/^[A-Za-z0-9]+$/.test(remoteId)) throw new Error("Refund requires order reconciliation.");
      remote = await paypalRequest<PayPalOrder>(`/v2/checkout/orders/${remoteId}`);
      order = await prisma.order.findUnique({ where: { paypalOrderId: remoteId } });
      if (order) assertPayPalOrderMatches(order, remote);
    }
    if (!order || order.paymentProvider !== "PAYPAL") throw new Error("Refund requires payment reconciliation.");
    assertPaymentMatches(order, { orderId: order.id, amountCents: dollarsToCents(capture.amount.value), currency: capture.amount.currency_code });
    if (refund.amount.currency_code !== "USD") throw new Error("Refund currency mismatch.");
    const id = order.id;
    await processPaymentEvent("PAYPAL", `refund:${refund.id}`, event.event_type, id, async tx => {
      let current = await lockOrder(tx, id);
      if (!current.providerPaymentId) {
        if (!remote) throw new Error("Missing canonical order binding.");
        current = { ...current, ...await tx.order.update({ where: { id }, data: { providerPaymentId: captureId, paymentState: "REVIEW", paymentReviewReason: "REFUND_BEFORE_CONFIRMATION" } }) };
      }
      if (current.providerPaymentId !== captureId) throw new Error("Refund capture mismatch.");
      await recordRefund(tx, id, capture.status === "REFUNDED" ? current.totalCents : Math.min(current.totalCents, current.refundedCents + dollarsToCents(refund.amount.value)));
    });
  }
}
