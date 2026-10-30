import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { getMenuArtwork } from "../lib/menu-artwork";
import { MENU_ILLUSTRATIONS, MENU_IMAGE_OPTIONS, MENU_PHOTOS, menuImageAlt } from "../lib/menu-images";

const root = path.resolve(__dirname, "..");
const publicFile = (url: string) => path.join(root, "public", url);
const menu = JSON.parse(readFileSync(path.join(root, "prisma", "preview-menu.json"), "utf8")) as {
  products: { slug: string; name: string; priceCents: number; image: string; imageAlt?: string }[];
};
const withoutComments = (sql: string) => sql.replace(/--[^\n]*/g, "");
const goLive = withoutComments(readFileSync(path.join(root, "scripts", "menu-photos-2026-10-29.sql"), "utf8"));
const rollback = withoutComments(readFileSync(path.join(root, "scripts", "menu-photos-2026-10-29.rollback.sql"), "utf8"));
const swaps = [
  { slug: "artisan-bread", name: "Artisan Bread", old: "/menu-art/artisan-bread.jpg" },
  { slug: "bagels-6-pack", name: "Bagels (6 pack)", old: "/menu-art/bagels.jpg" },
  { slug: "cookies-6-pack", name: "Cookies (6 pack)", old: "/menu-art/cookies.jpg" },
  { slug: "plain-focaccia", name: "Plain Focaccia", old: "/menu-art/focaccia.jpg" }
];

/** RIFF chunk names and pixel size of a lossy WebP. */
function webpInfo(file: string) {
  const data = readFileSync(file);
  assert.equal(data.toString("latin1", 0, 4), "RIFF");
  assert.equal(data.toString("latin1", 8, 12), "WEBP");
  const chunks: string[] = [];
  for (let at = 12; at + 8 <= data.length; ) {
    const size = data.readUInt32LE(at + 4);
    chunks.push(data.toString("latin1", at, at + 4));
    at += 8 + size + (size & 1);
  }
  const vp8 = data.indexOf("VP8 ", 12, "latin1");
  const width = data.readUInt16LE(vp8 + 14) & 0x3fff;
  const height = data.readUInt16LE(vp8 + 16) & 0x3fff;
  return { chunks, width, height };
}

test("every image an admin can pick exists in public/", () => {
  assert.equal(MENU_IMAGE_OPTIONS.length, MENU_PHOTOS.length + MENU_ILLUSTRATIONS.length);
  assert.equal(new Set(MENU_IMAGE_OPTIONS.map(option => option.value)).size, MENU_IMAGE_OPTIONS.length);
  for (const option of MENU_IMAGE_OPTIONS) assert.ok(existsSync(publicFile(option.value)), option.value);
});

test("photos live at new paths and are shown as photos; illustrations keep their zoom", () => {
  for (const photo of MENU_PHOTOS) {
    assert.match(photo.value, /^\/menu-art\/photos\/[a-z0-9-]+\.webp$/);
    assert.equal(getMenuArtwork(photo.value), undefined, photo.value);
    assert.ok(photo.alt.length > 20, `${photo.value} needs descriptive alt text`);
  }
  for (const art of MENU_ILLUSTRATIONS) assert.notEqual(getMenuArtwork(art.value), undefined, art.value);
});

test("photos are 1800x1200 WebP with no EXIF, XMP or ICC metadata", () => {
  for (const photo of MENU_PHOTOS) {
    const info = webpInfo(publicFile(photo.value));
    assert.deepEqual(info.chunks, ["VP8 "], photo.value);
    assert.deepEqual([info.width, info.height], [1800, 1200], photo.value);
  }
});

test("preview menu keeps the real names and prices and uses the photos; Herbal Focaccia keeps its illustration", () => {
  assert.deepEqual(menu.products.map(p => [p.slug, p.name, p.priceCents]), [
    ["artisan-bread", "Artisan Bread", 1200],
    ["bagels-6-pack", "Bagels (6 pack)", 800],
    ["cookies-6-pack", "Cookies (6 pack)", 600],
    ["herbal-focaccia", "Herbal Focaccia", 1050],
    ["plain-focaccia", "Plain Focaccia", 1000]
  ]);
  for (const swap of swaps) {
    const product = menu.products.find(p => p.slug === swap.slug)!;
    assert.equal(product.image, `/menu-art/photos/${swap.slug}.webp`);
    assert.equal(product.imageAlt, menuImageAlt(product.image, product.name));
  }
  assert.equal(menu.products.find(p => p.slug === "herbal-focaccia")!.image, "/menu-art/herb-focaccia.jpg");
});

test("go-live and rollback SQL swap exactly these four images and nothing else", () => {
  for (const sql of [goLive, rollback]) {
    assert.doesNotMatch(sql, /\b(DELETE|INSERT|DROP|TRUNCATE|ALTER)\b/i);
    assert.equal((sql.match(/\bUPDATE\b/g) ?? []).length, 1);
    assert.doesNotMatch(sql, /herb/i);
    for (const swap of swaps) {
      const row = new RegExp(`'${swap.slug}',\\s*'${swap.name.replace(/[()]/g, "\\$&")}',\\s*'${swap.old}',\\s*'/menu-art/photos/${swap.slug}\\.webp'`);
      assert.match(sql, row, swap.slug);
    }
  }
  assert.match(goLive, /SET "url" = photos\.new_url/);
  assert.match(goLive, /image\."url" = photos\.old_url/);
  assert.match(rollback, /SET "url" = photos\.old_url/);
  assert.match(rollback, /image\."url" = photos\.new_url/);
  for (const photo of MENU_PHOTOS) assert.ok(goLive.includes(`'${photo.alt}'`), photo.value);
});

test("stored alt text describes a picked photo, otherwise the product name", () => {
  assert.equal(menuImageAlt("/menu-art/photos/bagels-6-pack.webp", "Bagels (6 pack)"), "Six seeded everything bagels on a wooden board");
  assert.equal(menuImageAlt("/menu-art/photos/bagels-6-pack.webp?v=2", "Bagels (6 pack)"), "Six seeded everything bagels on a wooden board");
  for (const url of ["/menu-art/bagels.jpg", "https://example.com/x.jpg", "", null, undefined]) assert.equal(menuImageAlt(url, "Bagels (6 pack)"), "Bagels (6 pack)");
});
