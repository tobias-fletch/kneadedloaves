-- Delivery is free in ZIP 11217 only. Idempotent. Does not rewrite Order snapshots.
-- Other delivery zones are deactivated, not deleted, because orders may reference them.
-- That includes dz-brooklyn-7 (11231, 11216, 11232, $7) and dz-elsewhere-7
-- (the catch-all with an empty zipCodes array).

INSERT INTO "DeliveryZone" ("id", "name", "zipCodes", "feeCents", "instructions", "active", "createdAt", "updatedAt")
SELECT 'dz-nearby-free', 'Free delivery in 11217', ARRAY['11217']::text[], 0,
  'Free delivery in 11217.', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (
  SELECT 1 FROM "DeliveryZone"
  WHERE "id" = 'dz-nearby-free' OR '11217' = ANY("zipCodes")
);

UPDATE "DeliveryZone" AS zone
SET
  "name" = 'Free delivery in 11217',
  "zipCodes" = ARRAY['11217']::text[],
  "feeCents" = 0,
  "instructions" = 'Free delivery in 11217.',
  "active" = true,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE zone."id" = (
  SELECT "id" FROM "DeliveryZone"
  WHERE "id" = 'dz-nearby-free' OR '11217' = ANY("zipCodes")
  ORDER BY CASE WHEN "id" = 'dz-nearby-free' THEN 0 ELSE 1 END, "active" DESC, "id"
  LIMIT 1
)
AND (
  zone."name" IS DISTINCT FROM 'Free delivery in 11217'
  OR zone."zipCodes" IS DISTINCT FROM ARRAY['11217']::text[]
  OR zone."feeCents" IS DISTINCT FROM 0
  OR zone."instructions" IS DISTINCT FROM 'Free delivery in 11217.'
  OR zone."active" IS DISTINCT FROM true
);

UPDATE "DeliveryZone"
SET "active" = false, "updatedAt" = CURRENT_TIMESTAMP
WHERE "active" = true
  AND "id" <> (
    SELECT "id" FROM "DeliveryZone"
    WHERE "id" = 'dz-nearby-free' OR '11217' = ANY("zipCodes")
    ORDER BY CASE WHEN "id" = 'dz-nearby-free' THEN 0 ELSE 1 END, "active" DESC, "id"
    LIMIT 1
  );
