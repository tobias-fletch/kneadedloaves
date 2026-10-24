import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { paymentDeadline } from "../lib/order-rules";
import { summarizeOrders } from "../lib/admin-metrics";

const close = new Date("2026-10-25T01:00:00Z"); // Sat 9:00 PM ET
const fulfillment = new Date("2026-10-25T16:00:00Z"); // Sun noon ET

test("a late order keeps the full payment hold instead of expiring at the close", () => {
  const twoMinutesBeforeClose = new Date(close.getTime() - 2 * 60000);
  const due = paymentDeadline(twoMinutesBeforeClose, 30, { fulfillmentDate: fulfillment });
  assert.equal(due.getTime(), twoMinutesBeforeClose.getTime() + 30 * 60000);
  assert.ok(due > close);
});

test("the payment deadline never runs past the pickup/delivery start", () => {
  const now = new Date("2026-10-24T20:00:00Z");
  assert.equal(paymentDeadline(now, 10080, { fulfillmentDate: fulfillment }).getTime(), fulfillment.getTime());
  assert.equal(paymentDeadline(now, 60, { fulfillmentDate: null }).getTime(), now.getTime() + 3600000);
  // A window whose fulfillment already started (manual reopen) still gets the hold.
  assert.equal(paymentDeadline(new Date("2026-10-26T00:00:00Z"), 30, { fulfillmentDate: fulfillment }).getTime(), new Date("2026-10-26T00:30:00Z").getTime());
});

test("checkout uses the shared deadline rule, not the window close", () => {
  const route = readFileSync(new URL("../app/api/checkout/route.ts", import.meta.url), "utf8");
  assert.match(route, /paymentDeadline\(now, config\.holdMinutes, freshWindow\)/);
  assert.doesNotMatch(route, /closesAt\.getTime\(\)\)\)/);
});

test("overview revenue counts only verified, non-cancelled orders", () => {
  const summary = summarizeOrders([
    { status: "COMPLETED", paymentState: "VERIFIED", totalCents: 3000 },
    { status: "PENDING", paymentState: "UNPAID", totalCents: 1000 },
    { status: "PENDING", paymentState: "REVIEW", totalCents: 800 },
    { status: "CANCELLED", paymentState: "REFUNDED", totalCents: 1650 },
    { status: "CANCELLED", paymentState: "UNPAID", totalCents: 1000 }
  ]);
  assert.deepEqual(summary, { orders: 3, awaitingPayment: 2, needsReview: 1, verifiedCents: 3000 });
});

test("removed dead code stays removed and nothing posts to the missing upload route", () => {
  for (const file of ["components/AdminForm.tsx", "components/ProductManager.tsx"]) {
    assert.doesNotMatch(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"), /\/api\/admin\/uploads|imageFile/);
  }
});
