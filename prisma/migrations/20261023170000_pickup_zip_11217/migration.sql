-- Pickup is S Portland Ave & Atlantic Ave, Brooklyn, NY 11217.
-- Idempotent. Does not rewrite Order snapshots.
-- Replaces the sample "123 Oven Lane, Brooklyn, NY" address (no ZIP) and the
-- earlier ZIP-only label "Brooklyn, NY 11217".

INSERT INTO "PickupLocation" ("id", "name", "address", "instructions", "active", "createdAt", "updatedAt")
SELECT 'pickup-11217', 'Brooklyn pickup', 'S Portland Ave & Atlantic Ave, Brooklyn, NY 11217',
  'Pickup is at S Portland Ave & Atlantic Ave, Brooklyn, NY 11217. The bakery confirms the handoff after payment is verified.',
  true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "PickupLocation");

UPDATE "PickupLocation"
SET
  "address" = CASE
    WHEN "address" ILIKE '%123 Oven Lane%' OR btrim("address") = '' OR btrim("address") ILIKE 'Brooklyn, NY 11217' THEN 'S Portland Ave & Atlantic Ave, Brooklyn, NY 11217'
    WHEN "address" ILIKE '%11217%' THEN "address"
    ELSE btrim("address") || ', S Portland Ave & Atlantic Ave, Brooklyn, NY 11217'
  END,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "address" ILIKE '%123 Oven Lane%'
   OR btrim("address") = ''
   OR btrim("address") ILIKE 'Brooklyn, NY 11217'
   OR "address" NOT ILIKE '%11217%';

UPDATE "PickupLocation"
SET
  "instructions" = 'Pickup is at S Portland Ave & Atlantic Ave, Brooklyn, NY 11217. The bakery confirms the handoff after payment is verified.',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE coalesce("instructions", '') ILIKE '%123 Oven Lane%'
   OR coalesce("instructions", '') ILIKE '%Ring the bell marked Bakery%'
   OR btrim(coalesce("instructions", '')) IN (
     'Pickup is in Brooklyn, NY 11217. The bakery confirms the handoff after payment is verified.',
     'Pickup is in Brooklyn, NY 11217. The exact handoff is confirmed after payment.'
   );

UPDATE "AdminSettings"
SET
  "pickupRules" = 'Pickup is at S Portland Ave & Atlantic Ave, Brooklyn, NY 11217. The exact handoff is confirmed after payment.',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "pickupRules" IN (
  'Pickup times are listed in each order confirmation.',
  'Pickup details will be shared after ordering.',
  'Pickup is in Brooklyn, NY 11217. The exact handoff is confirmed after payment.'
);
