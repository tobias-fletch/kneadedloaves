import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GlutenFreeNote } from "../components/GlutenFreeNote";
import { BAKERY_CONTACT_EMAIL, GLUTEN_FREE_ON_REQUEST_NOTE } from "../lib/config-messages";

test("menu gluten-free note includes the cross-contact sentence and the public email", () => {
  const html = renderToStaticMarkup(createElement(GlutenFreeNote, { email: BAKERY_CONTACT_EMAIL }));
  const apostrophe = "(?:'|&#x27;)";
  assert.match(html, new RegExp(`Need it gluten-free\\? Any item on our menu can be made gluten-free on request\\. Made in a kitchen that also handles wheat, so we can${apostrophe}t guarantee it${apostrophe}s free of cross-contact\\. Just email us at `));
  assert.match(html, new RegExp(`mailto:${BAKERY_CONTACT_EMAIL.replace(".", "\\.")}`));
  assert.equal(GLUTEN_FREE_ON_REQUEST_NOTE, "Need it gluten-free? Any item on our menu can be made gluten-free on request. Made in a kitchen that also handles wheat, so we can't guarantee it's free of cross-contact. Just email us");
  assert.doesNotMatch(html, /celiac|certified|100%/i);
});

test("the gluten-free note is only on the homepage menu", () => {
  const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  const shop = page.slice(page.indexOf('id="shop"'));
  assert.equal(shop.match(/<GlutenFreeNote /g)?.length, 1);
  assert.equal(page.slice(0, page.indexOf('id="shop"')).includes("<GlutenFreeNote "), false);
});
