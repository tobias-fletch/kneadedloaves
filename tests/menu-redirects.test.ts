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
