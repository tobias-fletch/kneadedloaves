import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CheckoutForm } from "../components/CheckoutForm";
import { describePickup, PICKUP_AREA } from "../lib/pickup-location";

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

test("checkout shows the cross streets and keeps the handoff note", () => {
  const html = renderToStaticMarkup(createElement(CheckoutForm, {
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
