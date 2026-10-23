import "dotenv/config";
import { runEmailMaintenance } from "../lib/email-maintenance";
import { prisma } from "../lib/prisma";

let stopping = false;
process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });

async function main() {
  while (!stopping) {
    try {
      await runEmailMaintenance({ maxJobs: 1 });
    } catch {
      console.error("Email worker failed; check database connectivity.");
    }
    if (process.argv.includes("--once")) break;
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  await prisma.$disconnect();
}

main().catch(() => { process.exitCode = 1; });
