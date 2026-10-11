import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "crypto";
import Stripe from "stripe";
import type { Prisma } from "@prisma/client";
import { paymentReadiness } from "../lib/checkout-readiness";
import { assertPaymentMatches, dollarsToCents, hasReceiptAccess } from "../lib/payment-rules";
import { assertPayPalOrderMatches, confirmPayPalOrder } from "../lib/paypal-events";
import { confirmPayment, releaseReservation, recordRefund } from "../lib/payment-state";
import { priceOrder, pricingConfiguration } from "../lib/pricing";
import { readBody } from "../lib/request";

const ready = { TAX_RATE_BPS: "0", TAX_DELIVERY_FEE: "false", APP_URL: "https://shop.example", JWT_SECRET: "a".repeat(64), CHECKOUT_ENABLED: "true", OPERATIONS_CONFIRMED: "true", CHECKOUT_SMOKE_TESTED: "true", STRIPE_ENABLED: "true", STRIPE_TEST_MODE: "false", STRIPE_SECRET_KEY: "sk_live_fixture", STRIPE_WEBHOOK_SECRET: "whsec_fixture", PAYPAL_ENABLED: "true", PAYPAL_SANDBOX: "false", PAYPAL_CLIENT_ID: "fixture-client", PAYPAL_CLIENT_SECRET: "fixture-secret", PAYPAL_WEBHOOK_ID: "fixture-webhook" };
test("checkout fails closed without explicit operational, provider and live smoke readiness", () => {
  process.env.CONFIG_ENCRYPTION_KEY = "a".repeat(64);
  assert.deepEqual(paymentReadiness({}, true).providers, []);
  assert.deepEqual(paymentReadiness(ready, true).providers, ["STRIPE", "PAYPAL"]);
  for (const key of ["CHECKOUT_ENABLED", "OPERATIONS_CONFIRMED", "CHECKOUT_SMOKE_TESTED", "JWT_SECRET", "APP_URL", "TAX_RATE_BPS", "TAX_DELIVERY_FEE"]) assert.deepEqual(paymentReadiness({ ...ready, [key]: "" }, true).providers, []);
  for (const url of ["http://shop.example", "https://user:pass@shop.example", "https://shop.example/bad", "https://shop.example?bad=1", "javascript:alert(1)"]) assert.deepEqual(paymentReadiness({ ...ready, APP_URL: url }, true).providers, []);
  assert.deepEqual(paymentReadiness({ ...ready, STRIPE_TEST_MODE: "true", STRIPE_SECRET_KEY: "sk_test_fixture", PAYPAL_SANDBOX: "true" }, true).providers, []);
  assert.deepEqual(paymentReadiness({ ...ready, STRIPE_WEBHOOK_SECRET: "", PAYPAL_WEBHOOK_ID: "" }, true).providers, []);
});
test("money parsing is exact and provider order, total and currency must all match", () => {
  assert.equal(dollarsToCents("12.03"), 1203);
  for (const value of ["12.003", "1e2", "-1.00", 12, "12", "999999999999999999.99"]) assert.throws(() => dollarsToCents(value));
  const expected = { id: "order", totalCents: 1200 };
  assert.doesNotThrow(() => assertPaymentMatches(expected, { orderId: "order", amountCents: 1200, currency: "usd" }));
  for (const proof of [{ orderId: "other", amountCents: 1200, currency: "USD" }, { orderId: "order", amountCents: 12, currency: "USD" }, { orderId: "order", amountCents: 1200, currency: "EUR" }]) assert.throws(() => assertPaymentMatches(expected, proof));
});
test("receipt tokens require exact high-entropy hashes", () => {
  const token = "a".repeat(64), hash = createHash("sha256").update(token).digest("hex");
  assert.equal(hasReceiptAccess(token, hash), true);
  for (const value of ["", "b".repeat(64), token + "x", [token], null]) assert.equal(hasReceiptAccess(value, hash), false);
});
test("Stripe authenticates exact raw bytes and rejects stale, tampered or wrong-secret signatures", () => {
  const stripe = new Stripe("sk_test_fixture", { apiVersion: "2024-06-20" });
  const payload = JSON.stringify({ id: "evt_test", object: "event", type: "checkout.session.completed", data: { object: {} } });
  const secret = "whsec_fixture";
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret });
  assert.equal(stripe.webhooks.constructEvent(payload, signature, secret).id, "evt_test");
  assert.throws(() => stripe.webhooks.constructEvent(payload + " ", signature, secret));
  assert.throws(() => stripe.webhooks.constructEvent(payload, signature, "whsec_other"));
  assert.throws(() => stripe.webhooks.constructEvent(payload, stripe.webhooks.generateTestHeaderString({ payload, secret, timestamp: 1 }), secret));
});
test("webhook body streaming enforces its bound without trusting Content-Length", async () => {
  await assert.rejects(readBody(new Request("https://shop.example", { method: "POST", body: "x".repeat(101), headers: { "Content-Length": "1" } }), 100));
  assert.equal((await readBody(new Request("https://shop.example", { method: "POST", body: "{}" }), 100)).toString(), "{}");
});
function fakeTransaction() {
  const order = { id: "order", paymentProvider: "STRIPE", paymentState: "PENDING", status: "PENDING", totalCents: 1200, stripeCheckoutSessionId: "cs_order", paypalOrderId: null as string | null, providerPaymentId: null as string | null, inventoryRestored: false, checkoutCartId: null, refundedCents: 0, customerEmail: "buyer@example.invalid", customerName: "Buyer", fulfillmentType: "PICKUP", fulfillmentInstructions: "Test", items: [{ productId: "loaf", productName: "Loaf", quantity: 2, unitPriceCents: 600 }] };
  let stock = 0;
  const emails = new Map();
  const tx = {
    $executeRaw: async () => 1,
    order: { findUniqueOrThrow: async () => ({ ...order, items: [...order.items] }), update: async ({ data }: { data: Record<string, unknown> }) => Object.assign(order, data) },
    product: { update: async ({ data }: { data: { inventoryLimit: { increment: number } } }) => { stock += data.inventoryLimit.increment; } },
    appConfig: { findMany: async () => [] }, adminSettings: { findFirst: async () => null },
    emailJob: { upsert: async ({ where, create }: { where: { dedupeKey: string }; create: unknown }) => { if (!emails.has(where.dedupeKey)) emails.set(where.dedupeKey, create); return emails.get(where.dedupeKey); } }
  } as unknown as Prisma.TransactionClient;
  return { tx, order, emails, stock: () => stock };
}
const proof = { orderId: "order", provider: "STRIPE" as const, providerOrderId: "cs_order", paymentId: "pi_order", amountCents: 1200, currency: "USD" };
test("payment confirmation is idempotent, binds provider identity and queues one paid email", async () => {
  const { tx, order, emails } = fakeTransaction();
  await confirmPayment(tx, proof); await confirmPayment(tx, proof);
  assert.equal(order.status, "PAID"); assert.equal(order.paymentState, "PAID"); assert.equal(emails.size, 1);
  assert.match([...emails.values()][0].body, /^Payment confirmed/);
  await assert.rejects(confirmPayment(tx, { ...proof, paymentId: "pi_other" }));
  await assert.rejects(confirmPayment(tx, { ...proof, providerOrderId: "cs_other" }));
  await assert.rejects(confirmPayment(tx, { ...proof, amountCents: 1 }));
});
test("expired stock restores once; a late payment becomes review without promising fulfillment", async () => {
  const state = fakeTransaction();
  await releaseReservation(state.tx, "order", "EXPIRED"); await releaseReservation(state.tx, "order", "EXPIRED");
  assert.equal(state.stock(), 2); assert.equal(state.order.status, "CANCELLED");
  await confirmPayment(state.tx, proof);
  assert.equal(state.order.paymentState, "REVIEW"); assert.equal(state.order.status, "CANCELLED"); assert.equal(state.emails.size, 0);
});
test("late expiry and replayed success cannot restock paid orders or undo refunds", async () => {
  const state = fakeTransaction();
  await confirmPayment(state.tx, proof);
  await releaseReservation(state.tx, "order", "EXPIRED"); assert.equal(state.stock(), 0);
  await recordRefund(state.tx, "order", 300); assert.equal(state.order.paymentState, "PARTIALLY_REFUNDED");
  await recordRefund(state.tx, "order", 1200); await confirmPayment(state.tx, proof);
  assert.equal(state.order.paymentState, "REFUNDED"); assert.equal(state.order.refundedCents, 1200); assert.equal(state.stock(), 0);
  await assert.rejects(recordRefund(state.tx, "order", 1201));
});
test("PayPal approval is never treated as payment; order and capture totals are independently verified", async () => {
  const state = fakeTransaction(); state.order.paymentProvider = "PAYPAL"; state.order.paypalOrderId = "PPORDER";
  const remote = { id: "PPORDER", status: "APPROVED", purchase_units: [{ custom_id: "order", amount: { currency_code: "USD", value: "12.00" } }] };
  await confirmPayPalOrder(state.tx, "order", remote); assert.equal(state.order.paymentState, "PENDING");
  assert.throws(() => assertPayPalOrderMatches(state.order, { ...remote, id: "OTHER" }));
  await assert.rejects(confirmPayPalOrder(state.tx, "order", { ...remote, status: "COMPLETED", purchase_units: [{ ...remote.purchase_units[0], payments: { captures: [{ id: "CAPTURE", status: "COMPLETED", amount: { currency_code: "USD", value: "0.01" } }] } }] }));
  await confirmPayPalOrder(state.tx, "order", { ...remote, status: "COMPLETED", purchase_units: [{ ...remote.purchase_units[0], payments: { captures: [{ id: "CAPTURE", status: "COMPLETED", amount: { currency_code: "USD", value: "12.00" } }] } }] });
  assert.equal(state.order.paymentState, "PAID");
});

test("tax and delivery totals require explicit settings and round only in integer cents", () => {
  assert.equal(pricingConfiguration({}), null);
  assert.equal(pricingConfiguration({ TAX_RATE_BPS: "-1", TAX_DELIVERY_FEE: "false" }), null);
  assert.deepEqual(priceOrder(1200, 300, { taxRateBps: 625, taxDeliveryFee: false }), { subtotalCents: 1200, deliveryFeeCents: 300, taxCents: 75, totalCents: 1575 });
  assert.equal(priceOrder(1200, 300, { taxRateBps: 625, taxDeliveryFee: true }).taxCents, 94);
  assert.equal(priceOrder(1200, 300, { taxRateBps: 0, taxDeliveryFee: false }).totalCents, 1500);
});
