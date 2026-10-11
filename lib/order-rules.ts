export function cartOwner(userId?: string, sessionId?: string) {
  if (userId) return { userId };
  if (sessionId && /^[0-9a-f-]{36}$/i.test(sessionId)) return { sessionId };
  return null;
}
export function acceptsOrders(window: { manualClosed: boolean; manualOpen: boolean; opensAt: Date; closesAt: Date; maxOrders: number | null }, count: number, now = new Date()) {
  return !window.manualClosed && (window.manualOpen || (window.opensAt <= now && window.closesAt >= now)) && (window.maxOrders === null || count < window.maxOrders);
}
