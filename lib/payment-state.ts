import { PaymentProvider, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { prepareOrderEmail, getOrderEmailTemplates } from "@/lib/email";
import { queueEmail } from "@/lib/email-queue";
import { assertPaymentMatches } from "@/lib/payment-rules";

type PaymentProof = { orderId: string; provider: PaymentProvider; providerOrderId: string; paymentId: string; amountCents: number; currency: string };
export async function lockOrder(tx: Prisma.TransactionClient, id: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`order:${id}`}))`;
  return tx.order.findUniqueOrThrow({ where: { id }, include: { items: true } });
}
export async function confirmPayment(tx: Prisma.TransactionClient, proof: PaymentProof) {
  const order = await lockOrder(tx, proof.orderId);
  assertPaymentMatches(order, proof);
  if (order.paymentProvider !== proof.provider) throw new Error("Payment provider mismatch.");
  const boundId = proof.provider === "STRIPE" ? order.stripeCheckoutSessionId : order.paypalOrderId;
  if (boundId && boundId !== proof.providerOrderId) throw new Error("Payment session mismatch.");
  if (order.providerPaymentId && order.providerPaymentId !== proof.paymentId) throw new Error("Payment identity mismatch.");
  // Replayed/out-of-order success cannot undo a refund, cancellation, or operational progress.
  if (["PAID", "PARTIALLY_REFUNDED", "REFUNDED"].includes(order.paymentState)) return order;
  if (order.inventoryRestored || order.status === "CANCELLED") {
    return tx.order.update({ where: { id: order.id }, data: { paymentState: "REVIEW", paymentReviewReason: "LATE_PAYMENT", providerPaymentId: proof.paymentId } });
  }
  const updated = await tx.order.update({ where: { id: order.id }, data: {
    status: "PAID", paymentState: "PAID", paymentReviewReason: null, providerPaymentId: proof.paymentId, paidAt: new Date(),
    ...(proof.provider === "STRIPE" ? { stripeCheckoutSessionId: proof.providerOrderId } : { paypalOrderId: proof.providerOrderId })
  } });
  if (order.checkoutCartId) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${order.checkoutCartId}))`;
    for (const item of order.items) {
      if (!item.productId) continue;
      const cartItem = await tx.cartItem.findUnique({ where: { cartId_productId: { cartId: order.checkoutCartId, productId: item.productId } } });
      if (!cartItem) continue;
      if (cartItem.quantity <= item.quantity) await tx.cartItem.delete({ where: { id: cartItem.id } });
      else await tx.cartItem.update({ where: { id: cartItem.id }, data: { quantity: { decrement: item.quantity } } });
    }
  }
  const templates = await getOrderEmailTemplates(tx);
  const email = prepareOrderEmail({ to: order.customerEmail, orderId: order.id, customerName: order.customerName, totalCents: order.totalCents, fulfillmentType: order.fulfillmentType, fulfillmentInstructions: order.fulfillmentInstructions, items: order.items }, templates, true);
  await queueEmail({ dedupeKey: `order-paid:${order.id}`, ...email }, tx);
  const settings = await tx.adminSettings.findFirst();
  if (settings?.emailNotificationsEnabled && settings.notificationEmail) await queueEmail({ dedupeKey: `admin-paid:${order.id}`, to: settings.notificationEmail, subject: "Paid bakery order", body: `Payment confirmed for order ${order.id}. Review fulfillment in the admin dashboard.` }, tx);
  return updated;
}
export async function releaseReservation(tx: Prisma.TransactionClient, id: string, state: "FAILED" | "EXPIRED") {
  const order = await lockOrder(tx, id);
  if (order.status !== "PENDING" || (order.paymentState !== "PENDING" && !(order.paymentState === "REVIEW" && order.paymentReviewReason === "CREATION_UNKNOWN" && !order.providerPaymentId)) || order.inventoryRestored) return order;
  for (const item of [...order.items].sort((a, b) => (a.productId || "").localeCompare(b.productId || ""))) {
    if (item.productId) await tx.product.update({ where: { id: item.productId }, data: { inventoryLimit: { increment: item.quantity }, soldOut: false } });
  }
  return tx.order.update({ where: { id }, data: { status: "CANCELLED", paymentState: state, paymentReviewReason: null, inventoryRestored: true } });
}
export async function recordRefund(tx: Prisma.TransactionClient, id: string, refundedCents: number) {
  const order = await lockOrder(tx, id);
  if (!Number.isSafeInteger(refundedCents) || refundedCents < 0 || refundedCents > order.totalCents) throw new Error("Invalid refunded amount.");
  if (!order.providerPaymentId || refundedCents <= order.refundedCents) return order;
  // Refunding does not automatically restock baked/prepared food or change fulfillment state.
  return tx.order.update({ where: { id }, data: { refundedCents, paymentState: refundedCents === order.totalCents ? "REFUNDED" : "PARTIALLY_REFUNDED" } });
}
export async function processPaymentEvent(provider: PaymentProvider, eventId: string, eventType: string, orderId: string | null, apply: (tx: Prisma.TransactionClient) => Promise<unknown>) {
  return prisma.$transaction(async tx => {
    const id = `${provider}:${eventId}`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`event:${id}`}))`;
    if (await tx.paymentEvent.findUnique({ where: { id } })) return;
    await apply(tx);
    await tx.paymentEvent.create({ data: { id, provider, eventType, orderId } });
  }, { timeout: 30000 });
}
