import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { queueEmail } from "@/lib/email-queue";
import { detailsFromOrder, fulfillmentDateFor, renderOrderEmail, type OrderEmailKind } from "@/lib/order-email";
import { runBounded } from "@/lib/worker-batch";
import { shouldAutoExpire, verifyWithinDeadline } from "@/lib/order-rules";

export const paymentEvidenceSchema = z.object({
  action: z.enum(["verify", "review", "refund"]),
  amountCents: z.number().int().positive().max(100000000),
  currency: z.string().regex(/^[A-Z]{3}$/, "Use a three-letter uppercase currency code."),
  providerTransactionId: z.string().trim().toUpperCase().min(3).max(160).regex(/^[A-Za-z0-9_-]+$/, "Use the provider's transaction ID, without spaces."),
  receivedAt: z.string().datetime({ offset: true }),
  attested: z.literal(true),
  note: z.string().trim().max(1000).optional(),
  restock: z.boolean().optional()
}).superRefine((value, ctx) => {
  if (value.action !== "verify" && !value.note) ctx.addIssue({ code: "custom", message: "Explain the reconciliation or refund." });
  if (value.action === "refund" && value.restock === undefined) ctx.addIssue({ code: "custom", message: "Choose whether inventory should be restored." });
});
export async function lockOrder(tx: Prisma.TransactionClient, id: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`order:${id}`}))`;
  return tx.order.findUniqueOrThrow({ where: { id }, include: { items: true, paymentEvents: true } });
}
export async function restoreInventory(tx: Prisma.TransactionClient, order: Awaited<ReturnType<typeof lockOrder>>) {
  if (order.inventoryRestored) return;
  for (const item of [...order.items].sort((a,b) => (a.productId || "").localeCompare(b.productId || ""))) {
    if (item.productId) await tx.product.update({ where: { id: item.productId }, data: { inventoryLimit: { increment: item.quantity } } });
  }
  await tx.order.update({ where: { id: order.id }, data: { inventoryRestored: true } });
}
async function queueLifecycleEmail(tx: Prisma.TransactionClient, order: Awaited<ReturnType<typeof lockOrder>>, kind: OrderEmailKind, dedupeKey: string) {
  const rendered = renderOrderEmail(kind, detailsFromOrder(order, await fulfillmentDateFor(tx, order.orderWindowId)));
  await queueEmail({ dedupeKey, to: order.customerEmail, subject: rendered.subject, body: rendered.text, html: rendered.html }, tx);
}
export async function expireOrder(tx: Prisma.TransactionClient, id: string, now = new Date()) {
  const order = await lockOrder(tx, id);
  // Orders the customer says they paid are never expired automatically; Tobias confirms or cancels them.
  if (!shouldAutoExpire(order, now)) return false;
  await restoreInventory(tx, order);
  await tx.order.update({ where: { id }, data: { status: "CANCELLED" } });
  await tx.paymentEvent.create({ data: { orderId: id, type: "EXPIRED", note: "Unpaid reservation expired; any late payment needs independent reconciliation." } });
  await queueLifecycleEmail(tx, order, "reservation-expired", `expired:${id}`);
  return true;
}
async function expireUnpaidOrdersOnce(now: Date) {
  const due = await prisma.order.findMany({ where: { paymentMethod: "VENMO", status: "PENDING", paymentDueAt: { lte: now }, paymentState: { not: "VERIFIED" }, paymentReviewRequestedAt: null }, select: { id: true }, take: 100, orderBy: { paymentDueAt: "asc" } });
  let expired = 0;
  for (const order of due) if (await prisma.$transaction(tx => expireOrder(tx, order.id, now))) expired++;
  return expired;
}
let expiryInFlight: Promise<number> | null = null;
export function expireUnpaidOrders(now = new Date()) {
  if (!expiryInFlight) {
    const run = expireUnpaidOrdersOnce(now).finally(() => {
      if (expiryInFlight === run) expiryInFlight = null;
    });
    expiryInFlight = run;
  }
  return expiryInFlight;
}
export async function expireUnpaidOrdersOpportunistically(now = new Date()) {
  try { return await expireUnpaidOrders(now); }
  catch { console.error("Payment expiry check failed."); return 0; }
}
export async function runPaymentExpiry(options?: { maxBatches?: number; now?: Date }) {
  const expired = await runBounded(() => expireUnpaidOrders(options?.now), options?.maxBatches ?? 1);
  return { expired };
}
export async function recordPaymentEvidence(tx: Prisma.TransactionClient, id: string, input: z.infer<typeof paymentEvidenceSchema>, actorId: string, now?: Date) {
  input = paymentEvidenceSchema.parse(input);
  const order = await lockOrder(tx, id);
  // Evaluate the live deadline after acquiring the lock, not before waiting for it.
  now ??= new Date();
  if (order.paymentMethod !== "VENMO") throw new Error("This order is not a Venmo manual-payment order.");
  const receivedAt = new Date(input.receivedAt);
  if (receivedAt > now || receivedAt < order.createdAt) throw new Error("Payment time must be between order creation and now.");
  const duplicate = await tx.paymentEvent.findUnique({ where: { providerTransactionId: input.providerTransactionId } });
  // Idempotent retries of the exact same attestation must never perform inventory work twice.
  if (duplicate) {
    if (duplicate.orderId === id && duplicate.amountCents === input.amountCents && duplicate.currency === input.currency && duplicate.type === ({ verify: "VERIFIED", review: "REVIEW", refund: "REFUND" }[input.action]) && duplicate.receivedAt?.getTime() === receivedAt.getTime() && duplicate.restock === (input.restock ?? false)) return order;
    throw new Error("That provider transaction is already recorded. Review the existing record; do not reuse it.");
  }
  if (input.action === "verify") {
    if (order.status !== "PENDING" || order.inventoryRestored || order.paymentState === "VERIFIED" || order.paymentState === "REFUNDED" || !verifyWithinDeadline(order, receivedAt, now)) throw new Error("This reservation is no longer eligible for payment verification. Record a review for reconciliation.");
    if (input.amountCents !== order.totalCents || input.currency !== order.currency) throw new Error("Payment must exactly match the order total and currency. Record discrepancies for review.");
    if (order.paymentEvents.some(event => event.type === "REVIEW" || event.type === "REFUND")) throw new Error("This order has a payment discrepancy. Resolve it through owner reconciliation; automatic fulfillment is blocked.");
    await tx.order.update({ where: { id }, data: { status: "PAID", paymentState: "VERIFIED", paymentVerifiedAt: now, paymentVerifiedBy: actorId, verifiedAmountCents: input.amountCents, providerTransactionId: input.providerTransactionId } });
    await queueLifecycleEmail(tx, order, "payment-verified", `payment-verified:${id}`);
  } else if (input.action === "review") {
    // A new receipt can arrive even after fulfillment or a previous full refund.
    // Record it without changing the closed fulfillment state or reservations.
    await tx.order.update({ where: { id }, data: { paymentState: "REVIEW", paymentReviewRequestedAt: now } });
  } else {
    const received = order.paymentEvents.filter(event => ["VERIFIED", "REVIEW"].includes(event.type) && event.currency === input.currency).reduce((sum,event) => sum + (event.amountCents || 0), 0);
    const refunded = order.paymentEvents.filter(event => event.type === "REFUND" && event.currency === input.currency).reduce((sum,event) => sum + (event.amountCents || 0), 0);
    if (input.amountCents > received - refunded) throw new Error("Refund exceeds the recorded, independently checked payments remaining on this order.");
    if (input.restock) await restoreInventory(tx, order);
    const balances = new Map<string, number>();
    for (const event of order.paymentEvents) {
      if (!event.currency || !event.amountCents) continue;
      if (["VERIFIED", "REVIEW", "REFUND"].includes(event.type)) balances.set(event.currency, (balances.get(event.currency) || 0) + (event.type === "REFUND" ? -event.amountCents : event.amountCents));
    }
    balances.set(input.currency, (balances.get(input.currency) || 0) - input.amountCents);
    await tx.order.update({ where: { id }, data: { status: order.status === "COMPLETED" ? "COMPLETED" : "CANCELLED", paymentState: [...balances.values()].every(balance => balance === 0) ? "REFUNDED" : "REVIEW" } });
  }
  await tx.paymentEvent.create({ data: { orderId: id, type: { verify: "VERIFIED", review: "REVIEW", refund: "REFUND" }[input.action], actorId, amountCents: input.amountCents, currency: input.currency, providerTransactionId: input.providerTransactionId, receivedAt, note: input.note, restock: input.restock ?? false } });
  return tx.order.findUniqueOrThrow({ where: { id }, include: { paymentEvents: true } });
}
