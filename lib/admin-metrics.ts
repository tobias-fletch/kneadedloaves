type MetricOrder = { status: string; paymentState: string; totalCents: number; paymentReviewRequestedAt?: Date | null };
/** Overview numbers. Only verified, non-cancelled orders count as revenue; unpaid and cancelled reservations do not.
 *  "Customer says paid" orders are pending orders the customer flagged; they are counted on their own, not as plain awaiting payment. */
export function summarizeOrders(orders: MetricOrder[]) {
  const live = orders.filter(order => order.status !== "CANCELLED");
  const claimed = (order: MetricOrder) => order.status === "PENDING" && Boolean(order.paymentReviewRequestedAt);
  return {
    orders: live.length,
    awaitingPayment: live.filter(order => order.status === "PENDING" && !claimed(order)).length,
    customerSaysPaid: live.filter(claimed).length,
    needsReview: live.filter(order => order.paymentState === "REVIEW").length,
    verifiedCents: live.filter(order => order.paymentState === "VERIFIED").reduce((sum, order) => sum + order.totalCents, 0)
  };
}
