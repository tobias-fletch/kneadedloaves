import { prisma } from "@/lib/prisma";
import { processEmailQueue } from "@/lib/email-queue";
import { runBounded } from "@/lib/worker-batch";
import { queueAdminOrderFallback } from "@/lib/admin-notify";

export async function pruneOperationalRecords() {
  const now = new Date();
  await prisma.rateLimit.deleteMany({ where: { expiresAt: { lt: now } } });
  await prisma.passwordReset.deleteMany({ where: { expiresAt: { lt: now } } });
  await prisma.emailJob.deleteMany({ where: { status: "SENT", sentAt: { lt: new Date(now.getTime() - 30 * 86400000) } } });
}

export async function processOrderEmails(orderId: string, maxJobs = 5, deps = { adminFallback: queueAdminOrderFallback, processQueue: processEmailQueue }) {
  if (!/^[\w-]+$/.test(orderId)) return 0;
  // The admin alert is best-effort: a failure here is logged and the customer's email still goes out.
  try { await deps.adminFallback(orderId); } catch { console.error("Admin order alert could not be queued; the order is unaffected."); }
  return runBounded(() => deps.processQueue({ dedupeSuffix: `:${orderId}` }), maxJobs);
}

export async function runEmailMaintenance(options?: { maxJobs?: number }) {
  const processed = await runBounded(() => processEmailQueue(), options?.maxJobs ?? 25);
  await pruneOperationalRecords();
  return { processed };
}
