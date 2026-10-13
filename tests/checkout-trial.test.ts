import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createTrialOrder, transitionTrial } from "../lib/checkout-trial";
const customer = { customerName: "Test Baker", customerEmail: "test@example.invalid", fulfillmentType: "PICKUP" };
const start = () => createTrialOrder(customer, "test-loaf", 2, 0);
test("trial shares checkout validation and calculates synthetic totals", () => {
  assert.equal(start().totalCents, 2400);
  assert.throws(() => createTrialOrder({ ...customer, customerEmail: "bad" }, "test-loaf", 1, 0));
  for (const n of [0, -1, 6, 1.5, NaN]) assert.throws(() => createTrialOrder(customer, "test-loaf", n, 0));
  assert.throws(() => createTrialOrder(customer, "live-product", 1, 0));
  const delivery = { ...customer, fulfillmentType: "DELIVERY", deliveryAddress: "123 Test Lane", deliveryZip: "00000" };
  assert.equal(createTrialOrder(delivery, "test-rolls", 2, 0).totalCents, 4100);
  assert.throws(() => createTrialOrder({ ...delivery, deliveryZip: "90210" }, "test-loaf", 1, 0));
});
test("claim never pays and verification requires exact full amount", () => {
  const claimed = transitionTrial(start(), "claim", 1);
  assert.equal(claimed.status, "PENDING"); assert.equal(claimed.payment, "REVIEW_REQUESTED");
  assert.equal(transitionTrial(claimed, "claim", 2), claimed);
  assert.throws(() => transitionTrial(claimed, "advance", 2), /independently verified/);
  for (const amount of [0, 2399, 2401, NaN]) assert.throws(() => transitionTrial(claimed, "verify", 2, amount));
  const paid = transitionTrial(claimed, "verify", 2, 2400);
  assert.equal(paid.status, "PAID"); assert.equal(paid.payment, "VERIFIED");
  assert.throws(() => transitionTrial(paid, "cancel", 3));
  assert.throws(() => transitionTrial(paid, "expire", 3));
});
test("pickup and delivery fulfillment enforce their own paths", () => {
  for (const fulfillmentType of ["PICKUP", "DELIVERY"]) {
    let order = createTrialOrder({ ...customer, fulfillmentType, deliveryAddress: "Test Lane", deliveryZip: "00000" }, "test-loaf", 1, 0);
    order = transitionTrial(order, "verify", 1, order.totalCents);
    for (const expected of ["PREPARING", "READY", ...(fulfillmentType === "DELIVERY" ? ["OUT_FOR_DELIVERY"] : []), "COMPLETED"]) { order = transitionTrial(order, "advance", 2); assert.equal(order.status, expected); }
    assert.throws(() => transitionTrial(order, "advance", 3));
  }
});
test("cancel, forced expiry and actual deadline are terminal", () => {
  assert.equal(transitionTrial(start(), "cancel", 1).status, "CANCELLED");
  assert.equal(transitionTrial(start(), "expire", 1).status, "EXPIRED");
  const expired = transitionTrial(start(), "verify", 30 * 60000, 2400);
  assert.equal(expired.status, "EXPIRED"); assert.equal(expired.payment, "UNVERIFIED");
  for (const action of ["claim", "verify", "advance", "cancel"] as const) assert.throws(() => transitionTrial(expired, action, 30 * 60000 + 1, 2400));
  assert.equal(start().history.length, 1);
});
test("trial has server admin gate and no live action or persistence dependencies", () => {
  const page = readFileSync("app/admin/test-checkout/page.tsx", "utf8");
  assert.match(page, /await requireAdmin\(\)/);
  for (const file of ["lib/checkout-trial.ts", "components/CheckoutTrial.tsx"]) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, /fetch\(|XMLHttpRequest|sendBeacon|localStorage|sessionStorage|\/api\/|venmo\.com|prisma|manual-payments|checkout-recovery|queueEmail|server action|use server/);
    for (const match of source.matchAll(/from ["']([^"']+)["']/g)) assert.ok(["./validation", "react", "@/lib/checkout-trial", "@/lib/money"].includes(match[1]), `Unexpected trial dependency: ${match[1]}`);
  }
});

test("trial cannot natively submit personal fields without JavaScript", () => {
  const source = readFileSync("components/CheckoutTrial.tsx", "utf8");
  assert.doesNotMatch(source, /<form\b|formAction=|type="submit"/);
  assert.match(source, /type="button"[^>]+onClick=\{placeTestOrder\}/);
  assert.match(source, /field\.reportValidity\(\)/);
  assert.match(source, /Browser Back may restore this temporary screen/);
});
