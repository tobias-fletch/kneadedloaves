import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST() {
  await requireAdmin();
  if (process.env.NODE_ENV === "production") return NextResponse.json({ error: "Bulk order deletion is disabled in production." }, { status: 403 });
  const result = await prisma.$transaction(async (tx) => {
    const orders = await tx.order.findMany({ include: { items: true } });
    const restored = new Map<string, number>();
    for (const order of orders) {
      if (order.inventoryRestored || order.status === "COMPLETED") continue;
      for (const item of order.items) {
        if (!item.productId) continue;
        restored.set(item.productId, (restored.get(item.productId) ?? 0) + item.quantity);
      }
    }
    for (const [productId, quantity] of restored) {
      await tx.product.update({ where: { id: productId }, data: { inventoryLimit: { increment: quantity }, soldOut: false } });
    }
    await tx.orderItem.deleteMany();
    const deleted = await tx.order.deleteMany();
    await tx.cartItem.deleteMany();
    return { deletedOrders: deleted.count, restored: Object.fromEntries(restored) };
  });

  return NextResponse.json(result);
}
