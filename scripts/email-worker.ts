import "dotenv/config";
import { processEmailQueue } from "../lib/email-queue";
import { prisma } from "../lib/prisma";
let stopping = false;
process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });
async function main() {
  while (!stopping) {
    try {
      await processEmailQueue();
      await prisma.rateLimit.deleteMany({ where: { expiresAt: { lt: new Date() } } });
      await prisma.passwordReset.deleteMany({ where: { expiresAt: { lt: new Date() } } });
      await prisma.emailJob.deleteMany({ where: { status: "SENT", sentAt: { lt: new Date(Date.now() - 30 * 86400000) } } });
    } catch { console.error("Email worker failed; check database connectivity."); }
    if (process.argv.includes("--once")) break;
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  await prisma.$disconnect();
}
main().catch(() => { process.exitCode = 1; });
