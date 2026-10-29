import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import nextConfig from "../next.config";

test("/menu and /order redirect permanently to the home-page menu section", async () => {
  const redirects = await nextConfig.redirects!();
  for (const source of ["/menu", "/order"]) {
    const rule = redirects.find(r => r.source === source);
    assert.ok(rule, `${source} redirect exists`);
    assert.equal(rule.destination, "/#shop");
    assert.equal(rule.permanent, true);
  }
});

test("the home page still renders the #shop anchor the redirects target", () => {
  assert.match(readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8"), /id="shop"/);
});

test("in-page anchors clear the sticky header", () => {
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  const rule = /#shop,\s*#events,\s*#contact-form \{\s*scroll-margin-top: calc\(88px \+ min\(56\.08px, \(100vw - 2rem\) \* 56\.08 \/ 370\) \+ 12px\);/;
  assert.match(css, rule);
  assert.match(css, /@media \(min-width: 640px\) \{[^]*?#shop,\s*#events,\s*#contact-form \{\s*scroll-margin-top: 96\.08px;/);
});
