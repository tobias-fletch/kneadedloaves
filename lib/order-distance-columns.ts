import type { PrismaClient } from "@prisma/client";

// Hub #63 adds two nullable Order columns. Preview deployments share the
// production database, where the migration only runs on a production deploy.
// Until it has run, the app must keep working without those columns, so the
// Prisma client omits them by default (lib/prisma.ts) and code checks here first.
export const DISTANCE_COLUMNS = ["deliveryDistanceMiles", "deliveryDistanceVerified"] as const;
let known: { value: boolean; at: number } | null = null;

export async function hasDeliveryDistanceColumns(db: Pick<PrismaClient, "$queryRaw">): Promise<boolean> {
  // A positive answer is permanent (the migration is additive); a negative one is re-checked every minute.
  if (known && (known.value || Date.now() - known.at < 60000)) return known.value;
  try {
    const rows = await db.$queryRaw<{ count: number }[]>`SELECT COUNT(*)::int AS count FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'Order' AND column_name IN ('deliveryDistanceMiles', 'deliveryDistanceVerified')`;
    known = { value: Number(rows[0]?.count) === DISTANCE_COLUMNS.length, at: Date.now() };
  } catch {
    known = { value: false, at: Date.now() };
  }
  return known.value;
}

export function resetDeliveryDistanceColumnCache() { known = null; }
