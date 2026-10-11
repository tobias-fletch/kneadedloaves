import { OrderStatus, Prisma } from "@prisma/client";

const transitions: Record<OrderStatus, OrderStatus[]> = {
  PENDING: ["CANCELLED"], PAID: ["PREPARING"], PREPARING: ["READY"],
  READY: ["OUT_FOR_DELIVERY", "COMPLETED"], OUT_FOR_DELIVERY: ["COMPLETED"], COMPLETED: [], CANCELLED: []
};
export async function changeOrderStatus(tx: Prisma.TransactionClient, id: string, status: OrderStatus) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`order:${id}`}))`;
  const order = await tx.order.findUniqueOrThrow({ where: { id }, include: { items: true } });
  if (order.status === status) return order;
  if (!transitions[order.status].includes(status)) throw new Error("That order status change is not allowed. Payments and refunds must be verified by the payment integration.");
  if (status !== "CANCELLED" && order.paymentState !== "PAID") throw new Error("Only verified paid orders can advance. Review refunds or payment exceptions with the provider.");
  if (status === "OUT_FOR_DELIVERY" && order.fulfillmentType !== "DELIVERY") throw new Error("Pickup orders cannot be out for delivery.");
  if (status === "CANCELLED" && order.paymentProvider) throw new Error("Cancel the payment session through the payment integration first.");
  if (status === "CANCELLED" && !order.inventoryRestored) {
    for (const item of [...order.items].sort((a, b) => (a.productId || "").localeCompare(b.productId || ""))) {
      if (item.productId) await tx.product.update({ where: { id: item.productId }, data: { inventoryLimit: { increment: item.quantity }, soldOut: false } });
    }
  }
  return tx.order.update({ where: { id }, data: { status, ...(status === "CANCELLED" ? { inventoryRestored: true } : {}) } });
}
