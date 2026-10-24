import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CheckoutForm } from "../components/CheckoutForm";
import {
  censusGeocoder, CENSUS_BENCHMARK, handleDeliveryQuote, haversineMiles, oneLineAddress, parseLatLng, publicQuote, quoteDelivery,
  type Geocoder, type LatLng
} from "../lib/delivery-distance";
import { DELIVERY_FEE_COPY, DISTANCE_NOT_VERIFIED_ADMIN_NOTE, feeForDistance, OUT_OF_RANGE_MESSAGE, UNVERIFIED_DELIVERY_MESSAGE } from "../lib/delivery-pricing";

// Made-up coordinates in the middle of the Atlantic. Not the bakery.
const ORIGIN: LatLng = { lat: 10.123456, lng: -30.654321 };
const MILES_PER_DEG_LAT = (2 * Math.PI * 3958.7613) / 360;
const north = (miles: number): LatLng => ({ lat: ORIGIN.lat + miles / MILES_PER_DEG_LAT, lng: ORIGIN.lng });
const geocodeTo = (point: LatLng | null): Geocoder => async () => point;
const deps = (point: LatLng | null) => ({ origin: ORIGIN, geocode: geocodeTo(point) });

test("haversine helper matches the synthetic offsets", () => {
  for (const miles of [0.5, 2, 3.5]) assert.ok(Math.abs(haversineMiles(ORIGIN, north(miles)) - miles) < 1e-6);
});

test("tier boundaries: <=1 free, >1..<=3 is $6, >3 is refused", () => {
  assert.equal(feeForDistance(0), 0);
  assert.equal(feeForDistance(1), 0);
  assert.equal(feeForDistance(1.0001), 600);
  assert.equal(feeForDistance(3), 600);
  assert.equal(feeForDistance(3.0001), null);
  assert.equal(feeForDistance(Number.NaN), null);
});

test("0.5 mi is free", async () => {
  const quote = await quoteDelivery("1 Test St", "00000", deps(north(0.5)));
  assert.equal(quote.feeCents, 0); assert.equal(quote.inRange, true); assert.equal(quote.verified, true);
});

test("2 mi is $6", async () => {
  const quote = await quoteDelivery("1 Test St", "00000", deps(north(2)));
  assert.equal(quote.feeCents, 600); assert.equal(quote.inRange, true); assert.equal(quote.verified, true);
});

test("3.5 mi is blocked with the exact message", async () => {
  const quote = await quoteDelivery("1 Test St", "00000", deps(north(3.5)));
  assert.equal(quote.feeCents, null); assert.equal(quote.inRange, false);
  assert.equal(quote.message, "Sorry, we only deliver within 3 miles \u2014 pickup is available.");
  assert.equal(OUT_OF_RANGE_MESSAGE, quote.message);
});

test("geocode failure (no match, throw, or missing origin) is $6, proceeds, and is flagged unverified", async () => {
  for (const d of [deps(null), { origin: ORIGIN, geocode: async () => { throw new Error("boom"); } }, { origin: null, geocode: geocodeTo(north(0.5)) }]) {
    const quote = await quoteDelivery("asdf qwerty", "00000", d);
    assert.equal(quote.feeCents, 600); assert.equal(quote.inRange, true); assert.equal(quote.verified, false);
    assert.equal(quote.distanceMiles, null); assert.equal(quote.message, UNVERIFIED_DELIVERY_MESSAGE);
  }
  assert.equal(DISTANCE_NOT_VERIFIED_ADMIN_NOTE, "Distance not verified \u2014 check address");
});

test("census geocoder uses the free onelineaddress endpoint, parses x/y, and fails closed on timeout", async () => {
  let seen = "";
  const ok = censusGeocoder((async (url: string) => { seen = url; return new Response(JSON.stringify({ result: { addressMatches: [{ coordinates: { x: -30.5, y: 10.5 } }] } })); }) as typeof fetch);
  assert.deepEqual(await ok("1 Test St, 00000"), { lat: 10.5, lng: -30.5 });
  assert.match(seen, /^https:\/\/geocoding\.geo\.census\.gov\/geocoder\/locations\/onelineaddress\?/);
  assert.match(seen, new RegExp(`benchmark=${CENSUS_BENCHMARK}`)); assert.equal(CENSUS_BENCHMARK, "Public_AR_Current");
  assert.doesNotMatch(seen, /key=|api_key|token/i);
  const none = censusGeocoder((async () => new Response(JSON.stringify({ result: { addressMatches: [] } }))) as typeof fetch);
  assert.equal(await none("nonsense"), null);
  const slow = censusGeocoder(((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))))) as typeof fetch, 20);
  const keepAlive = setTimeout(() => undefined, 5000); // AbortSignal.timeout timers do not hold the event loop open
  try { assert.equal(await slow("slow"), null); } finally { clearTimeout(keepAlive); }
  assert.equal(oneLineAddress("1 Test St\nApt 2", " 00000 "), "1 Test St, Apt 2, 00000");
});

test("quote API body never includes the distance or the origin", async () => {
  const originText = [String(ORIGIN.lat), String(ORIGIN.lng), ORIGIN.lat.toFixed(4), ORIGIN.lng.toFixed(4)];
  for (const point of [north(0.5), north(2), north(3.5), null]) {
    const result = await handleDeliveryQuote({ deliveryAddress: "1 Test St", deliveryZip: "00000" }, deps(point));
    assert.equal(result.status, 200);
    assert.deepEqual(Object.keys(result.body).sort(), ["feeCents", "inRange", "message"]);
    const json = JSON.stringify(result.body);
    for (const text of originText) assert.ok(!json.includes(text), "origin leaked");
    assert.doesNotMatch(json, /distance|miles?"|lat|lng|origin/i);
    if (point) { const miles = haversineMiles(ORIGIN, point); for (const text of [String(miles), miles.toFixed(1), miles.toFixed(2)]) assert.ok(!json.includes(text), "distance leaked"); }
  }
  const internal = await quoteDelivery("1 Test St", "00000", deps(north(2)));
  assert.deepEqual(Object.keys(publicQuote(internal)).sort(), ["feeCents", "inRange", "message"]);
  assert.equal((await handleDeliveryQuote({ deliveryAddress: "", deliveryZip: "1" }, deps(north(1)))).status, 400);
});

test("origin parsing, server-only env name, and no origin in shipped source", () => {
  assert.deepEqual(parseLatLng(" 10.5, -30.25 "), { lat: 10.5, lng: -30.25 });
  for (const bad of [undefined, "", "abc", "1,2,3", "91,0"]) assert.equal(parseLatLng(bad), null);
  const server = readFileSync(new URL("../lib/delivery-distance.ts", import.meta.url), "utf8");
  assert.match(server, /env\.KL_ORIGIN_LATLNG/);
  for (const file of ["../lib/delivery-distance.ts", "../lib/delivery-pricing.ts", "../components/CheckoutForm.tsx", "../app/api/delivery-quote/route.ts", "../app/api/checkout/route.ts"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(source, /NEXT_PUBLIC_KL_ORIGIN/);
    assert.doesNotMatch(source, /\b4\d\.\d{3,}\s*,\s*-7\d\.\d{3,}/, `${file} contains hard-coded NYC coordinates`);
  }
  const client = readFileSync(new URL("../components/CheckoutForm.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(client, /delivery-distance|KL_ORIGIN/);
  const checkout = readFileSync(new URL("../app/api/checkout/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(checkout, /NextResponse\.json\([^)]*distance/i);
});

test("checkout shows the delivery copy and has no ZIP-zone picker", () => {
  assert.equal(DELIVERY_FEE_COPY, "Free delivery within 1 mile, $6 up to 3 miles.");
  const source = readFileSync(new URL("../components/CheckoutForm.tsx", import.meta.url), "utf8");
  assert.match(source, /DELIVERY_FEE_COPY/);
  assert.doesNotMatch(source, /deliveryZoneId|checkout-zone/);
  const html = renderToStaticMarkup(createElement(CheckoutForm, { pickupLocations: [] }));
  assert.match(html, /Free delivery within 1 mile, \$6 up to 3 miles\./);
});

test("distance migration is additive only", () => {
  const sql = readFileSync(new URL("../prisma/migrations/20261024003000_delivery_distance_flag/migration.sql", import.meta.url), "utf8");
  assert.match(sql, /ADD COLUMN IF NOT EXISTS "deliveryDistanceMiles" DOUBLE PRECISION;/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS "deliveryDistanceVerified" BOOLEAN;/);
  assert.doesNotMatch(sql, /DROP|DELETE|UPDATE|NOT NULL|RENAME|ALTER COLUMN/i);
  const prismaSource = readFileSync(new URL("../lib/prisma.ts", import.meta.url), "utf8");
  assert.match(prismaSource, /omit: \{ order: \{ deliveryDistanceMiles: true, deliveryDistanceVerified: true \} \}/);
});
