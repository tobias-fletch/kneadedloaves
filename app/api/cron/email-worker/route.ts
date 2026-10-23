import { handleCron } from "@/lib/cron-route";
import { runEmailMaintenance } from "@/lib/email-maintenance";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: Request) {
  return handleCron(request, () => runEmailMaintenance({ maxJobs: 25 }));
}
