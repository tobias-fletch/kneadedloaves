import { handleCron } from "@/lib/cron-route";
import { runPaymentExpiry } from "@/lib/manual-payments";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: Request) {
  return handleCron(request, () => runPaymentExpiry({ maxBatches: 5 }));
}
