import { prisma } from "@/lib/prisma";
import { processEmailQueue } from "@/lib/email-queue";
import { runBounded } from "@/lib/worker-batch";

export async function pruneOperationalRecords() {
  const now = new Date();
  await prisma.rateLimit.deleteMany({ where: { expiresAt: { lt: now } } });
  await prisma.passwordReset.deleteMany({ where: { expiresAt: { lt: now } } });
  await prisma.emailJob.deleteMany({ where: { status: "SENT", sentAt: { lt: new Date(now.getTime() - 30 * 86400000) } } });
}

export async function processOrderEmails(orderId: string, maxJobs = 5) {
  if (!/^[\w-]+$/.test(orderId)) return 0;
  return runBounded(() => processEmailQueue({ dedupeSuffix: `:${orderId}` }), maxJobs);
}

export async function runEmailMaintenance(options?: { maxJobs?: number }) {
  const processed = await runBounded(() => processEmailQueue(), options?.maxJobs ?? 25);
  await pruneOperationalRecords();
  return { processed };
}
