import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import robots from "../app/robots";
import sitemap from "../app/sitemap";
import { CloudflareAnalytics } from "../components/CloudflareAnalytics";
import { CF_ANALYTICS_SITE_TOKEN, SEARCH_CONSOLE_VERIFICATION, SEARCH_CONSOLE_VERIFICATION_2, siteVerificationsForHead, beaconTokenForPage, cloudflareAnalyticsToken, googleSiteVerification, siteVerificationForHead } from "../lib/cloudflare-analytics";
import { bakeryJsonLd } from "../lib/site";

function withToken(t: test.TestContext, value: string | undefined) {
  const previous = process.env.NEXT_PUBLIC_CF_ANALYTICS_TOKEN;
  if (value === undefined) delete process.env.NEXT_PUBLIC_CF_ANALYTICS_TOKEN; else process.env.NEXT_PUBLIC_CF_ANALYTICS_TOKEN = value;
  t.after(() => { if (previous === undefined) delete process.env.NEXT_PUBLIC_CF_ANALYTICS_TOKEN; else process.env.NEXT_PUBLIC_CF_ANALYTICS_TOKEN = previous; });
}

test("Cloudflare beacon uses the committed kneadedloaves.com token when no env override is set", (t) => {
  assert.equal(CF_ANALYTICS_SITE_TOKEN, "447634b9537041c28cc36f327332db2f");
  for (const value of [undefined, "  "]) {
    withToken(t, value);
    const html = renderToStaticMarkup(createElement(CloudflareAnalytics));
    assert.match(html, /data-cf-beacon="\{&quot;token&quot;:&quot;447634b9537041c28cc36f327332db2f&quot;\}"/);
  }
  assert.equal(beaconTokenForPage("abc\"><script>"), null);
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

test("Search Console verification value is optional and validated", () => {
  assert.equal(googleSiteVerification(undefined), null);
  assert.equal(googleSiteVerification(""), null);
  assert.equal(googleSiteVerification('x" onload="y'), null);
  assert.equal(googleSiteVerification("AbC-123_xyzAbC-123_xyz"), "AbC-123_xyzAbC-123_xyz");
});

test("the kneadedloaves.com Search Console value renders in the head by default", () => {
  assert.equal(SEARCH_CONSOLE_VERIFICATION, "xnKInryqMG81gSlWH-MzzMaTYBqfPKOE4cm5utQ7b8s");
  assert.equal(siteVerificationForHead(undefined), SEARCH_CONSOLE_VERIFICATION);
  assert.equal(siteVerificationForHead("  "), SEARCH_CONSOLE_VERIFICATION);
  assert.equal(siteVerificationForHead("AbC-123_xyzAbC-123_xyz"), "AbC-123_xyzAbC-123_xyz");
});

test("both Search Console verification values render in the head, first one always kept", () => {
  assert.equal(SEARCH_CONSOLE_VERIFICATION_2, "IhNDXp7OQ2PCK8gVL70hcML-4--CL8tdTrDct3SCR-Q");
  assert.deepEqual(siteVerificationsForHead(undefined), [SEARCH_CONSOLE_VERIFICATION, SEARCH_CONSOLE_VERIFICATION_2]);
  assert.deepEqual(siteVerificationsForHead("AbC-123_xyzAbC-123_xyz"), [SEARCH_CONSOLE_VERIFICATION, "AbC-123_xyzAbC-123_xyz", SEARCH_CONSOLE_VERIFICATION_2]);
  assert.deepEqual(siteVerificationsForHead('x" onload="y'), [SEARCH_CONSOLE_VERIFICATION, SEARCH_CONSOLE_VERIFICATION_2]);
});

test("contact page has its own title, description and share tags", async () => {
  const { metadata } = await import("../app/contact/page");
  assert.equal(metadata.title, "Contact | Kneaded Loaves");
  assert.match(String(metadata.description), /Send Kneaded Loaves a message/);
  assert.equal((metadata.openGraph as { title?: string }).title, "Contact | Kneaded Loaves");
  assert.equal((metadata.openGraph as { description?: string }).description, metadata.description);
  assert.equal((metadata.twitter as { title?: string }).title, "Contact | Kneaded Loaves");
  assert.equal((metadata.twitter as { description?: string }).description, metadata.description);
  assert.match(JSON.stringify(metadata.openGraph), /opengraph-image\.png/);
  assert.match(JSON.stringify(metadata.twitter), /twitter-image\.png/);
  assert.doesNotMatch(JSON.stringify(metadata), /mailto:/);
});
