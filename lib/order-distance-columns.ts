import type { PrismaClient } from "@prisma/client";
import type { DeliveryQuote } from "@/lib/delivery-distance";
import { DISTANCE_NOT_VERIFIED_ADMIN_NOTE } from "@/lib/delivery-pricing";

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

/**
 * Where checkout stores the unverified-distance flag. With the columns present (every production deploy
 * migrates first) it lives only in deliveryDistanceVerified/deliveryDistanceMiles, never in the instructions.
 * Only without the columns is the admin note kept in fulfillmentInstructions so /admin still sees it;
 * customer pages and emails strip it (customerVisibleInstructions).
 */
export function deliveryDistanceOrderFields(isDelivery: boolean, quote: DeliveryQuote | null, distanceColumns: boolean, pickupInstructions?: string | null) {
  const unverifiedDistance = isDelivery && quote?.verified === false;
  const fulfillmentInstructions = isDelivery ? (unverifiedDistance && !distanceColumns ? `${DISTANCE_NOT_VERIFIED_ADMIN_NOTE}.` : undefined) : pickupInstructions ?? undefined;
  const columns = isDelivery && distanceColumns ? { deliveryDistanceMiles: quote?.distanceMiles ?? null, deliveryDistanceVerified: quote?.verified ?? false } : {};
  return { unverifiedDistance, fulfillmentInstructions, columns };
}
