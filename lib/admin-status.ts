/** Brand colour per order status so the admin can scan a list at a glance. */
export function orderStatusTone(status: string) {
  switch (status) {
    case "PENDING": return "bg-butter";
    case "CANCELLED": return "bg-page text-ink/60";
    case "COMPLETED": return "bg-sage text-page";
    default: return "bg-crumb";
  }
}

type BadgeOrder = { status: string; paymentReviewRequestedAt: Date | null };
/** Status badge text and colour. "Customer says paid" stands out from plain "Awaiting payment". */
export function orderStatusBadge(order: BadgeOrder) {
  if (order.status === "PENDING" && order.paymentReviewRequestedAt) return { label: "Customer says paid", tone: "bg-ink text-butter" };
  return { label: order.status === "PENDING" ? "Awaiting payment" : order.status.replaceAll("_", " "), tone: orderStatusTone(order.status) };
}
/** Orders waiting on Tobias's Venmo check go first; otherwise keep the existing (newest-first) order. */
export function customerSaysPaidFirst<T extends BadgeOrder>(orders: T[]) {
  const flagged = (order: T) => order.status === "PENDING" && order.paymentReviewRequestedAt ? 0 : 1;
  return [...orders].sort((a, b) => flagged(a) - flagged(b));
}
