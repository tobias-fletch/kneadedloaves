type MetricOrder = { status: string; paymentState: string; totalCents: number };
/** Overview numbers. Only verified, non-cancelled orders count as revenue; unpaid and cancelled reservations do not. */
export function summarizeOrders(orders: MetricOrder[]) {
  const live = orders.filter(order => order.status !== "CANCELLED");
  return {
    orders: live.length,
    awaitingPayment: live.filter(order => order.status === "PENDING").length,
    needsReview: live.filter(order => order.paymentState === "REVIEW").length,
    verifiedCents: live.filter(order => order.paymentState === "VERIFIED").reduce((sum, order) => sum + order.totalCents, 0)
  };
}
