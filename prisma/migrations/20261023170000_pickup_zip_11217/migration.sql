-- Pickup is Brooklyn, NY 11217. A street address is not on file, so the public
-- label is the ZIP only. Idempotent. Does not rewrite Order snapshots.
-- Replaces the sample "123 Oven Lane, Brooklyn, NY" address (no ZIP) and any
-- other pickup address that does not already include 11217.

INSERT INTO "PickupLocation" ("id", "name", "address", "instructions", "active", "createdAt", "updatedAt")
SELECT 'pickup-11217', 'Brooklyn pickup', 'Brooklyn, NY 11217',
  'Pickup is in Brooklyn, NY 11217. The bakery confirms the handoff after payment is verified.',
  true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "PickupLocation");

UPDATE "PickupLocation"
SET
  "address" = CASE
    WHEN "address" ILIKE '%123 Oven Lane%' OR btrim("address") = '' THEN 'Brooklyn, NY 11217'
    WHEN "address" ILIKE '%11217%' THEN "address"
    ELSE btrim("address") || ', Brooklyn, NY 11217'
  END,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "address" NOT ILIKE '%11217%' OR "address" ILIKE '%123 Oven Lane%';

UPDATE "PickupLocation"
SET
  "instructions" = 'Pickup is in Brooklyn, NY 11217. The bakery confirms the handoff after payment is verified.',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE coalesce("instructions", '') ILIKE '%123 Oven Lane%'
   OR coalesce("instructions", '') ILIKE '%Ring the bell marked Bakery%';

UPDATE "AdminSettings"
SET
  "pickupRules" = 'Pickup is in Brooklyn, NY 11217. The exact handoff is confirmed after payment.',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "pickupRules" IN (
  'Pickup times are listed in each order confirmation.',
  'Pickup details will be shared after ordering.'
);
