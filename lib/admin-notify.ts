import { prisma } from "@/lib/prisma";
import { queueEmail } from "@/lib/email-queue";
import { detailsFromOrder, fulfillmentDateFor, renderOrderEmail } from "@/lib/order-email";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** ADMIN_NOTIFY_EMAIL when it is a deliverable address; .local placeholders (admin@bakery.local) are ignored. */
export function adminNotifyOverride(env: Record<string, string | undefined> = process.env) {
  const address = (env.ADMIN_NOTIFY_EMAIL ?? "").trim();
  if (!EMAIL.test(address) || /\.local$/i.test(address)) return null;
  return address;
}

/**
 * Runs after checkout has committed and responded (processOrderEmails via after()). When ADMIN_NOTIFY_EMAIL is set,
 * queue the admin new-order alert under checkout's own dedupe key; if checkout already queued one (AdminSettings
 * enabled) the upsert is a no-op. Without the env var nothing happens, exactly as before.
 * Fire-and-log: never throws, so an admin alert problem can never affect an order.
 */
export async function queueAdminOrderFallback(orderId: string, env: Record<string, string | undefined> = process.env) {
  try {
    const to = adminNotifyOverride(env);
    if (!to) return false;
    const order = await prisma.order.findUnique({ where: { id: orderId }, include: { items: true } });
    if (!order) return false;
    const rendered = renderOrderEmail("admin-new-order", detailsFromOrder(order, await fulfillmentDateFor(prisma, order.orderWindowId)));
    await queueEmail({ dedupeKey: `admin-order:${order.id}`, to, subject: rendered.subject, body: rendered.text, html: rendered.html });
    return true;
  } catch {
    console.error("Admin order alert could not be queued; the order is unaffected.");
    return false;
  }
}
