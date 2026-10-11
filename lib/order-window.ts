import { prisma } from "@/lib/prisma";

export async function getCurrentOrderWindow() {
  const now = new Date();
  const windows = await prisma.orderWindow.findMany({
    where: { manualClosed: false },
    orderBy: { opensAt: "asc" },
    include: { orders: { where: { status: { not: "CANCELLED" } }, select: { id: true } } }
  });

  const openWindow = windows.find((window) => {
    const withinSchedule = window.opensAt <= now && window.closesAt >= now;
    const capacityOk = !window.maxOrders || window.orders.length < window.maxOrders;
    return capacityOk && (window.manualOpen || withinSchedule);
  });

  const nextWindow = windows.find((window) => window.opensAt > now);
  return { openWindow, nextWindow };
}

export async function isOrderingOpen() {
  const { openWindow } = await getCurrentOrderWindow();
  return Boolean(openWindow);
}
