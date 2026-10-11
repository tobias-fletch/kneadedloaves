import { assertIntegrationDatabase } from './guard.mjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { getStripe } from '@/lib/stripe';
import { prisma } from '@/lib/prisma';
import { reserveCheckout } from '@/lib/checkout-order';
import { confirmPayment, processPaymentEvent, releaseReservation, recordRefund } from '@/lib/payment-state';
import { applyStripeEvent } from '@/lib/stripe-events';
import { applyPayPalEvent } from '@/lib/paypal-events';
import { createProviderCheckout } from '@/lib/payment-checkout';
import { parseBakeryDateTime } from '@/lib/bakery-time';
import { expireAbandonedPayPalOrders, reconcilePayments } from '@/lib/payment-reconciliation';
assertIntegrationDatabase();
process.env.TAX_RATE_BPS = '0';
process.env.TAX_DELIVERY_FEE = 'false';
process.env.PAYPAL_CLIENT_ID = 'qa-fixture';
process.env.PAYPAL_CLIENT_SECRET = 'qa-fixture';
process.env.PAYPAL_SANDBOX = 'true';
process.env.STRIPE_SECRET_KEY = 'sk_test_qa_fixture_not_real';
process.env.STRIPE_TEST_MODE = 'true';
let passed = 0, failed = 0;
const failures = [];
async function test(name, fn) { try {
    await fn();
    passed++;
    console.log('PASS:', name);
}
catch (e) {
    failed++;
    failures.push(name);
    console.error('FAIL:', name, e);
} }
const uid = () => randomUUID().replaceAll('-', '');
let pickup;
async function window(capacity = 100) { const sat = new Date(Date.now() + 21 * 86400000); while (sat.getUTCDay() !== 6)
    sat.setUTCDate(sat.getUTCDate() + 1); const thu = new Date(sat.getTime() - 2 * 86400000); return prisma.orderWindow.create({ data: { name: 'QA ' + uid(), opensAt: new Date(Date.now() - 60000), closesAt: parseBakeryDateTime(thu.toISOString().slice(0, 10) + 'T18:00'), fulfillmentDate: parseBakeryDateTime(sat.toISOString().slice(0, 10) + 'T10:00'), maxOrders: capacity } }); }
async function product(stock = 10) { return prisma.product.create({ data: { name: 'QA loaf', slug: 'qa-' + uid(), description: 'Synthetic QA', priceCents: 1000, allergens: [], ingredients: [], inventoryLimit: stock } }); }
async function cart(p, quantity = 1) { return prisma.cart.create({ data: { sessionId: randomUUID(), items: { create: { productId: p.id, quantity } } } }); }
function input(w, provider = 'STRIPE') { return { customerName: 'Synthetic QA', customerEmail: 'qa@example.invalid', fulfillmentType: 'PICKUP', pickupLocationId: pickup.id, orderWindowId: w.id, paymentProvider: provider, checkoutKey: randomUUID() }; }
async function fixture(provider = 'STRIPE') { const p = await product(), w = await window(), c = await cart(p), data = input(w, provider); const id = await reserveCheckout(data, c.id); return { p, w, c, id, data }; }
const order = (id) => prisma.order.findUniqueOrThrow({ where: { id } });
const stock = (id) => prisma.product.findUniqueOrThrow({ where: { id } }).then(p => p.inventoryLimit);
const emails = (id) => prisma.emailJob.count({ where: { dedupeKey: 'order-paid:' + id } });
function proof(id, provider = 'STRIPE') { return { orderId: id, provider, providerOrderId: 'sess' + id, paymentId: 'pay' + id, amountCents: 1000, currency: 'usd' }; }
function stripeMock(id, amount_refunded = 0) { const p = proof(id); const session = { id: p.providerOrderId, metadata: { orderId: id }, client_reference_id: id, mode: 'payment', livemode: false, status: 'complete', payment_status: 'paid', payment_intent: p.paymentId, amount_total: 1000, currency: 'usd' }; const charge = { id: 'ch' + id, payment_intent: p.paymentId, amount: 1000, currency: 'usd', amount_refunded, disputed: false }; const intent = { id: p.paymentId, metadata: { orderId: id }, latest_charge: charge, status: 'succeeded', amount: 1000, currency: 'usd' }; const api = { checkout: { sessions: { retrieve: async () => session } }, paymentIntents: { retrieve: async () => intent }, charges: { retrieve: async () => charge } }; const event = (type = 'checkout.session.completed', eid = uid()) => ({ id: eid, type, livemode: false, data: { object: type.startsWith('charge.') ? charge : session } }); return { api, event, session, charge, intent }; }
async function main() {
    pickup = await prisma.pickupLocation.create({ data: { name: 'Synthetic QA', address: 'Fixture address', instructions: 'Fixture instructions' } });
    await test('final stock unit competed across distinct windows: one winner, no negative stock', async () => {
        const p = await product(1), windows = await Promise.all([window(), window()]), carts = await Promise.all([cart(p), cart(p)]);
        const results = await Promise.allSettled(carts.map((c, i) => reserveCheckout(input(windows[i]), c.id)));
        assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
        assert.equal(await stock(p.id), 0);
        assert.equal(await prisma.order.count({ where: { checkoutCartId: { in: carts.map(c => c.id) } } }), 1);
    });
    await test('eight concurrent carts respect capacity 3 and stock accounting', async () => {
        const p = await product(20), w = await window(3), carts = await Promise.all(Array.from({ length: 8 }, () => cart(p)));
        const r = await Promise.allSettled(carts.map(c => reserveCheckout(input(w), c.id)));
        assert.equal(r.filter(x => x.status === 'fulfilled').length, 3);
        assert.equal(await stock(p.id), 17);
        assert.equal(await prisma.order.count({ where: { orderWindowId: w.id } }), 3);
    });
    await test('ten simultaneous identical checkout retries reserve exactly once', async () => {
        const p = await product(), w = await window(), c = await cart(p), data = input(w);
        const ids = await Promise.all(Array.from({ length: 10 }, () => reserveCheckout(data, c.id)));
        assert.equal(new Set(ids).size, 1);
        assert.equal(await stock(p.id), 9);
        await assert.rejects(reserveCheckout({ ...data, customerName: 'Changed' }, c.id), /different details/);
    });
    await test('one cart with two checkout keys cannot reserve twice', async () => {
        const p = await product(), w = await window(), c = await cart(p);
        const r = await Promise.allSettled([reserveCheckout(input(w), c.id), reserveCheckout(input(w), c.id)]);
        assert.equal(r.filter(x => x.status === 'fulfilled').length, 1);
        assert.equal(await stock(p.id), 9);
    });
    await test('multi-item stock failure rolls back all inventory and order writes', async () => {
        const good = await product(5), bad = await product(0), w = await window();
        const c = await prisma.cart.create({ data: { sessionId: randomUUID(), items: { create: [{ productId: good.id, quantity: 1 }, { productId: bad.id, quantity: 1 }] } } });
        await assert.rejects(reserveCheckout(input(w), c.id));
        assert.equal(await stock(good.id), 5);
        assert.equal(await prisma.order.count({ where: { checkoutCartId: c.id } }), 0);
    });
    await test('twelve duplicate webhooks commit one event, one payment and one email', async () => {
        const f = await fixture(), pid = proof(f.id), eid = uid();
        await Promise.all(Array.from({ length: 12 }, () => processPaymentEvent('STRIPE', eid, 'completed', f.id, tx => confirmPayment(tx, pid))));
        assert.equal(await prisma.paymentEvent.count({ where: { id: 'STRIPE:' + eid } }), 1);
        assert.equal((await order(f.id)).paymentState, 'PAID');
        assert.equal(await emails(f.id), 1);
        assert.equal(await prisma.cartItem.count({ where: { cartId: f.c.id } }), 0);
        assert.equal(await stock(f.p.id), 9);
        await prisma.order.update({ where: { id: f.id }, data: { status: 'PREPARING' } });
        await Promise.all(Array.from({ length: 5 }, () => processPaymentEvent('STRIPE', uid(), 'completed', f.id, tx => confirmPayment(tx, pid))));
        assert.equal((await order(f.id)).status, 'PREPARING');
        assert.equal(await emails(f.id), 1);
    });
    await test('payment proof rejects wrong amount/currency/provider/session/payment identity', async () => {
        const f = await fixture(), p = proof(f.id);
        for (const patch of [{ amountCents: 1 }, { currency: 'eur' }, { provider: 'PAYPAL' }])
            await assert.rejects(prisma.$transaction(tx => confirmPayment(tx, { ...p, ...patch })));
        await prisma.order.update({ where: { id: f.id }, data: { stripeCheckoutSessionId: p.providerOrderId, providerPaymentId: p.paymentId } });
        for (const patch of [{ providerOrderId: 'other' }, { paymentId: 'other' }])
            await assert.rejects(prisma.$transaction(tx => confirmPayment(tx, { ...p, ...patch })));
        assert.equal((await order(f.id)).paymentState, 'PENDING');
        assert.equal(await emails(f.id), 0);
    });
    await test('concurrent expiry restores once; late success is REVIEW with no paid email', async () => {
        const f = await fixture();
        await Promise.all(Array.from({ length: 10 }, () => prisma.$transaction(tx => releaseReservation(tx, f.id, 'EXPIRED'))));
        assert.equal(await stock(f.p.id), 10);
        assert.equal((await order(f.id)).inventoryRestored, true);
        await Promise.all(Array.from({ length: 5 }, () => processPaymentEvent('STRIPE', uid(), 'completed', f.id, tx => confirmPayment(tx, proof(f.id)))));
        const o = await order(f.id);
        assert.equal(o.paymentState, 'REVIEW');
        assert.equal(o.status, 'CANCELLED');
        assert.equal(o.paymentReviewReason, 'LATE_PAYMENT');
        assert.equal(await stock(f.p.id), 10);
        assert.equal(await emails(f.id), 0);
    });
    await test('20 expiry-versus-success races preserve paid-or-review/stock/email invariants', async () => {
        for (let i = 0; i < 20; i++) {
            const f = await fixture();
            const expire = () => prisma.$transaction(tx => releaseReservation(tx, f.id, 'EXPIRED')), pay = () => processPaymentEvent('STRIPE', uid(), 'completed', f.id, tx => confirmPayment(tx, proof(f.id)));
            await Promise.all(i % 2 ? [pay(), expire()] : [expire(), pay()]);
            const o = await order(f.id);
            if (o.paymentState === 'PAID') {
                assert.equal(o.status, 'PAID');
                assert.equal(o.inventoryRestored, false);
                assert.equal(await stock(f.p.id), 9);
                assert.equal(await emails(f.id), 1);
            }
            else {
                assert.equal(o.paymentState, 'REVIEW');
                assert.equal(o.status, 'CANCELLED');
                assert.equal(o.inventoryRestored, true);
                assert.equal(await stock(f.p.id), 10);
                assert.equal(await emails(f.id), 0);
            }
        }
    });
    await test('partial/full refund replay is monotonic and does not restock or reset fulfillment', async () => {
        const f = await fixture();
        await prisma.$transaction(tx => confirmPayment(tx, proof(f.id)));
        await prisma.order.update({ where: { id: f.id }, data: { status: 'READY' } });
        for (const value of [250, 250, 100, 1000, 500])
            await prisma.$transaction(tx => recordRefund(tx, f.id, value));
        const o = await order(f.id);
        assert.equal(o.refundedCents, 1000);
        assert.equal(o.paymentState, 'REFUNDED');
        assert.equal(o.status, 'READY');
        await prisma.$transaction(tx => confirmPayment(tx, proof(f.id)));
        await prisma.$transaction(tx => releaseReservation(tx, f.id, 'EXPIRED'));
        assert.equal((await order(f.id)).paymentState, 'REFUNDED');
        assert.equal(await stock(f.p.id), 9);
        assert.equal(await emails(f.id), 1);
        for (const invalid of [-1, 1001, 0.5])
            await assert.rejects(prisma.$transaction(tx => recordRefund(tx, f.id, invalid)));
    });
    await test('Stripe reordered expired event uses canonical paid session; pending canonical state stays pending', async () => {
        const f = await fixture(), m = stripeMock(f.id);
        await applyStripeEvent(m.api, m.event('checkout.session.expired'));
        assert.equal((await order(f.id)).paymentState, 'PAID');
        assert.equal(await stock(f.p.id), 9);
        const g = await fixture(), n = stripeMock(g.id);
        n.session.status = 'open';
        n.session.payment_status = 'unpaid';
        await applyStripeEvent(n.api, n.event());
        assert.equal((await order(g.id)).paymentState, 'PENDING');
        assert.equal(await emails(g.id), 0);
    });
    await test('Stripe partial/full refunds before completed event remain REVIEW, never emit paid receipt', async () => {
        for (const cents of [300, 1000]) {
            const f = await fixture(), m = stripeMock(f.id, cents);
            await applyStripeEvent(m.api, m.event('charge.refunded'));
            await applyStripeEvent(m.api, m.event());
            await applyStripeEvent(m.api, m.event());
            const o = await order(f.id);
            assert.equal(o.paymentState, 'REVIEW');
            assert.equal(o.status, 'PENDING');
            assert.equal(o.refundedCents, cents);
            assert.equal(await emails(f.id), 0);
            assert.equal(await stock(f.p.id), 9);
        }
    });
    await test('Stripe provider create success then database COMMIT failure recovers same request/key/session', async () => {
        const f = await fixture();
        const example = await getStripe();
        const proto = Object.getPrototypeOf(example.checkout.sessions);
        const old = proto.create;
        const requests = [];
        const remote = new Map();
        proto.create = async function (body, options) { requests.push(structuredClone({ body, options })); const key = options.idempotencyKey; if (!remote.has(key))
            remote.set(key, { id: 'csRecovery' + uid(), url: 'https://checkout.stripe.com/c/pay/qa' }); return remote.get(key); };
        try {
            await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION qa_fail_bind() RETURNS trigger AS $$ BEGIN IF NEW.id = '${f.id}' AND NEW."stripeCheckoutSessionId" IS NOT NULL THEN RAISE EXCEPTION 'Synthetic QA commit fault'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
            await prisma.$executeRawUnsafe('CREATE CONSTRAINT TRIGGER qa_fail_bind AFTER UPDATE ON "Order" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION qa_fail_bind()');
            await assert.rejects(createProviderCheckout(f.id), /Synthetic QA/);
            assert.equal((await order(f.id)).stripeCheckoutSessionId, null);
            assert.equal(await stock(f.p.id), 9);
            await prisma.$executeRawUnsafe('DROP TRIGGER qa_fail_bind ON "Order"');
            const oldSecret = process.env.JWT_SECRET, oldApp = process.env.APP_URL;
            process.env.JWT_SECRET = 'changed-fixture-secret-to-test-frozen-provider-payload';
            process.env.APP_URL = 'https://changed.example.invalid';
            try {
                await createProviderCheckout(f.id);
            }
            finally {
                process.env.JWT_SECRET = oldSecret;
                process.env.APP_URL = oldApp;
            }
            assert.equal(requests.length, 2);
            assert.deepEqual(requests[0], requests[1]);
            assert.equal(remote.size, 1);
            assert.equal((await order(f.id)).stripeCheckoutSessionId, [...remote.values()][0].id);
            assert.equal(await stock(f.p.id), 9);
        }
        finally {
            proto.create = old;
            await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS qa_fail_bind ON "Order"');
            await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS qa_fail_bind()');
        }
    });
    await test('PayPal approved duplicate capture serializes and refund IDs dedupe across event IDs', async () => {
        const f = await fixture('PAYPAL'), remoteId = 'PP' + uid(), captureId = 'CAP' + uid();
        await prisma.order.update({ where: { id: f.id }, data: { paypalOrderId: remoteId } });
        let captures = 0;
        const remote = { id: remoteId, status: 'APPROVED', purchase_units: [{ custom_id: f.id, amount: { currency_code: 'USD', value: '10.00' } }] };
        const oldFetch = globalThis.fetch;
        globalThis.fetch = async (input, init) => { const url = String(input); if (url.endsWith('/v1/oauth2/token'))
            return Response.json({ access_token: 'qa-fixture' }); if (url.endsWith(`/v2/checkout/orders/${remoteId}/capture`)) {
            captures++;
            assert.equal(init.headers['PayPal-Request-Id'], 'capture-' + f.id);
            remote.status = 'COMPLETED';
            remote.purchase_units[0].payments = { captures: [{ id: captureId, status: 'COMPLETED', amount: { currency_code: 'USD', value: '10.00' } }] };
            return Response.json(remote);
        } if (url.endsWith(`/v2/checkout/orders/${remoteId}`))
            return Response.json(remote); if (url.endsWith('/v2/payments/captures/' + captureId))
            return Response.json({ id: captureId, status: 'PARTIALLY_REFUNDED', amount: { currency_code: 'USD', value: '10.00' }, supplementary_data: { related_ids: { order_id: remoteId } } }); if (url.includes('/v2/payments/refunds/'))
            return Response.json({ id: 'RFQA' + f.id, status: 'COMPLETED', amount: { currency_code: 'USD', value: '2.50' }, links: [{ rel: 'up', href: 'https://api-m.sandbox.paypal.com/v2/payments/captures/' + captureId }] }); throw Error('Unexpected network request blocked: ' + url); };
        try {
            const eid = uid();
            await Promise.all(Array.from({ length: 5 }, () => applyPayPalEvent({ id: eid, event_type: 'CHECKOUT.ORDER.APPROVED', resource: { id: remoteId } })));
            assert.equal(captures, 1);
            assert.equal((await order(f.id)).paymentState, 'PAID');
            assert.equal(await emails(f.id), 1);
            await Promise.all(Array.from({ length: 5 }, () => applyPayPalEvent({ id: uid(), event_type: 'PAYMENT.CAPTURE.REFUNDED', resource: { id: 'RFQA' + f.id } })));
            assert.equal((await order(f.id)).refundedCents, 250);
            assert.equal((await order(f.id)).paymentState, 'PARTIALLY_REFUNDED');
            await applyPayPalEvent({ id: uid(), event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { id: captureId, supplementary_data: { related_ids: { order_id: remoteId } } } });
            assert.equal((await order(f.id)).refundedCents, 250);
            assert.equal(await emails(f.id), 1);
        }
        finally {
            globalThis.fetch = oldFetch;
        }
    });
    await test('PayPal partial/full refund before completed binds payment without paid receipt', async () => {
        for (const refunded of [250, 1000]) {
            const f = await fixture('PAYPAL'), remoteId = 'PP' + uid(), captureId = 'CAP' + uid(), refundId = 'REF' + uid();
            await prisma.order.update({ where: { id: f.id }, data: { paypalOrderId: remoteId } });
            const capture = { id: captureId, status: refunded === 1000 ? 'REFUNDED' : 'PARTIALLY_REFUNDED', amount: { currency_code: 'USD', value: '10.00' }, supplementary_data: { related_ids: { order_id: remoteId } } };
            const remote = { id: remoteId, status: 'COMPLETED', purchase_units: [{ custom_id: f.id, amount: { currency_code: 'USD', value: '10.00' }, payments: { captures: [capture] } }] };
            const oldFetch = globalThis.fetch;
            globalThis.fetch = async (input) => { const url = String(input); if (url.endsWith('/v1/oauth2/token'))
                return Response.json({ access_token: 'qa-fixture' }); if (url.endsWith('/v2/payments/captures/' + captureId))
                return Response.json(capture); if (url.endsWith('/v2/checkout/orders/' + remoteId))
                return Response.json(remote); if (url.endsWith('/v2/payments/refunds/' + refundId))
                return Response.json({ id: refundId, status: 'COMPLETED', amount: { currency_code: 'USD', value: (refunded / 100).toFixed(2) }, links: [{ rel: 'up', href: 'https://api-m.sandbox.paypal.com/v2/payments/captures/' + captureId }] }); throw Error('Unexpected network request blocked: ' + url); };
            try {
                await applyPayPalEvent({ id: uid(), event_type: 'PAYMENT.CAPTURE.REFUNDED', resource: { id: refundId } });
                await applyPayPalEvent({ id: uid(), event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { id: captureId, supplementary_data: { related_ids: { order_id: remoteId } } } });
                await applyPayPalEvent({ id: uid(), event_type: 'PAYMENT.CAPTURE.REFUNDED', resource: { id: refundId } });
                const o = await order(f.id);
                assert.equal(o.providerPaymentId, captureId);
                assert.equal(o.refundedCents, refunded);
                assert.equal(o.paymentState, refunded === 1000 ? 'REFUNDED' : 'PARTIALLY_REFUNDED');
                assert.equal(o.status, 'PENDING');
                assert.equal(await emails(f.id), 0);
                assert.equal(await stock(f.p.id), 9);
            }
            finally {
                globalThis.fetch = oldFetch;
            }
        }
    });
    await test('delivery rejects invalid ZIP/inactive zone/missing instructions without stock writes; valid tax/fee persist', async () => {
        const p = await product(10), w = await window(), c = await cart(p), zone = await prisma.deliveryZone.create({ data: { name: 'Synthetic zone', zipCodes: ['10001'], feeCents: 250, instructions: 'QA delivery instructions' } });
        const data = { ...input(w), fulfillmentType: 'DELIVERY', pickupLocationId: undefined, deliveryZoneId: zone.id, deliveryZip: '99999', deliveryAddress: 'Synthetic street' };
        await assert.rejects(reserveCheckout(data, c.id), /Delivery is not configured/);
        assert.equal(await stock(p.id), 10);
        await prisma.deliveryZone.update({ where: { id: zone.id }, data: { active: false } });
        data.deliveryZip = '10001';
        await assert.rejects(reserveCheckout(data, c.id), /Delivery is not configured/);
        assert.equal(await stock(p.id), 10);
        await prisma.deliveryZone.update({ where: { id: zone.id }, data: { active: true, instructions: ' ' } });
        await assert.rejects(reserveCheckout(data, c.id), /Delivery is not configured/);
        assert.equal(await stock(p.id), 10);
        assert.equal(await prisma.order.count({ where: { checkoutCartId: c.id } }), 0);
        await prisma.deliveryZone.update({ where: { id: zone.id }, data: { instructions: 'QA delivery instructions' } });
        process.env.TAX_RATE_BPS = '500';
        process.env.TAX_DELIVERY_FEE = 'true';
        try {
            const id = await reserveCheckout(data, c.id), o = await order(id);
            assert.equal(o.deliveryFeeCents, 250);
            assert.equal(o.taxCents, 63);
            assert.equal(o.totalCents, 1313);
            assert.equal(o.deliveryAddress, 'Synthetic street\n10001');
            assert.match(o.fulfillmentInstructions || '', /QA delivery instructions/);
            assert.equal(await stock(p.id), 9);
        }
        finally {
            process.env.TAX_RATE_BPS = '0';
            process.env.TAX_DELIVERY_FEE = 'false';
        }
    });
    await test('PayPal reconciliation isolates one provider failure and still releases next abandoned order', async () => {
        const bad = await fixture('PAYPAL'), good = await fixture('PAYPAL'), badId = 'PPBAD' + uid(), goodId = 'PPGOOD' + uid();
        for (const [f, id] of [[bad, badId], [good, goodId]])
            await prisma.order.update({ where: { id: f.id }, data: { paypalOrderId: id, reservationExpiresAt: new Date(Date.now() - 60000), updatedAt: new Date(0) } });
        const oldFetch = globalThis.fetch;
        globalThis.fetch = async (input) => { const url = String(input); if (url.endsWith('/v1/oauth2/token'))
            return Response.json({ access_token: 'qa-fixture' }); if (url.endsWith('/v2/checkout/orders/' + badId))
            return new Response('synthetic temporary failure', { status: 503 }); if (url.endsWith('/v2/checkout/orders/' + goodId))
            return Response.json({ id: goodId, status: 'APPROVED', purchase_units: [{ custom_id: good.id, amount: { currency_code: 'USD', value: '10.00' } }] }); throw Error('Unexpected network request blocked: ' + url); };
        try {
            assert.equal(await expireAbandonedPayPalOrders(2), 1);
            assert.equal((await order(bad.id)).paymentState, 'PENDING');
            assert.equal((await order(bad.id)).paymentReviewReason, 'PROVIDER_CHECK_FAILED');
            assert.equal(await stock(bad.p.id), 9);
            assert.equal((await order(good.id)).paymentState, 'EXPIRED');
            assert.equal(await stock(good.p.id), 10);
        }
        finally {
            globalThis.fetch = oldFetch;
            await prisma.$transaction(tx => releaseReservation(tx, bad.id, 'EXPIRED'));
        }
    });
    await test('Stripe reconciliation recovers provider session after 24-hour creation retry window', async () => {
        const f = await fixture(), m = stripeMock(f.id);
        await prisma.order.update({ where: { id: f.id }, data: { createdAt: new Date(Date.now() - 25 * 3600000), reservationExpiresAt: new Date(Date.now() - 24 * 3600000), updatedAt: new Date(0), paymentState: 'REVIEW', paymentReviewReason: 'CREATION_UNKNOWN' } });
        const instance = await getStripe(), sp = Object.getPrototypeOf(instance.checkout.sessions), ip = Object.getPrototypeOf(instance.paymentIntents);
        const old = { list: sp.list, retrieve: sp.retrieve, create: sp.create, intent: ip.retrieve };
        
        sp.list = async () => ({ data: [m.session], has_more: false });
        sp.retrieve = async (id) => id === m.session.id ? m.session : { id, status: 'open' };
        sp.create = async () => {  throw Error('Unrelated synthetic provider create blocked'); };
        ip.retrieve = async () => m.intent;
        try {
            await reconcilePayments();
            const o = await order(f.id);
            assert.equal(o.stripeCheckoutSessionId, m.session.id);
            assert.equal(o.paymentState, 'PAID');
            assert.equal(await emails(f.id), 1);
            assert.equal(await stock(f.p.id), 9);
        }
        finally {
            sp.list = old.list;
            sp.retrieve = old.retrieve;
            sp.create = old.create;
            ip.retrieve = old.intent;
        }
    });
    console.log(JSON.stringify({ passed, failed, failures }));
    if (failed)
        process.exitCode = 1;
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
