import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { describePickup, PICKUP_AREA } from "../lib/pickup-location";
import { getOrderEmailTemplates } from "../lib/email";
import { prisma } from "../lib/prisma";
import type { TestContext } from "node:test";

function stub(t: TestContext, target: object, key: string, implementation: (...args: unknown[]) => unknown) {
  const original = Reflect.get(target, key);
  Reflect.set(target, key, implementation);
  t.after(() => { Reflect.set(target, key, original); });
}

test("pickup text replaces the old street with ZIP 11217 and does not invent a street", () => {
  assert.equal(describePickup({ name: "Brooklyn pickup", address: "Brooklyn, NY 11217" }).text, "Brooklyn pickup\nBrooklyn, NY 11217");
  assert.equal(describePickup({ name: "Bakery Studio Pickup", address: "123 Oven Lane, Brooklyn, NY" }).address, PICKUP_AREA);
  assert.equal(describePickup({ name: "Studio", address: "456 Real Street" }).address, `456 Real Street, ${PICKUP_AREA}`);
  assert.equal(PICKUP_AREA, "Brooklyn, NY 11217");
  assert.doesNotMatch(PICKUP_AREA, /\d+ .*(Street|Lane|Avenue|Ave|Road)/);
});

test("pickup migration is idempotent and does not rewrite orders", () => {
  const sql = readFileSync(new URL("../prisma/migrations/20261023170000_pickup_zip_11217/migration.sql", import.meta.url), "utf8");
  assert.match(sql, /123 Oven Lane/);
  assert.match(sql, /Brooklyn, NY 11217/);
  assert.match(sql, /NOT EXISTS \(SELECT 1 FROM "PickupLocation"\)/);
  assert.doesNotMatch(sql, /UPDATE "Order"|DELETE FROM "Order"|DROP TABLE/);
});

test("default pickup email template includes 11217", async (t) => {
  for (const key of ["EMAIL_PICKUP_SUBJECT", "EMAIL_PICKUP_BODY", "EMAIL_DELIVERY_SUBJECT", "EMAIL_DELIVERY_BODY"]) {
    const before = process.env[key];
    delete process.env[key];
    t.after(() => { if (before === undefined) delete process.env[key]; else process.env[key] = before; });
  }
  stub(t, prisma.appConfig, "findMany", async () => []);
  const templates = await getOrderEmailTemplates();
  assert.match(templates.pickupBody, /11217/);
  assert.doesNotMatch(templates.pickupBody, /123 Oven Lane|example\.com/);
});
