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
