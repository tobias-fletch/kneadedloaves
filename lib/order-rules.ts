export function cartOwner(userId?: string, sessionId?: string) {
  if (userId) return { userId };
  if (sessionId && /^[0-9a-f-]{36}$/i.test(sessionId)) return { sessionId };
  return null;
}
export function acceptsOrders(window: { manualClosed: boolean; manualOpen: boolean; opensAt: Date; closesAt: Date; maxOrders: number | null }, count: number, now = new Date()) {
  return !window.manualClosed && (window.manualOpen || (window.opensAt <= now && window.closesAt >= now)) && (window.maxOrders === null || count < window.maxOrders);
}
/**
 * Venmo reservation deadline: the owner's full hold, never cut short by the window closing
 * (a late order used to get only the minutes left before close and was auto-cancelled at close).
 * It still never runs past the pickup/delivery start, so an unpaid order cannot linger into fulfillment.
 */
export function paymentDeadline(now: Date, holdMinutes: number, window: { fulfillmentDate: Date | null }) {
  const held = now.getTime() + holdMinutes * 60000;
  const fulfillment = window.fulfillmentDate?.getTime();
  return new Date(fulfillment && fulfillment > now.getTime() ? Math.min(held, fulfillment) : held);
}

type PaymentHoldOrder = { paymentMethod: string | null; status: string; paymentState: string; paymentDueAt: Date | null; paymentReviewRequestedAt: Date | null };
/** The customer pressed "I sent payment" (or the owner opened a payment check). The order waits for Tobias, not the clock. */
export function customerSaysPaid(order: Pick<PaymentHoldOrder, "status" | "paymentReviewRequestedAt">) {
  return order.status === "PENDING" && order.paymentReviewRequestedAt !== null;
}
/** Only unflagged, unverified Venmo reservations past their deadline expire. Flagged ones keep their stock and cap space until resolved by hand. */
export function shouldAutoExpire(order: PaymentHoldOrder, now = new Date()) {
  return order.paymentMethod === "VENMO" && order.status === "PENDING" && order.paymentState !== "VERIFIED" && order.paymentDueAt !== null && order.paymentDueAt <= now && !customerSaysPaid(order);
}
/** The deadline only limits mark-paid for orders nobody has flagged as paid. */
export function verifyWithinDeadline(order: Pick<PaymentHoldOrder, "status" | "paymentDueAt" | "paymentReviewRequestedAt">, receivedAt: Date, now = new Date()) {
  if (customerSaysPaid(order)) return true;
  return order.paymentDueAt !== null && order.paymentDueAt > now && receivedAt <= order.paymentDueAt;
}
