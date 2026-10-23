import "dotenv/config";
import { runPaymentExpiry } from "../lib/manual-payments";
import { prisma } from "../lib/prisma";

async function main() {
  await runPaymentExpiry({ maxBatches: 1000 });
}

main().catch(() => { console.error("Payment expiry failed."); process.exitCode = 1; }).finally(() => prisma.$disconnect());
