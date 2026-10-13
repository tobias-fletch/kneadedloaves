import { OrderStatus, Prisma } from "@prisma/client";
import { lockOrder, restoreInventory } from "@/lib/manual-payments";
const transitions: Record<OrderStatus, OrderStatus[]> = {
  PENDING: ["CANCELLED"], PAID: ["PREPARING"], PREPARING: ["READY"],
  READY: ["OUT_FOR_DELIVERY", "COMPLETED"], OUT_FOR_DELIVERY: ["COMPLETED"], COMPLETED: [], CANCELLED: []
};
export async function changeOrderStatus(tx: Prisma.TransactionClient, id: string, status: OrderStatus, actorId?: string) {
  const order = await lockOrder(tx, id);
  if (order.status === status) return order;
  if (!transitions[order.status].includes(status)) throw new Error("That status change is not allowed. Verify payments or record external refunds through reconciliation.");
  if (status !== "CANCELLED" && (order.paymentState !== "VERIFIED" || !order.paymentVerifiedAt || order.verifiedAmountCents !== order.totalCents)) throw new Error("Fulfillment requires independently verified full payment.");
  if (status === "OUT_FOR_DELIVERY" && order.fulfillmentType !== "DELIVERY") throw new Error("Pickup orders cannot be out for delivery.");
  if (status === "CANCELLED" && order.stripeCheckoutSessionId) throw new Error("Cancel the payment session through its payment provider first.");
  if (status === "CANCELLED") await restoreInventory(tx, order);
  await tx.paymentEvent.create({ data: { orderId: id, type: status === "CANCELLED" ? "CANCELLED" : "STATUS_CHANGED", actorId, note: `${order.status} → ${status}` } });
  return tx.order.update({ where: { id }, data: { status } });
}
