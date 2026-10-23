import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import robots from "../app/robots";
import sitemap from "../app/sitemap";
import { CloudflareAnalytics } from "../components/CloudflareAnalytics";
import { cloudflareAnalyticsToken } from "../lib/cloudflare-analytics";
import { bakeryJsonLd } from "../lib/site";

function withToken(t: test.TestContext, value: string | undefined) {
  const previous = process.env.NEXT_PUBLIC_CF_ANALYTICS_TOKEN;
  if (value === undefined) delete process.env.NEXT_PUBLIC_CF_ANALYTICS_TOKEN; else process.env.NEXT_PUBLIC_CF_ANALYTICS_TOKEN = value;
  t.after(() => { if (previous === undefined) delete process.env.NEXT_PUBLIC_CF_ANALYTICS_TOKEN; else process.env.NEXT_PUBLIC_CF_ANALYTICS_TOKEN = previous; });
}

test("Cloudflare beacon renders nothing without a site token", (t) => {
  withToken(t, undefined);
  assert.equal(renderToStaticMarkup(createElement(CloudflareAnalytics)), "");
  withToken(t, "  ");
  assert.equal(renderToStaticMarkup(createElement(CloudflareAnalytics)), "");
});

test("Cloudflare beacon rejects malformed tokens", () => {
  assert.equal(cloudflareAnalyticsToken("abc\"><script>"), null);
  assert.equal(cloudflareAnalyticsToken("short"), null);
});

test("Cloudflare beacon renders the cookieless snippet with a configured token", (t) => {
  withToken(t, "0123456789abcdef0123456789abcdef");
  const html = renderToStaticMarkup(createElement(CloudflareAnalytics));
  assert.match(html, /src="https:\/\/static\.cloudflareinsights\.com\/beacon\.min\.js"/);
  assert.match(html, /data-cf-beacon="\{&quot;token&quot;:&quot;0123456789abcdef0123456789abcdef&quot;\}"/);
  assert.match(html, /defer/);
});

test("robots.txt keeps private areas out and points at the sitemap", () => {
  const result = robots();
  const rule = Array.isArray(result.rules) ? result.rules[0] : result.rules;
  for (const path of ["/admin", "/account", "/api/"]) assert.ok([rule.disallow].flat().includes(path), path);
  assert.equal(result.sitemap, "https://kneadedloaves.com/sitemap.xml");
});

test("sitemap lists public pages only", () => {
  const urls = sitemap().map((entry) => entry.url);
  assert.deepEqual(urls, ["https://kneadedloaves.com/", "https://kneadedloaves.com/contact"]);
  assert.ok(urls.every((url) => !/\/(admin|account|orders|api)/.test(url)));
});

test("Bakery JSON-LD uses only public facts", () => {
  const data = bakeryJsonLd();
  assert.equal(data["@type"], "Bakery");
  assert.equal(data.email, "kneadedloaves@gmail.com");
  assert.deepEqual(data.sameAs, ["https://www.instagram.com/kneadedloaves/"]);
  assert.equal(data.address.postalCode, "11217");
  assert.ok(!("streetAddress" in data.address));
  assert.ok(!("openingHours" in data) && !("priceRange" in data) && !("telephone" in data));
});
