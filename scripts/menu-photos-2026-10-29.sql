-- Kneaded Loaves: switch four menu items from illustrations to real photos (2026-10-29).
--
-- GO-LIVE STEP, run once against the production database by Tobias (or with his
-- okay) AFTER the PR that adds public/menu-art/photos/*.webp is deployed to
-- production. Nothing in this repo runs it against production automatically.
-- Preview builds run it against their own Neon preview branch only
-- (scripts/build.mjs, after the preview guard has refused production).
--
-- Idempotent and narrow: a row changes only when its product matches by slug or
-- exact name AND its image is still the old illustration. Running it twice, or
-- after an admin has picked a different image, changes nothing.
-- Herbal Focaccia has no photo yet and is not touched.
--
-- Run:      npx prisma db execute --schema prisma/schema.prisma --file scripts/menu-photos-2026-10-29.sql
-- Rollback: scripts/menu-photos-2026-10-29.rollback.sql
BEGIN;
WITH photos (slug, name, old_url, new_url, alt) AS (
  VALUES
    ('artisan-bread',  'Artisan Bread',    '/menu-art/artisan-bread.jpg', '/menu-art/photos/artisan-bread.webp',  'A rustic artisan loaf, sliced to show its open crumb and crackly crust'),
    ('bagels-6-pack',  'Bagels (6 pack)',  '/menu-art/bagels.jpg',        '/menu-art/photos/bagels-6-pack.webp',  'Six seeded everything bagels on a wooden board'),
    ('cookies-6-pack', 'Cookies (6 pack)', '/menu-art/cookies.jpg',       '/menu-art/photos/cookies-6-pack.webp', 'A golden chocolate chip cookie on a baking tray'),
    ('plain-focaccia', 'Plain Focaccia',   '/menu-art/focaccia.jpg',      '/menu-art/photos/plain-focaccia.webp', 'Two pieces of plain focaccia showing the airy, bubbly crumb')
)
UPDATE "ProductImage" AS image
SET "url" = photos.new_url, "alt" = photos.alt
FROM photos, "Product" AS product
WHERE image."productId" = product."id"
  AND (product."slug" = photos.slug OR product."name" = photos.name)
  AND image."url" = photos.old_url;
COMMIT;
