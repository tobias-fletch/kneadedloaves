// Reconstructed 2026-10-13 from retained acceptance contracts. Previous run evidence does not apply.
import assert from "node:assert/strict";
import { randomUUID, createHash } from "crypto";
import { PrismaClient } from "@prisma/client";
import { expireOrder, recordPaymentEvidence } from "../lib/manual-payments";
import { changeOrderStatus } from "../lib/order-status";
import { destinationFingerprint } from "../lib/manual-payment-config";
import { processEmailQueue } from "../lib/email-queue";
import { hashPassword } from "../lib/auth";
import { checkoutOwners, checkoutRequestHash, receiptForOwnedAttempt } from "../lib/checkout-recovery";

const database = new URL(process.env.DATABASE_URL || "http://invalid");
assert.equal(database.hostname, "127.0.0.1");
assert.equal(database.pathname, "/kneaded_loaves_test");
const p = new PrismaClient();
const base = process.env.TEST_APP_URL || "http://127.0.0.1:3317";
const password = "Synthetic-local-password-2026";
let groups = 0;
function pass(message: string) { groups++; console.log(`PASS ${groups}: ${message}`); }
async function request(path: string, body?: unknown, cookie?: string, method = "POST", extra: Record<string, string> = {}) {
  return fetch(base + path, { method, redirect: "manual", headers: { Origin: base, "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}), ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function status(response: Response, expected: number) { assert.equal(response.status, expected, await response.clone().text()); return response; }
async function login(email: string) {
  const response = await fetch(base + "/api/auth/login", { method: "POST", redirect: "manual", headers: { Origin: base }, body: new URLSearchParams({ email, password }) });
  assert.equal(response.status, 303); assert.ok(response.headers.get("set-cookie")); return response.headers.get("set-cookie")!.split(";")[0];
}
async function main() {
  const config: Record<string, string> = { VENMO_CHECKOUT_ENABLED: "true", VENMO_HANDLE: "@Synthetic-QA", VENMO_DESTINATION: "https://venmo.com/Synthetic-QA", VENMO_DESTINATION_VERIFIED: "true", PAYMENT_HOLD_MINUTES: "30", PAYMENT_WORKERS_READY: "true", CHECKOUT_SMOKE_TESTED: "true", APP_URL: base, SMTP_HOST: "127.0.0.1", SMTP_PORT: "2525", SMTP_USER: "synthetic", SMTP_PASSWORD: "synthetic", EMAIL_FROM: "qa@example.invalid" };
  config.VENMO_VERIFIED_FINGERPRINT = destinationFingerprint(config.VENMO_HANDLE, config.VENMO_DESTINATION);
  async function restoreConfig() { for (const [key, value] of Object.entries(config)) await p.appConfig.upsert({ where: { key }, update: { value, secret: false }, create: { key, value, secret: false } }); }
  await restoreConfig();
  const admin = await p.user.create({ data: { email: `admin-${randomUUID()}@example.invalid`, passwordHash: await hashPassword(password), role: "ADMIN" } });
  const customer = await p.user.create({ data: { email: `customer-${randomUUID()}@example.invalid`, passwordHash: await hashPassword(password) } });
  const adminCookie = await login(admin.email), customerCookie = await login(customer.email);
  const product = await p.product.create({ data: { name: "Synthetic loaf", slug: randomUUID(), description: "QA only", priceCents: 1000, inventoryLimit: 100, allergens: [], ingredients: [] } });
  const pickup = await p.pickupLocation.create({ data: { name: "Synthetic pickup", address: "Not a real address" } });
  const window = await p.orderWindow.create({ data: { name: "QA window", opensAt: new Date(Date.now() - 60000), closesAt: new Date(Date.now() + 3600000), fulfillmentDate: new Date(Date.now() + 86400000), maxOrders: 100 } });
  const input = { customerName: "Synthetic customer", customerEmail: "customer@example.invalid", fulfillmentType: "PICKUP", pickupLocationId: pickup.id };
  async function cart(quantity = 1) { const response = await status(await request("/api/cart", { productId: product.id, quantity }), 200); return response.headers.get("set-cookie")!.split(";")[0]; }
  const checkout = (cookie: string, key = randomUUID(), payload: unknown = input) => request("/api/checkout", payload, cookie, "POST", { "Idempotency-Key": key });
  const recover = (key: string, cookie?: string) => request("/api/checkout/recover", { idempotencyKey: key }, cookie);
  const stock = async () => (await p.product.findUniqueOrThrow({ where: { id: product.id } })).inventoryLimit;
  const capacity = () => p.order.count({ where: { orderWindowId: window.id, status: { not: "CANCELLED" } } });
  const getOrder = (id: string) => p.order.findUniqueOrThrow({ where: { id } });
  async function fixture(due = 60000) { return p.order.create({ data: { customerName: "Synthetic", customerEmail: "qa@example.invalid", totalCents: 1000, fulfillmentType: "PICKUP", orderWindowId: window.id, paymentMethod: "VENMO", paymentReference: `KL-${randomUUID()}`, currency: "USD", paymentDestination: config.VENMO_DESTINATION, paymentHandle: config.VENMO_HANDLE, paymentDueAt: new Date(Date.now() + due), items: { create: { productId: product.id, productName: product.name, quantity: 1, unitPriceCents: 1000 } } } }); }
  const evidence = () => ({ action: "verify" as const, amountCents: 1000, currency: "USD", providerTransactionId: `qa-${randomUUID()}`, receivedAt: new Date().toISOString(), attested: true as const });

  const guest = await cart(), key = randomUUID();
  await p.appConfig.update({ where: { key: "VENMO_CHECKOUT_ENABLED" }, data: { value: "false" } });
  await status(await checkout(guest, key), 503); assert.equal(await p.order.count(), 0); assert.equal(await stock(), 100);
  await p.appConfig.update({ where: { key: "VENMO_CHECKOUT_ENABLED" }, data: { value: "true" } });
  pass("disabled checkout does not consume cart, stock or create order");

  const duplicate = await Promise.all([checkout(guest, key), checkout(guest, key)]); for (const response of duplicate) await status(response, 200);
  const receipt = await duplicate[0].json(); assert.deepEqual(await duplicate[1].json(), receipt);
  assert.equal(await p.order.count(), 1); assert.equal(await stock(), 99); assert.equal(await p.emailJob.count({ where: { dedupeKey: `order-received:${receipt.orderId}` } }), 1);
  await status(await checkout(guest, key, { ...input, customerName: "Changed" }), 400);
  await status(await fetch(base + `/orders/${receipt.orderId}`, { redirect: "manual" }), 404); await status(await fetch(base + receipt.url), 200);
  const first = await getOrder(receipt.orderId); assert.equal(first.paymentState, "UNPAID"); assert.equal(first.totalCents, 1000); assert.equal(first.currency, "USD"); assert.match(first.paymentReference!, /^KL-/);
  const receiptToken = new URL(receipt.url, base).searchParams.get("token")!; assert.equal(first.receiptTokenHash, createHash("sha256").update(receiptToken).digest("hex"));
  const acknowledgement = await p.emailJob.findUniqueOrThrow({ where: { dedupeKey: `order-received:${first.id}` } }); assert.ok(!acknowledgement.body.includes(receiptToken));
  pass("concurrent checkout idempotency, conflicting payload, one reservation/email and private hash-only receipt");

  const stranger = await cart();
  for (const cookie of [undefined, stranger, customerCookie]) assert.ok([404, 503].includes((await recover(key, cookie)).status));
  await status(await recover(randomUUID(), guest), 404); await status(await request("/api/checkout/recover", { orderId: first.id }, guest), 404);
  const recovered = await status(await recover(key.toUpperCase(), guest), 200); assert.equal(recovered.headers.get("cache-control"), "no-store"); assert.deepEqual(await recovered.json(), { orderId: first.id, url: receipt.url });
  await p.appConfig.update({ where: { key: "VENMO_CHECKOUT_ENABLED" }, data: { value: "false" } }); await status(await recover(key, guest), 200); await restoreConfig();
  await status(await recover(key, `${customerCookie}; ${guest}`), 200);
  await p.orderWindow.update({ where: { id: window.id }, data: { maxOrders: 1 } }); assert.equal((await (await status(await checkout(guest, key), 200)).json()).orderId, first.id);
  const orderCount = await p.order.count(); await status(await checkout(stranger, key), 400); assert.equal(await p.order.count(), orderCount); await p.orderWindow.update({ where: { id: window.id }, data: { maxOrders: 100 } });
  pass("owner plus opaque key recovery works when disabled/full or after sign-in; wrong owners and ID-only lookup rejected");

  const lostGuest = await cart(), lostKey = randomUUID(); const lostResponse = await status(await checkout(lostGuest, lostKey), 200); await lostResponse.body?.cancel();
  const emptyCart = await fetch(base + "/api/cart", { headers: { Cookie: lostGuest } }); assert.equal((await emptyCart.json()).items.length, 0);
  const lostReceipt = await (await status(await recover(lostKey, lostGuest), 200)).json(); await status(await fetch(base + lostReceipt.url), 200);
  const lostOrder = await getOrder(lostReceipt.orderId); assert.equal(lostOrder.checkoutRequestHash, checkoutRequestHash(lostKey));
  const owners = checkoutOwners(undefined, lostGuest.slice(lostGuest.indexOf("=") + 1)), rotatedSecret = "synthetic-rotated-recovery-secret-never-production-2026";
  const rotated = await p.$transaction(tx => receiptForOwnedAttempt(tx, lostOrder, lostKey, owners, rotatedSecret)); assert.notEqual(rotated.url, lostReceipt.url); await status(await fetch(base + lostReceipt.url), 404); await status(await fetch(base + rotated.url), 200);
  await assert.rejects(p.$transaction(tx => receiptForOwnedAttempt(tx, lostOrder, lostKey, checkoutOwners(undefined, stranger.split("=")[1]), rotatedSecret)));
  const currentReceipt = await (await status(await recover(lostKey, lostGuest), 200)).json(); await status(await fetch(base + currentReceipt.url), 200); await status(await fetch(base + rotated.url), 404);
  pass("lost committed response recovers an emptied cart; authorized secret rotation replaces hash and revokes old private link");

  await status(await request("/api/cart", { productId: product.id, quantity: 1 }, customerCookie), 200); const signedKey = randomUUID(); const signed = await (await status(await checkout(customerCookie, signedKey), 200)).json();
  await status(await recover(signedKey, customerCookie), 200); for (const cookie of [adminCookie, guest]) assert.ok([404, 503].includes((await recover(signedKey, cookie)).status));
  await status(await fetch(base + `/orders/${signed.orderId}`, { headers: { Cookie: customerCookie } }), 200);
  pass("signed-in recovery and receipt authorize owning account only");

  await status(await request(`/api/orders/${first.id}/payment-review`, { token: "0".repeat(64) }), 404);
  for (let i = 0; i < 2; i++) await status(await request(`/api/orders/${first.id}/payment-review`, { token: receiptToken }), 200);
  assert.equal(await p.paymentEvent.count({ where: { orderId: first.id, type: "CUSTOMER_REVIEW" } }), 1); assert.equal((await getOrder(first.id)).status, "PENDING");
  pass("customer review is private/idempotent and cannot verify payment");

  const firstEvidence = evidence();
  for (const cookie of [undefined, customerCookie]) assert.ok([307, 401, 403].includes((await request(`/api/admin/orders/${first.id}/payment`, firstEvidence, cookie)).status));
  await status(await request(`/api/admin/orders/${first.id}`, { status: "PAID" }, adminCookie, "PATCH"), 400);
  await status(await request(`/api/admin/orders/${first.id}/payment`, { ...firstEvidence, amountCents: 900 }, adminCookie), 409);
  const verifications = await Promise.all([0, 1].map(() => request(`/api/admin/orders/${first.id}/payment`, firstEvidence, adminCookie))); for (const response of verifications) await status(response, 200);
  assert.equal(await p.paymentEvent.count({ where: { orderId: first.id, type: "VERIFIED" } }), 1); assert.equal(await p.emailJob.count({ where: { dedupeKey: `payment-verified:${first.id}` } }), 1); assert.equal((await getOrder(first.id)).paymentVerifiedBy, admin.id);
  pass("admin-only exact verification, fulfillment guard, verifier audit and duplicate-action deduplication");

  const a = await fixture(), b = await fixture(), shared = evidence();
  const collision = await Promise.allSettled([a, b].map(order => p.$transaction(tx => recordPaymentEvidence(tx, order.id, shared, admin.id)))); assert.equal(collision.filter(r => r.status === "fulfilled").length, 1);
  const event = await p.paymentEvent.findUniqueOrThrow({ where: { providerTransactionId: shared.providerTransactionId.toUpperCase() } });
  await p.$transaction(tx => recordPaymentEvidence(tx, event.orderId, { ...shared, providerTransactionId: shared.providerTransactionId.toUpperCase() }, admin.id)); assert.equal(await p.paymentEvent.count({ where: { providerTransactionId: shared.providerTransactionId.toUpperCase() } }), 1);
  pass("cross-order transaction reference races and case variants cannot reuse receipt");

  const expired = await fixture(-1), stockBeforeExpiry = await stock(); await p.product.update({ where: { id: product.id }, data: { soldOut: true } });
  const expirations = await Promise.all([0, 1, 2].map(() => p.$transaction(tx => expireOrder(tx, expired.id)))); assert.equal(expirations.filter(Boolean).length, 1); assert.equal(await stock(), stockBeforeExpiry + 1); assert.equal((await p.product.findUniqueOrThrow({ where: { id: product.id } })).soldOut, true);
  await assert.rejects(p.$transaction(tx => recordPaymentEvidence(tx, expired.id, evidence(), admin.id))); await p.product.update({ where: { id: product.id }, data: { soldOut: false } });
  pass("expiry restores inventory once, preserves owner sold-out and rejects late verification");

  const boundary = await fixture(), now = new Date(); await p.order.update({ where: { id: boundary.id }, data: { paymentDueAt: now } });
  await Promise.allSettled([p.$transaction(tx => expireOrder(tx, boundary.id, now)), p.$transaction(tx => recordPaymentEvidence(tx, boundary.id, { ...evidence(), receivedAt: now.toISOString() }, admin.id, now))]);
  assert.equal((await getOrder(boundary.id)).status, "CANCELLED"); assert.equal((await getOrder(boundary.id)).inventoryRestored, true); assert.notEqual((await getOrder(boundary.id)).paymentState, "VERIFIED");
  pass("expiry/verification boundary race never pays released stock");

  const delayed = await fixture(800); let signalLocked!: () => void, releaseLock!: () => void;
  const locked = new Promise<void>(resolve => { signalLocked = resolve; }), release = new Promise<void>(resolve => { releaseLock = resolve; });
  const holder = p.$transaction(async tx => { await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`order:${delayed.id}`}))`; signalLocked(); await release; }); await locked;
  const rejectLate = assert.rejects(p.$transaction(tx => recordPaymentEvidence(tx, delayed.id, evidence(), admin.id)), /no longer eligible/);
  await new Promise(resolve => setTimeout(resolve, Math.max(0, delayed.paymentDueAt!.getTime() - Date.now()) + 100)); releaseLock(); await holder; await rejectLate;
  assert.equal((await getOrder(delayed.id)).paymentState, "UNPAID"); await p.$transaction(tx => expireOrder(tx, delayed.id));
  pass("verification rechecks real deadline after waiting for order lock");

  const reviewed = await fixture(), partial = { ...evidence(), action: "review" as const, amountCents: 600, note: "Independently checked partial receipt" };
  await p.$transaction(tx => recordPaymentEvidence(tx, reviewed.id, partial, admin.id)); await assert.rejects(p.$transaction(tx => changeOrderStatus(tx, reviewed.id, "PREPARING", admin.id)));
  const refund = { ...partial, action: "refund" as const, providerTransactionId: `refund-${randomUUID()}`, receivedAt: new Date().toISOString(), restock: true };
  await Promise.all([0, 1].map(() => p.$transaction(tx => recordPaymentEvidence(tx, reviewed.id, refund, admin.id)))); assert.equal((await getOrder(reviewed.id)).paymentState, "REFUNDED"); assert.equal(await p.paymentEvent.count({ where: { orderId: reviewed.id, type: "REFUND" } }), 1);
  pass("partial-payment review blocks fulfillment and external-refund replay is idempotent");

  await p.rateLimit.deleteMany();
  await p.orderWindow.update({ where: { id: window.id }, data: { maxOrders: await capacity() + 1 } });
  const capacityCarts = await Promise.all([cart(), cart()]); assert.deepEqual((await Promise.all(capacityCarts.map(cookie => checkout(cookie)))).map(r => r.status).sort(), [200, 400]);
  pass("concurrent HTTP checkout respects last capacity slot");
  await p.orderWindow.update({ where: { id: window.id }, data: { maxOrders: 100 } }); await p.product.update({ where: { id: product.id }, data: { inventoryLimit: 1 } });
  const stockCarts = await Promise.all([cart(), cart()]); assert.deepEqual((await Promise.all(stockCarts.map(cookie => checkout(cookie)))).map(r => r.status).sort(), [200, 400]); assert.equal(await stock(), 0);
  pass("concurrent HTTP checkout cannot oversell last stock unit");

  await p.product.update({ where: { id: product.id }, data: { inventoryLimit: 100 } });
  const zone = await p.deliveryZone.create({ data: { name: "Synthetic zone", zipCodes: ["12345"], feeCents: 350, instructions: "Synthetic handoff" } });
  const deliveryInput = { ...input, fulfillmentType: "DELIVERY", deliveryZoneId: zone.id, deliveryAddress: "Synthetic address", deliveryZip: "12345" }, deliveryGuest = await cart(2);
  await status(await checkout(deliveryGuest, randomUUID(), { ...deliveryInput, deliveryZip: "99999" }), 400); await p.deliveryZone.update({ where: { id: zone.id }, data: { active: false } }); await status(await checkout(deliveryGuest, randomUUID(), deliveryInput), 400); await p.deliveryZone.update({ where: { id: zone.id }, data: { active: true } });
  const deliveryReceipt = await (await status(await checkout(deliveryGuest, randomUUID(), { ...deliveryInput, totalCents: 1, deliveryFeeCents: 0, currency: "EUR", paymentDestination: "https://untrusted.example/pay", paymentHandle: "@attacker", status: "PAID" }), 200)).json();
  const delivery = await p.order.findUniqueOrThrow({ where: { id: deliveryReceipt.orderId }, include: { items: true } });
  assert.equal(delivery.totalCents, 2350); assert.equal(delivery.deliveryFeeCents, 350); assert.equal(delivery.items[0].quantity, 2); assert.equal(delivery.items[0].unitPriceCents, 1000); assert.equal(delivery.paymentDestination, config.VENMO_DESTINATION); assert.equal(delivery.paymentHandle, config.VENMO_HANDLE); assert.equal(delivery.currency, "USD"); assert.equal(delivery.status, "PENDING");
  pass("canonical delivery quantity/fee, invalid ZIP/inactive zone and client tampering");

  await status(await request("/api/admin/setup", { values: [{ key: "VENMO_HANDLE", value: "@Synthetic-QA-New" }, { key: "VENMO_DESTINATION", value: "https://venmo.com/Synthetic-QA-New" }, { key: "VENMO_DESTINATION_VERIFIED", value: "true" }, { key: "VENMO_CHECKOUT_ENABLED", value: "true" }] }, adminCookie), 200);
  for (const key of ["VENMO_CHECKOUT_ENABLED", "VENMO_DESTINATION_VERIFIED"]) assert.equal((await p.appConfig.findUniqueOrThrow({ where: { key } })).value, "false"); assert.equal((await p.appConfig.findUniqueOrThrow({ where: { key: "VENMO_VERIFIED_FINGERPRINT" } })).value, "");
  const blockedGuest = await cart(); await status(await checkout(blockedGuest), 503); assert.equal((await getOrder(delivery.id)).paymentDestination, config.VENMO_DESTINATION); await restoreConfig();
  await p.product.update({ where: { id: product.id }, data: { priceCents: 1100 } }); await p.deliveryZone.update({ where: { id: zone.id }, data: { feeCents: 999 } }); assert.equal((await getOrder(delivery.id)).totalCents, 2350); assert.equal((await getOrder(delivery.id)).deliveryFeeCents, 350); await p.product.update({ where: { id: product.id }, data: { priceCents: 1000 } });
  pass("admin destination change revokes readiness while existing prices/destination remain immutable");

  const due = await fixture(-1); await p.orderWindow.update({ where: { id: window.id }, data: { maxOrders: await capacity() } }); await status(await checkout(blockedGuest), 200); assert.equal((await getOrder(due.id)).status, "CANCELLED"); await p.orderWindow.update({ where: { id: window.id }, data: { maxOrders: 100 } });
  pass("expired reservations release full-window capacity before checkout selection");

  const cancelled = await fixture(), beforeCancellation = await stock(); await Promise.all([0, 1, 2].map(() => p.$transaction(tx => changeOrderStatus(tx, cancelled.id, "CANCELLED", admin.id)))); assert.equal(await stock(), beforeCancellation + 1); assert.equal(await p.paymentEvent.count({ where: { orderId: cancelled.id, type: "CANCELLED" } }), 1);
  const race = await fixture(), beforeRace = await stock(), raceEvidence = evidence(); const outcomes = await Promise.allSettled([p.$transaction(tx => changeOrderStatus(tx, race.id, "CANCELLED", admin.id)), p.$transaction(tx => recordPaymentEvidence(tx, race.id, raceEvidence, admin.id))]); assert.equal(outcomes.filter(r => r.status === "fulfilled").length, 1);
  const raced = await getOrder(race.id); assert.ok(["PAID", "CANCELLED"].includes(raced.status)); assert.equal(raced.inventoryRestored, raced.status === "CANCELLED"); assert.equal(await stock(), beforeRace + (raced.status === "CANCELLED" ? 1 : 0));
  pass("cancellation restores once and serializes against payment verification");

  await assert.rejects(p.$transaction(tx => changeOrderStatus(tx, first.id, "READY", admin.id))); for (const next of ["PREPARING", "READY"] as const) await p.$transaction(tx => changeOrderStatus(tx, first.id, next, admin.id)); await assert.rejects(p.$transaction(tx => changeOrderStatus(tx, first.id, "OUT_FOR_DELIVERY", admin.id))); await p.$transaction(tx => changeOrderStatus(tx, first.id, "COMPLETED", admin.id));
  await p.$transaction(tx => recordPaymentEvidence(tx, delivery.id, { ...evidence(), amountCents: 2350 }, admin.id)); for (const next of ["PREPARING", "READY", "OUT_FOR_DELIVERY", "COMPLETED"] as const) await p.$transaction(tx => changeOrderStatus(tx, delivery.id, next, admin.id));
  pass("verified pickup/delivery follow guarded fulfillment sequence");

  const completedCapacity = await capacity(), completedStock = await stock(); await p.$transaction(tx => recordPaymentEvidence(tx, delivery.id, { ...evidence(), action: "refund", amountCents: 2350, note: "External refund after completed delivery", restock: false }, admin.id));
  assert.equal((await getOrder(delivery.id)).status, "COMPLETED"); assert.equal((await getOrder(delivery.id)).paymentState, "REFUNDED"); assert.equal((await getOrder(delivery.id)).inventoryRestored, false); assert.equal(await capacity(), completedCapacity); assert.equal(await stock(), completedStock);
  pass("completed-order refund preserves fulfilled history, capacity and stock");

  for (const scenario of [{ id: first.id, amount: 200, priorBalance: 1000, state: "REVIEW" }, { id: delivery.id, amount: 500, priorBalance: 0, state: "REFUNDED" }, { id: reviewed.id, amount: 300, priorBalance: 0, state: "REFUNDED" }]) {
    const before = await getOrder(scenario.id), beforeCapacity = await capacity(), beforeStock = await stock(); const extra = { ...evidence(), action: "review" as const, amountCents: scenario.amount, note: "Checked extra incoming receipt after closure" };
    await p.$transaction(tx => recordPaymentEvidence(tx, scenario.id, extra, admin.id)); await p.$transaction(tx => recordPaymentEvidence(tx, scenario.id, extra, admin.id)); assert.equal(await p.paymentEvent.count({ where: { providerTransactionId: extra.providerTransactionId.toUpperCase() } }), 1);
    assert.equal((await getOrder(scenario.id)).status, before.status); await assert.rejects(p.$transaction(tx => recordPaymentEvidence(tx, scenario.id, evidence(), admin.id)));
    const refundExtra = { ...evidence(), action: "refund" as const, amountCents: scenario.amount, note: "External refund of new receipt", restock: false };
    await assert.rejects(p.$transaction(tx => recordPaymentEvidence(tx, scenario.id, { ...refundExtra, amountCents: scenario.priorBalance + scenario.amount + 1 }, admin.id))); await p.$transaction(tx => recordPaymentEvidence(tx, scenario.id, refundExtra, admin.id));
    const after = await getOrder(scenario.id); assert.equal(after.status, before.status); assert.equal(after.inventoryRestored, before.inventoryRestored); assert.equal(after.paymentState, scenario.state); assert.equal(await capacity(), beforeCapacity); assert.equal(await stock(), beforeStock);
  }
  pass("late receipts after completed/refunded/cancelled orders append safely with bounded refunds and no reactivation");

  for (const mismatch of [{ amountCents: 900, currency: "USD" }, { amountCents: 1100, currency: "USD" }, { amountCents: 1000, currency: "EUR" }]) {
    const order = await fixture(), wrong = { ...evidence(), ...mismatch }; await assert.rejects(p.$transaction(tx => recordPaymentEvidence(tx, order.id, wrong, admin.id)));
    await p.$transaction(tx => recordPaymentEvidence(tx, order.id, { ...wrong, action: "review", note: "Independently checked discrepancy" }, admin.id)); assert.equal((await getOrder(order.id)).paymentState, "REVIEW"); await assert.rejects(p.$transaction(tx => changeOrderStatus(tx, order.id, "PREPARING", admin.id)));
    await assert.rejects(p.$transaction(tx => recordPaymentEvidence(tx, order.id, { ...evidence(), action: "refund", currency: wrong.currency, amountCents: wrong.amountCents + 1, note: "Overshoot", restock: false }, admin.id)));
  }
  pass("partial/excess/foreign-currency evidence stays reviewed and over-refund rejected");

  const rollbackGuest = await cart(), rollbackKey = randomUUID(), originalOrders = await p.order.count(), originalEmails = await p.emailJob.count(), originalStock = await stock(), originalCart = await p.cartItem.count();
  await p.$executeRawUnsafe(`CREATE FUNCTION qa_reject_email() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic forced email queue failure'; END $$`); await p.$executeRawUnsafe(`CREATE TRIGGER qa_reject_email BEFORE INSERT ON "EmailJob" FOR EACH ROW EXECUTE FUNCTION qa_reject_email()`);
  try { await status(await checkout(rollbackGuest, rollbackKey), 400); assert.equal(await p.order.count(), originalOrders); assert.equal(await p.emailJob.count(), originalEmails); assert.equal(await stock(), originalStock); assert.equal(await p.cartItem.count(), originalCart); }
  finally { await p.$executeRawUnsafe(`DROP TRIGGER qa_reject_email ON "EmailJob"`); await p.$executeRawUnsafe(`DROP FUNCTION qa_reject_email()`); }
  await status(await checkout(rollbackGuest, rollbackKey), 200);
  pass("forced queue failure rolls back order/cart/stock and same-key retry succeeds");

  for (const path of ["/api/cart", "/api/checkout", "/api/checkout/recover", "/api/auth/logout", `/api/admin/orders/${first.id}/payment`]) await status(await request(path, {}, adminCookie, "POST", { Origin: "https://untrusted.example" }), 403);
  await status(await request("/api/cart", { padding: "x".repeat(70000) }), 413);
  pass("cross-origin mutations and oversized request bodies fail closed");

  await p.appConfig.update({ where: { key: "SMTP_HOST" }, data: { value: "" } });
  const known = await status(await request("/api/auth/forgot-password", { email: customer.email }), 200), unknown = await status(await request("/api/auth/forgot-password", { email: "absent@example.invalid" }), 200); assert.deepEqual(await known.json(), await unknown.json());
  await status(await request("/api/auth/change-password", { currentPassword: password, password: "Changed-synthetic-password-2026" }, customerCookie), 200); await status(await request("/api/auth/change-password", { currentPassword: "Changed-synthetic-password-2026", password }, customerCookie), 401);
  const resetToken = randomUUID().replaceAll("-", "").repeat(2); await p.passwordReset.create({ data: { tokenHash: createHash("sha256").update(resetToken).digest("hex"), userId: admin.id, expiresAt: new Date(Date.now() + 60000) } });
  await status(await request("/api/auth/reset-password", { token: resetToken, password }), 200); await status(await request("/api/auth/reset-password", { token: resetToken, password }), 400); await status(await request(`/api/admin/orders/${first.id}/payment`, firstEvidence, adminCookie), 307);
  pass("missing SMTP exposes no reset link/account; password change/reset revoke sessions; reset replay rejected");
  const freshAdmin = await login(admin.email); await status(await request("/api/auth/logout", undefined, freshAdmin), 303); await status(await request(`/api/admin/orders/${first.id}/payment`, firstEvidence, freshAdmin), 307);
  pass("logout revokes replay of admin cookie");

  const pending = await p.emailJob.findFirstOrThrow({ where: { status: "PENDING" }, orderBy: { createdAt: "asc" } }); await processEmailQueue(); const queued = await p.emailJob.findUniqueOrThrow({ where: { id: pending.id } }); assert.equal(queued.status, "PENDING"); assert.equal(queued.attempts, 1); assert.ok(queued.lastError);
  pass("missing SMTP retains retryable notification without external delivery");
  console.log(`ALL ${groups} RECONSTRUCTED INTEGRATION GROUPS PASSED`);
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => p.$disconnect());
