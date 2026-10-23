import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CheckoutForm } from "../components/CheckoutForm";
import { describePickup, PICKUP_AREA } from "../lib/pickup-location";
import { getOrderEmailTemplates } from "../lib/email";
import { prisma } from "../lib/prisma";
import type { TestContext } from "node:test";

function stub(t: TestContext, target: object, key: string, implementation: (...args: unknown[]) => unknown) {
  const original = Reflect.get(target, key);
  Reflect.set(target, key, implementation);
  t.after(() => { Reflect.set(target, key, original); });
}

test("pickup text uses the S Portland and Atlantic cross streets", () => {
  assert.equal(PICKUP_AREA, "S Portland Ave & Atlantic Ave, Brooklyn, NY 11217");
  assert.equal(describePickup({ name: "Brooklyn pickup", address: "Brooklyn, NY 11217" }).text, `Brooklyn pickup\n${PICKUP_AREA}`);
  assert.equal(describePickup({ name: "Bakery Studio Pickup", address: "123 Oven Lane, Brooklyn, NY" }).address, PICKUP_AREA);
  assert.equal(describePickup({ name: "Brooklyn pickup", address: PICKUP_AREA }).address, PICKUP_AREA);
  assert.equal(describePickup({ name: "Studio", address: "456 Real Street" }).address, `456 Real Street, ${PICKUP_AREA}`);
  assert.match(PICKUP_AREA, /S Portland Ave & Atlantic Ave/);
});

test("pickup migration is idempotent and does not rewrite orders", () => {
  const sql = readFileSync(new URL("../prisma/migrations/20261023170000_pickup_zip_11217/migration.sql", import.meta.url), "utf8");
  assert.match(sql, /123 Oven Lane/);
  assert.match(sql, /S Portland Ave & Atlantic Ave, Brooklyn, NY 11217/);
  assert.match(sql, /Brooklyn, NY 11217/);
  assert.match(sql, /The bakery confirms the handoff after payment is verified/);
  assert.match(sql, /NOT EXISTS \(SELECT 1 FROM "PickupLocation"\)/);
  assert.match(sql, /btrim\("address"\) ILIKE 'Brooklyn, NY 11217'/);
  assert.doesNotMatch(sql, /UPDATE "Order"|DELETE FROM "Order"|DROP TABLE|street address is not on file/);
});

test("default pickup email template includes the cross streets and the handoff note", async (t) => {
  for (const key of ["EMAIL_PICKUP_SUBJECT", "EMAIL_PICKUP_BODY", "EMAIL_DELIVERY_SUBJECT", "EMAIL_DELIVERY_BODY"]) {
    const before = process.env[key];
    delete process.env[key];
    t.after(() => { if (before === undefined) delete process.env[key]; else process.env[key] = before; });
  }
  stub(t, prisma.appConfig, "findMany", async () => []);
  const templates = await getOrderEmailTemplates();
  assert.match(templates.pickupBody, /S Portland Ave & Atlantic Ave, Brooklyn, NY 11217/);
  assert.match(templates.pickupBody, /confirms the exact handoff after payment/);
  assert.doesNotMatch(templates.pickupBody, /123 Oven Lane|example\.com|street address is not on file/);
});

test("checkout shows the cross streets and keeps the handoff note", () => {
  const html = renderToStaticMarkup(createElement(CheckoutForm, {
    deliveryZones: [],
    pickupLocations: [{
      id: "seed-pickup",
      name: "Brooklyn pickup",
      address: "Brooklyn, NY 11217",
      instructions: "Pickup is at S Portland Ave & Atlantic Ave, Brooklyn, NY 11217. The bakery confirms the handoff after payment is verified.",
      active: true,
      createdAt: new Date(),
      updatedAt: new Date()
    }]
  }));
  assert.match(html, /S Portland Ave &amp; Atlantic Ave, Brooklyn, NY 11217/);
  assert.match(html, /The bakery confirms the exact spot after payment/);
  assert.doesNotMatch(html, /123 Oven Lane|street address is not on file/);
});
