-- Rollback for scripts/menu-photos-2026-10-29.sql: put the four menu items back
-- on their illustrations. Only rows still showing the new photo are changed.
-- Alt text goes back to the product name, which is what the site stored before
-- (the live menu's alt text was the product name on 2026-10-29).
--
-- Run: npx prisma db execute --schema prisma/schema.prisma --file scripts/menu-photos-2026-10-29.rollback.sql
BEGIN;
WITH photos (slug, name, old_url, new_url) AS (
  VALUES
    ('artisan-bread',  'Artisan Bread',    '/menu-art/artisan-bread.jpg', '/menu-art/photos/artisan-bread.webp'),
    ('bagels-6-pack',  'Bagels (6 pack)',  '/menu-art/bagels.jpg',        '/menu-art/photos/bagels-6-pack.webp'),
    ('cookies-6-pack', 'Cookies (6 pack)', '/menu-art/cookies.jpg',       '/menu-art/photos/cookies-6-pack.webp'),
    ('plain-focaccia', 'Plain Focaccia',   '/menu-art/focaccia.jpg',      '/menu-art/photos/plain-focaccia.webp')
)
UPDATE "ProductImage" AS image
SET "url" = photos.old_url, "alt" = product."name"
FROM photos, "Product" AS product
WHERE image."productId" = product."id"
  AND (product."slug" = photos.slug OR product."name" = photos.name)
  AND image."url" = photos.new_url;
COMMIT;
