// Deliberately pure: this rehearsal never uses live carts, orders, inventory or payments.
import { orderSchema } from "./validation";
export const trialProducts = [{ id: "test-loaf", name: "TEST · Country loaf", priceCents: 1200 }, { id: "test-rolls", name: "TEST · Cinnamon rolls", priceCents: 1800 }] as const;
export type TrialStatus = "PENDING" | "PAID" | "PREPARING" | "READY" | "OUT_FOR_DELIVERY" | "COMPLETED" | "CANCELLED" | "EXPIRED";
export type TrialOrder = { reference: string; status: TrialStatus; payment: "UNVERIFIED" | "REVIEW_REQUESTED" | "VERIFIED"; fulfillment: "PICKUP" | "DELIVERY"; totalCents: number; quantity: number; productName: string; customerName: string; dueAt: number; history: string[] };
export function createTrialOrder(input: unknown, productId: string, quantity: number, now: number): TrialOrder {
  const parsed = orderSchema.safeParse(input);
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message || "Check your test details.");
  const product = trialProducts.find(item => item.id === productId);
  if (!product || !Number.isInteger(quantity) || quantity < 1 || quantity > 5) throw new Error("Choose 1–5 test items.");
  if (parsed.data.fulfillmentType === "DELIVERY" && parsed.data.deliveryZip !== "00000") throw new Error("Use the fictional test ZIP 00000.");
  return { reference: "TEST-KL-0001", status: "PENDING", payment: "UNVERIFIED", fulfillment: parsed.data.fulfillmentType, totalCents: product.priceCents * quantity + (parsed.data.fulfillmentType === "DELIVERY" ? 500 : 0), quantity, productName: product.name, customerName: parsed.data.customerName, dueAt: now + 30 * 60000, history: ["TEST reservation created. Payment unverified."] };
}
export type TrialAction = "claim" | "verify" | "advance" | "cancel" | "expire";
export function transitionTrial(order: TrialOrder, action: TrialAction, now: number, amountCents?: number): TrialOrder {
  if (["COMPLETED", "CANCELLED", "EXPIRED"].includes(order.status)) throw new Error("This test order is closed. Start another test.");
  if (action === "expire") {
    if (order.status !== "PENDING") throw new Error("Only an unpaid reservation can expire.");
    return { ...order, status: "EXPIRED", history: [...order.history, "TEST reservation expired. No real stock was reserved or restored."] };
  }
  if (order.status === "PENDING" && now >= order.dueAt) return transitionTrial(order, "expire", now);
  if (action === "cancel") {
    if (order.status !== "PENDING") throw new Error("Paid orders require separate refund reconciliation in production.");
    return { ...order, status: "CANCELLED", history: [...order.history, "TEST unpaid reservation cancelled."] };
  }
  if (action === "claim") {
    if (order.status !== "PENDING") throw new Error("This test order is already verified.");
    if (order.payment === "REVIEW_REQUESTED") return order;
    return { ...order, payment: "REVIEW_REQUESTED", history: [...order.history, "TEST customer requested payment review. This does not confirm payment."] };
  }
  if (action === "verify") {
    if (order.status !== "PENDING" || amountCents !== order.totalCents) throw new Error("Verification requires the exact full test total.");
    return { ...order, status: "PAID", payment: "VERIFIED", history: [...order.history, "TEST owner simulated independent full-payment verification. No money moved."] };
  }
  if (order.payment !== "VERIFIED") throw new Error("Fulfillment requires independently verified full payment.");
  const next: Partial<Record<TrialStatus, TrialStatus>> = { PAID: "PREPARING", PREPARING: "READY", READY: order.fulfillment === "DELIVERY" ? "OUT_FOR_DELIVERY" : "COMPLETED", OUT_FOR_DELIVERY: "COMPLETED" };
  const status = next[order.status];
  if (!status) throw new Error("That test status change is not allowed.");
  return { ...order, status, history: [...order.history, `TEST fulfillment: ${status.replaceAll("_", " ")}.`] };
}
