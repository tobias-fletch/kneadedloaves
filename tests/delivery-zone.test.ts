import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AlternateFulfillmentNote } from "../components/OrderingStatus";
import { ALTERNATE_FULFILLMENT_NOTE, BAKERY_CONTACT_EMAIL } from "../lib/config-messages";
import { deliveryCoverageError, DELIVERY_ONLY_11217_MESSAGE, DELIVERY_ZONE_INACTIVE_MESSAGE } from "../lib/delivery-zone";

test("delivery outside 11217 is rejected and an inactive empty zone is not a catch-all", () => {
  assert.equal(deliveryCoverageError({ active: true, zipCodes: ["11217"] }, "11217"), null);
  assert.equal(deliveryCoverageError({ active: true, zipCodes: ["11217"] }, "11231"), DELIVERY_ONLY_11217_MESSAGE);
  assert.equal(DELIVERY_ONLY_11217_MESSAGE, "Delivery is only available in ZIP 11217.");
  assert.equal(deliveryCoverageError({ active: false, zipCodes: [] }, "10001"), DELIVERY_ZONE_INACTIVE_MESSAGE);
  assert.equal(deliveryCoverageError({ active: false, zipCodes: [] }, "11217"), DELIVERY_ZONE_INACTIVE_MESSAGE);
  assert.equal(deliveryCoverageError(null, "11217"), DELIVERY_ZONE_INACTIVE_MESSAGE);
  assert.equal(deliveryCoverageError({ active: true, zipCodes: [] }, "10001"), null);
});

test("free delivery migration keeps other zones and does not rewrite orders", () => {
  const sql = readFileSync(new URL("../prisma/migrations/20261023210000_free_delivery_11217/migration.sql", import.meta.url), "utf8");
  assert.match(sql, /dz-nearby-free/);
  assert.match(sql, /ARRAY\['11217'\]/);
  assert.match(sql, /"feeCents" = 0/);
  assert.match(sql, /Free delivery in 11217/);
  assert.match(sql, /dz-brooklyn-7/);
  assert.match(sql, /dz-elsewhere-7/);
  assert.match(sql, /"active" = false/);
  assert.match(sql, /IS DISTINCT FROM/);
  assert.doesNotMatch(sql, /DELETE FROM "DeliveryZone"|UPDATE "Order"|DROP TABLE/);
  const seed = readFileSync(new URL("../prisma/seed.ts", import.meta.url), "utf8");
  assert.match(seed, /id: "dz-nearby-free"/);
  assert.match(seed, /zipCodes: \["11217"\]/);
  assert.match(seed, /feeCents: 0/);
  assert.doesNotMatch(seed, /11211", "11222", "11249"/);
});

test("alternate fulfillment note uses the weekday and the public email", () => {
  const html = renderToStaticMarkup(createElement(AlternateFulfillmentNote, { day: "Sunday", email: BAKERY_CONTACT_EMAIL }));
  assert.equal(ALTERNATE_FULFILLMENT_NOTE, "Can't make {day}? Email us to arrange another time.");
  assert.doesNotMatch(ALTERNATE_FULFILLMENT_NOTE, /Sunday/);
  assert.match(html, /Can(?:'|&#x27;)t make Sunday\? /);
  assert.match(html, /<a[^>]*href="\/contact"[^>]*>Email us<\/a> to arrange another time\./);
  assert.doesNotMatch(html, /mailto:/);
  const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  const fulfillment = page.indexOf("Fulfillment:");
  const note = page.indexOf("<AlternateFulfillmentNote ");
  assert.ok(fulfillment > 0 && note > fulfillment);
  assert.match(page, /formatEasternWeekday\(openWindow\.fulfillmentDate\)/);
  assert.equal(page.match(/<AlternateFulfillmentNote /g)?.length, 1);
});
