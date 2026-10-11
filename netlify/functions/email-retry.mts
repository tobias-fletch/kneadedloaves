import { processEmailQueue } from "../../lib/email-queue";
import { prisma } from "../../lib/prisma";

// Runs only on published deployments, never through a public URL.
// Immediate delivery uses Next after(); this low-frequency pass recovers retries
// while allowing the free database to sleep between quiet periods.
const emailRetry = async () => {
  try {
    await processEmailQueue();
    await prisma.rateLimit.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    await prisma.passwordReset.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  } catch { console.error("Email retry requires attention in the admin dashboard."); }
};
export default emailRetry;
export const config = { schedule: "*/15 * * * *" };
