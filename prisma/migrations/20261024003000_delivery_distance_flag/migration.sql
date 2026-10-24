-- Hub #63: distance-based delivery pricing. Additive and backwards-compatible.
-- Both columns are nullable with no default, so existing orders and older app
-- builds are unaffected. NULL means "not a distance-priced delivery" (pickup or
-- a legacy order). deliveryDistanceVerified = false flags an order whose
-- address could not be geocoded; it was charged the $6 fee and must be checked.
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "deliveryDistanceMiles" DOUBLE PRECISION;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "deliveryDistanceVerified" BOOLEAN;
