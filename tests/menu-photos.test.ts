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

/** RIFF chunk names, pixel size and alpha of a WebP (lossy, lossless or extended). */
function webpInfo(file: string) {
  const data = readFileSync(file);
  assert.equal(data.toString("latin1", 0, 4), "RIFF");
  assert.equal(data.toString("latin1", 8, 12), "WEBP");
  const chunks: string[] = [];
  let width = 0;
  let height = 0;
  let alpha = false;
  for (let at = 12; at + 8 <= data.length; ) {
    const name = data.toString("latin1", at, at + 4);
    const size = data.readUInt32LE(at + 4);
    const body = at + 8;
    chunks.push(name);
    if (name === "VP8X") {
      alpha = (data[body] & 0x10) !== 0;
      width = data.readUIntLE(body + 4, 3) + 1;
      height = data.readUIntLE(body + 7, 3) + 1;
    } else if (name === "VP8 " && !width) {
      width = data.readUInt16LE(body + 6) & 0x3fff;
      height = data.readUInt16LE(body + 8) & 0x3fff;
    } else if (name === "VP8L" && !width) {
      const bits = data.readUInt32LE(body + 1);
      width = (bits & 0x3fff) + 1;
      height = ((bits >> 14) & 0x3fff) + 1;
      alpha = alpha || ((bits >> 28) & 1) === 1;
    }
    at += 8 + size + (size & 1);
  }
  return { chunks, width, height, alpha };
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

test("photos are WebP with no EXIF, XMP or ICC metadata, at the size the menu card expects", () => {
  for (const photo of MENU_PHOTOS) {
    const info = webpInfo(publicFile(photo.value));
    for (const chunk of info.chunks) assert.ok(["VP8 ", "VP8L", "VP8X", "ALPH"].includes(chunk), `${photo.value}: unexpected ${chunk} chunk`);
    assert.deepEqual([info.width, info.height], [photo.width, photo.height], photo.value);
    if (photo.fit === "cover") {
      assert.deepEqual([photo.width, photo.height], [1800, 1200], photo.value);
    } else {
      // Cut-outs keep their transparency and are big enough for a 2x phone screen.
      assert.ok(info.alpha, `${photo.value} should keep its transparent background`);
      assert.ok(Math.max(photo.width, photo.height) >= 800, photo.value);
    }
  }
});

test("cookies and bagels are single-item cut-outs shown whole; focaccia and bread are cropped photos", () => {
  const fit = Object.fromEntries(MENU_PHOTOS.map(photo => [photo.value.replace(/^.*\/|\.webp$/g, ""), photo.fit]));
  assert.deepEqual(fit, { "plain-focaccia": "cover", "artisan-bread": "cover", "bagels-6-pack": "contain", "cookies-6-pack": "contain" });
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
  const bagel = MENU_PHOTOS.find(photo => photo.value === "/menu-art/photos/bagels-6-pack.webp")!.alt;
  assert.equal(menuImageAlt("/menu-art/photos/bagels-6-pack.webp", "Bagels (6 pack)"), bagel);
  assert.equal(menuImageAlt("/menu-art/photos/bagels-6-pack.webp?v=2", "Bagels (6 pack)"), bagel);
  for (const url of ["/menu-art/bagels.jpg", "https://example.com/x.jpg", "", null, undefined]) assert.equal(menuImageAlt(url, "Bagels (6 pack)"), "Bagels (6 pack)");
});
