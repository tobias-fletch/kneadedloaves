import assert from "node:assert/strict";
import test from "node:test";
import nodemailer from "nodemailer";
import { emailDeliveryMessage } from "../lib/email-queue";
import { customerVisibleInstructions, DISTANCE_NOT_VERIFIED_ADMIN_NOTE, DISTANCE_NOT_VERIFIED_EMAIL_LINE, hasLegacyDistanceNote } from "../lib/delivery-pricing";
import type { DeliveryQuote } from "../lib/delivery-distance";
import { deliveryDistanceOrderFields } from "../lib/order-distance-columns";
import { renderOrderEmail, type OrderEmailDetails, type OrderEmailKind } from "../lib/order-email";

// Fake origin values: these must never appear in any rendered email.
const FAKE_ORIGIN = "40.1234567,-73.7654321";
const LEGACY_NOTE = `${DISTANCE_NOT_VERIFIED_ADMIN_NOTE}.`;
const FROM = "Kneaded Loaves <kneadedloaves@gmail.com>";

function delivery(overrides: Partial<OrderEmailDetails> = {}): OrderEmailDetails {
  return {
    customerName: "Maya Chen",
    customerEmail: "maya.chen@example.com",
    paymentReference: "KL-3F8A1C04-9B2E-4D77-A1C0-6E5D4C3B2A19",
    items: [{ productName: "Artisan Bread", quantity: 1, unitPriceCents: 1200 }],
    deliveryFeeCents: 600,
    totalCents: 1800,
    fulfillmentType: "DELIVERY",
    fulfillmentDate: new Date("2026-10-25T16:00:00.000Z"),
    deliveryAddress: "123 Nowhere Lane",
    deliveryZip: "11217",
    fulfillmentInstructions: null,
    paymentHandle: "@kneadedloaves",
    paymentDestination: "https://www.venmo.com/u/kneadedloaves",
    paymentDueAt: new Date("2026-10-25T01:00:00.000Z"),
    ...overrides
  };
}

/** Render, then hand the message to nodemailer's JSON transport (no network) and return what would be sent. */
async function sent(kind: OrderEmailKind, details: OrderEmailDetails) {
  const email = renderOrderEmail(kind, details);
  const transport = nodemailer.createTransport({ jsonTransport: true });
  const info = await transport.sendMail(emailDeliveryMessage({ id: `job-${kind}`, to: "someone@example.com", subject: email.subject, body: email.text, html: email.html }, FROM));
  const message = JSON.parse(String(info.message)) as { subject: string; text: string; html: string };
  return { ...message, all: `${message.subject}\n${message.text}\n${message.html}` };
}

function assertNoOrigin(all: string) {
  for (const part of FAKE_ORIGIN.split(",")) assert.ok(!all.includes(part), "origin coordinate leaked");
  assert.doesNotMatch(all, /KL_ORIGIN|latlng|latitude|longitude|miles? from/i);
}

const customerKinds: OrderEmailKind[] = ["customer-reservation", "payment-verified", "reservation-expired"];

test("admin new-order email shows the unverified-distance line when flagged", async () => {
  const email = await sent("admin-new-order", delivery({ distanceUnverified: true }));
  assert.match(email.text, /\n\nDELIVERY\n\n123 Nowhere Lane\n\nZIP 11217\n\nSunday, October 25\n\nDistance not verified, please check the address\.\n\n/);
  assert.ok(email.html.includes(DISTANCE_NOT_VERIFIED_EMAIL_LINE));
  assert.equal(email.text.split(DISTANCE_NOT_VERIFIED_EMAIL_LINE).length - 1, 1);
  assertNoOrigin(email.all);
});

test("admin new-order email has no distance line when the distance was verified or not flagged", async () => {
  for (const flag of [false, undefined]) {
    const email = await sent("admin-new-order", delivery({ distanceUnverified: flag }));
    assert.doesNotMatch(email.all, /Distance not verified/);
    assertNoOrigin(email.all);
  }
  const pickup = await sent("admin-new-order", delivery({ fulfillmentType: "PICKUP", pickupAddress: "S Portland Ave & Atlantic Ave", distanceUnverified: true }));
  assert.doesNotMatch(pickup.all, /Distance not verified/);
});

test("customer emails never carry the distance flag, even when flagged or with the legacy instructions note", async () => {
  for (const kind of customerKinds) {
    for (const overrides of [{ distanceUnverified: true }, { fulfillmentInstructions: LEGACY_NOTE }, { distanceUnverified: true, fulfillmentInstructions: `${LEGACY_NOTE}\nLeave with the doorman.` }]) {
      const email = await sent(kind, delivery(overrides));
      assert.doesNotMatch(email.all, /Distance not verified|check (the )?address/i, `${kind} ${JSON.stringify(overrides)}`);
      assertNoOrigin(email.all);
    }
  }
  const kept = await sent("customer-reservation", delivery({ fulfillmentInstructions: `${LEGACY_NOTE}\nLeave with the doorman.` }));
  assert.match(kept.text, /Leave with the doorman\./);
});

test("admin email turns the legacy instructions note into the single email line", async () => {
  const email = await sent("admin-new-order", delivery({ fulfillmentInstructions: LEGACY_NOTE }));
  assert.equal(email.text.split(DISTANCE_NOT_VERIFIED_EMAIL_LINE).length - 1, 1);
  assert.ok(!email.all.includes(DISTANCE_NOT_VERIFIED_ADMIN_NOTE));
});

test("checkout stores the flag only in the admin-only columns when they exist", () => {
  const failed: DeliveryQuote = { feeCents: 600, inRange: true, message: "x", verified: false, distanceMiles: null };
  const ok: DeliveryQuote = { feeCents: 0, inRange: true, message: "x", verified: true, distanceMiles: 0.4 };
  assert.deepEqual(deliveryDistanceOrderFields(true, failed, true), {
    unverifiedDistance: true, fulfillmentInstructions: undefined, columns: { deliveryDistanceMiles: null, deliveryDistanceVerified: false }
  });
  assert.deepEqual(deliveryDistanceOrderFields(true, ok, true), {
    unverifiedDistance: false, fulfillmentInstructions: undefined, columns: { deliveryDistanceMiles: 0.4, deliveryDistanceVerified: true }
  });
  // Unmigrated DB only: the note goes in the instructions for /admin, and customer surfaces strip it.
  const fallback = deliveryDistanceOrderFields(true, failed, false);
  assert.deepEqual(fallback, { unverifiedDistance: true, fulfillmentInstructions: LEGACY_NOTE, columns: {} });
  assert.equal(customerVisibleInstructions(fallback.fulfillmentInstructions), null);
  assert.equal(hasLegacyDistanceNote(fallback.fulfillmentInstructions), true);
  assert.deepEqual(deliveryDistanceOrderFields(false, null, true, "Ring twice"), { unverifiedDistance: false, fulfillmentInstructions: "Ring twice", columns: {} });
  assert.equal(customerVisibleInstructions("Ring twice"), "Ring twice");
});
