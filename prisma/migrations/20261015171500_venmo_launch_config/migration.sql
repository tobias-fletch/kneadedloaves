-- Venmo launch configuration, owner-approved Oct 15, 2026.
-- Idempotent: ON CONFLICT DO NOTHING never overwrites values the owner later changes in Setup.
-- VENMO_CHECKOUT_ENABLED is deliberately NOT seeded: checkout stays off until the
-- admin password rotation is confirmed, then the owner flips it in Admin > Setup.

INSERT INTO "AppConfig" ("key", "value", "secret", "createdAt", "updatedAt") VALUES
  ('VENMO_HANDLE', '@kneadedloaves', false, NOW(), NOW()),
  ('VENMO_DESTINATION', 'https://www.venmo.com/u/kneadedloaves', false, NOW(), NOW()),
  ('VENMO_DESTINATION_VERIFIED', 'true', false, NOW(), NOW()),
  ('VENMO_VERIFIED_FINGERPRINT', '37fb2de28f169f2b93570b99d0c77c6993c43bd09239116b30e54d6a2384699a', false, NOW(), NOW()),
  ('PAYMENT_HOLD_MINUTES', '60', false, NOW(), NOW())
ON CONFLICT ("key") DO NOTHING;

-- Delivery zones: free within ~1 mile of 11217, flat $7 beyond (in-zone and outside).
INSERT INTO "DeliveryZone" ("id", "name", "zipCodes", "feeCents", "instructions", "active", "createdAt", "updatedAt") VALUES
  ('dz-nearby-free', 'Nearby — free delivery', ARRAY['11217','11201','11215','11238'], 0, 'Free delivery within about a mile.', true, NOW(), NOW()),
  ('dz-brooklyn-7', 'Brooklyn — $7 delivery', ARRAY['11231','11216','11232'], 700, 'Flat $7 delivery.', true, NOW(), NOW()),
  ('dz-elsewhere-7', 'All other areas — $7 delivery', ARRAY[]::text[], 700, 'Flat $7 delivery outside the local ZIPs.', true, NOW(), NOW())
ON CONFLICT ("id") DO NOTHING;
