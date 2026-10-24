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
 * Runs right after checkout (processOrderEmails). When ADMIN_NOTIFY_EMAIL is set, admin new-order alerts are on:
 * queue the alert under the same dedupe key checkout uses. If checkout already queued one (AdminSettings enabled),
 * the upsert is a no-op, so nobody is emailed twice. Without the env var nothing happens, exactly as before.
 */
export async function queueAdminOrderFallback(orderId: string, env: Record<string, string | undefined> = process.env) {
  const to = adminNotifyOverride(env);
  if (!to) return false;
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { items: true } });
  if (!order) return false;
  const rendered = renderOrderEmail("admin-new-order", detailsFromOrder(order, await fulfillmentDateFor(prisma, order.orderWindowId)));
  await queueEmail({ dedupeKey: `admin-order:${order.id}`, to, subject: rendered.subject, body: rendered.text, html: rendered.html });
  return true;
}
