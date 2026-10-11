import { prisma } from "@/lib/prisma";
import { acceptsOrders, orderWindowConfigurationError } from "@/lib/order-rules";

async function loadOrderWindows() {
  return prisma.orderWindow.findMany({
    where: { manualClosed: false },
    orderBy: [{ fulfillmentDate: "asc" }, { opensAt: "asc" }],
    include: { orders: { where: { status: { not: "CANCELLED" } }, select: { id: true } } }
  });
}

/** Every selectable window must still be rechecked atomically when reserving an order. */
export async function getEligibleOrderWindows(now = new Date()) {
  const windows = await loadOrderWindows();
  return windows.filter((window) => acceptsOrders(window, window.orders.length, now));
}

/** Compatibility for storefront badges. Checkout must explicitly select a window ID. */
export async function getCurrentOrderWindow(now = new Date()) {
  const windows = await loadOrderWindows();
  const openWindow = windows.find((window) => acceptsOrders(window, window.orders.length, now));
  const nextWindow = windows.filter((window) => !orderWindowConfigurationError(window) && window.opensAt > now && window.closesAt > now && window.fulfillmentDate > now && window.orders.length < window.maxOrders!)
    .sort((a, b) => a.opensAt.getTime() - b.opensAt.getTime())[0];
  return { openWindow, nextWindow };
}

export async function isOrderingOpen() {
  const { openWindow } = await getCurrentOrderWindow();
  return Boolean(openWindow);
}
