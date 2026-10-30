import assert from "node:assert/strict";
import test from "node:test";
import { getMenuArtwork } from "../lib/menu-artwork";

test("bundled food artwork uses the loaf as a consistent visual reference", () => {
  assert.equal(getMenuArtwork("/menu-art/artisan-bread.jpg")?.scale, 1);
  assert.equal(getMenuArtwork("/menu-art/bagels.jpg")?.scale, 0.72);
  assert.equal(getMenuArtwork("/menu-art/cookies.jpg")?.scale, 1.5);
  assert.equal(getMenuArtwork("/menu-art/herb-focaccia.jpg")?.scale, 1.9);
  assert.equal(getMenuArtwork("/menu-art/focaccia.jpg")?.scale, 1.42);
});

test("cache-busting does not change a bundled asset's scale", () => {
  assert.equal(getMenuArtwork("/menu-art/bagels.jpg?v=2#image")?.scale, 0.72);
});

test("custom and unknown images retain the existing image treatment", () => {
  for (const src of ["/uploads/bagels.jpg", "https://example.com/menu-art/bagels.jpg", "/menu-art/unknown.jpg", "toString", "__proto__", ""]) {
    assert.equal(getMenuArtwork(src), undefined);
  }
});

test("real menu photos are not zoomed or cream-backed", () => {
  for (const slug of ["plain-focaccia", "cookies-6-pack", "bagels-6-pack", "artisan-bread"]) {
    assert.equal(getMenuArtwork(`/menu-art/photos/${slug}.webp`), undefined);
  }
});
