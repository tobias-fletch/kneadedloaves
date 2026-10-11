/* Run from bakery repo root: node --import tsx --test tests/payment-handlers.test.mjs
 * Mocked DB/provider tests. These do not establish real PostgreSQL locking,
 * webhook signature-route behavior, or live provider semantics.
 */
import assert from "node:assert/strict";
import { test, afterEach } from "node:test";
import { applyStripeEvent } from "../lib/stripe-events.ts";
import { confirmPayPalOrder } from "../lib/paypal-events.ts";
import { prisma } from "../lib/prisma.ts";
// Prisma delegates use proxies, so restore direct substitutions explicitly.
const originalFindUnique = prisma.order.findUnique;
const originalTransaction = prisma.$transaction;
afterEach(() => {
  prisma.order.findUnique = originalFindUnique;
  prisma.$transaction = originalTransaction;
});
function fixture(paymentState = 'REFUNDED', paymentReviewReason = null) {
  const order = {
    id: 'order', paymentProvider: 'STRIPE', paymentState, paymentReviewReason,
    status: paymentState === 'REFUNDED' ? 'PAID' : 'PENDING', totalCents: 1200,
    stripeCheckoutSessionId: 'cs_order', paypalOrderId: 'PPORDER',
    providerPaymentId: paymentState === 'REFUNDED' ? 'pi_order' : null,
    refundedCents: paymentState === 'REFUNDED' ? 1200 : 0,
    inventoryRestored: false, checkoutCartId: null,
    customerEmail: 'buyer@example.invalid', customerName: 'Buyer',
    fulfillmentType: 'PICKUP', fulfillmentInstructions: 'Test pickup',
    items: [{ productId: 'loaf', productName: 'Loaf', quantity: 1, unitPriceCents: 1200 }]
  };
  let stock = 0;
  const emails = [];
  const tx = {
    $executeRaw: async () => 1,
    order: {
      findUniqueOrThrow: async () => ({ ...order, items: [...order.items] }),
      update: async ({ data }) => Object.assign(order, data)
    },
    product: { update: async ({ data }) => { stock += data.inventoryLimit.increment; } },
    paymentEvent: { findUnique: async () => null, create: async () => ({}) },
    appConfig: { findMany: async () => [] }, adminSettings: { findFirst: async () => null },
    emailJob: { upsert: async ({ create }) => { emails.push(create); return create; } }
  };
  return { order, tx, emails, stock: () => stock };
}
function install(state) {
  prisma.order.findUnique = async () => ({ ...state.order });
  prisma.$transaction = async (callback) => callback(state.tx);
}
function stripe(status = 'complete', amount = 1200) {
  return {
    checkout: { sessions: { retrieve: async () => ({
      id: 'cs_order', metadata: { orderId: 'order' }, client_reference_id: 'order',
      livemode: false, mode: 'payment', payment_status: status === 'complete' ? 'paid' : 'unpaid',
      status, payment_intent: 'pi_order', amount_total: amount, currency: 'usd'
    }) } },
    paymentIntents: { retrieve: async () => ({ latest_charge: { disputed: false, amount_refunded: 1200 } }) }
  };
}
const event = (status = 'complete') => ({
  id: 'evt_review_regression', type: status === 'complete' ? 'checkout.session.completed' : 'checkout.session.expired',
  livemode: false, data: { object: { id: 'cs_order' } }
});
test('Stripe late completed event preserves an already verified full refund', async () => {
  const s = fixture(); install(s);
  await applyStripeEvent(stripe(), event());
  assert.equal(s.order.paymentState, 'REFUNDED'); assert.equal(s.order.refundedCents, 1200);
  assert.equal(s.emails.length, 0); assert.equal(s.stock(), 0);
});
test('Stripe refunded-charge branch rejects a mismatched session amount', async () => {
  const s = fixture(); install(s);
  await assert.rejects(applyStripeEvent(stripe('complete', 1), event()), /does not match/);
  assert.equal(s.order.paymentState, 'REFUNDED'); assert.equal(s.order.refundedCents, 1200);
  assert.equal(s.emails.length, 0);
});
test('Stripe canonical expiry releases a creation-unknown reservation', async () => {
  const s = fixture('REVIEW', 'CREATION_UNKNOWN'); install(s);
  await applyStripeEvent(stripe('expired'), event('expired'));
  assert.equal(s.order.paymentState, 'EXPIRED'); assert.equal(s.order.status, 'CANCELLED');
  assert.equal(s.order.inventoryRestored, true); assert.equal(s.stock(), 1); assert.equal(s.emails.length, 0);
});
test('Stripe expiry cannot release an unrelated payment-review reservation', async () => {
  const s = fixture('REVIEW', 'DISPUTE'); install(s);
  await applyStripeEvent(stripe('expired'), event('expired'));
  assert.equal(s.order.paymentState, 'REVIEW'); assert.equal(s.order.status, 'PENDING');
  assert.equal(s.order.inventoryRestored, false); assert.equal(s.stock(), 0);
});
const refundedPayPalOrder = status => ({ id: 'PPORDER', status: 'COMPLETED', purchase_units: [{
  custom_id: 'order', amount: { currency_code: 'USD', value: '12.00' },
  payments: { captures: [{ id: 'CAPTURE', status, amount: { currency_code: 'USD', value: '12.00' } }] }
}] });
test('PayPal full refund before local confirmation binds identity without paid email or restock', async () => {
  const s = fixture('PENDING'); s.order.paymentProvider = 'PAYPAL'; s.order.stripeCheckoutSessionId = null;
  await confirmPayPalOrder(s.tx, 'order', refundedPayPalOrder('REFUNDED'));
  assert.equal(s.order.providerPaymentId, 'CAPTURE'); assert.equal(s.order.paymentState, 'REFUNDED');
  assert.equal(s.order.refundedCents, 1200); assert.equal(s.order.status, 'PENDING');
  assert.equal(s.emails.length, 0); assert.equal(s.stock(), 0);
});
test('PayPal partial refund before local confirmation binds identity and retains review', async () => {
  const s = fixture('PENDING'); s.order.paymentProvider = 'PAYPAL'; s.order.stripeCheckoutSessionId = null;
  await confirmPayPalOrder(s.tx, 'order', refundedPayPalOrder('PARTIALLY_REFUNDED'));
  assert.equal(s.order.providerPaymentId, 'CAPTURE'); assert.equal(s.order.paymentState, 'REVIEW');
  assert.equal(s.order.paymentReviewReason, 'REFUND_BEFORE_CONFIRMATION');
  assert.equal(s.order.refundedCents, 0); // The separate refund event supplies the partial amount.
  assert.equal(s.order.status, 'PENDING'); assert.equal(s.emails.length, 0); assert.equal(s.stock(), 0);
});
