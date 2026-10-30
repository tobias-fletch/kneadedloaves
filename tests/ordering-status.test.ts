import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AddToCartButton } from "../components/AddToCartButton";
import { CheckoutForm } from "../components/CheckoutForm";
import { OrderingBadge, OrderingUnavailableNotice, PickupAreaNote } from "../components/OrderingStatus";
import { BAKERY_CONTACT_EMAIL } from "../lib/config-messages";
import { destinationFingerprint } from "../lib/manual-payment-config";
import { orderingAvailability } from "../lib/ordering-status";
import { prisma } from "../lib/prisma";
import { getStorefrontOrderingState } from "../lib/storefront-ordering";

function stub(t: TestContext, target: object, key: string, implementation: (...args: unknown[]) => unknown) {
  const original = Reflect.get(target, key);
  Reflect.set(target, key, implementation);
  t.after(() => { Reflect.set(target, key, original); });
}

// Site email readiness comes from RESEND_API_KEY in the environment (never its value). Each test
// file runs in its own process, so this placeholder does not leak; nothing here sends email.
process.env.RESEND_API_KEY ||= "re_test_placeholder_not_real";

function readyConfig() {
  const values: Record<string, string> = {
    VENMO_CHECKOUT_ENABLED: "true", VENMO_HANDLE: "@kneadedloaves", VENMO_DESTINATION: "https://www.venmo.com/u/kneadedloaves",
    VENMO_DESTINATION_VERIFIED: "true", PAYMENT_HOLD_MINUTES: "60", PAYMENT_WORKERS_READY: "true", CHECKOUT_SMOKE_TESTED: "true",
    APP_URL: "https://kneadedloaves.com", JWT_SECRET: "fixture-session-secret-over-32-characters",
    RESEND_CONFIGURED: "true"
  };
  values.VENMO_VERIFIED_FINGERPRINT = destinationFingerprint(values.VENMO_HANDLE, values.VENMO_DESTINATION);
  return values;
}

function openWindow() {
  return {
    id: "window-test", manualClosed: false, manualOpen: true, opensAt: new Date(Date.now() - 60_000),
    closesAt: new Date(Date.now() + 86_400_000), fulfillmentDate: new Date(Date.now() + 172_800_000), maxOrders: null, orders: []
  };
}

test("orders are open only when the window is open and checkout readiness passes", () => {
  assert.deepEqual(orderingAvailability(true, true), { orderingOpen: true, unavailable: false });
  assert.deepEqual(orderingAvailability(true, false), { orderingOpen: false, unavailable: true });
  assert.deepEqual(orderingAvailability(false, false), { orderingOpen: false, unavailable: false });
  assert.deepEqual(orderingAvailability(false, true), { orderingOpen: false, unavailable: false });
});

test("unavailable ordering hides Orders Open, shows the bakery email, and disables cart actions", () => {
  const html = renderToStaticMarkup(createElement("section", null,
    createElement(OrderingBadge, { orderingOpen: false, unavailable: true }),
    createElement(OrderingUnavailableNotice, { email: BAKERY_CONTACT_EMAIL }),
    createElement(PickupAreaNote, null),
    createElement(AddToCartButton, { productId: "loaf", disabled: true }),
    createElement(CheckoutForm, { pickupLocations: [], checkoutReady: false, contactEmail: BAKERY_CONTACT_EMAIL, hasCartItems: true })
  ));
  assert.match(html, /Ordering unavailable/);
  assert.match(html, /Online ordering isn(?:'|&#x27;)t available right now/);
  assert.match(html, /kneadedloaves@gmail\.com/);
  assert.match(html, /S Portland Ave &amp; Atlantic Ave, Brooklyn, NY 11217/);
  assert.match(html, /The bakery confirms the exact spot after payment/);
  assert.match(html, /disabled=""/);
  assert.doesNotMatch(html, /Orders Open/);
  assert.doesNotMatch(html, /example\.com|CONTACT_PHONE|Phone not set|tel:/);
});

test("a ready open window can say Orders Open", () => {
  const html = renderToStaticMarkup(createElement(OrderingBadge, { orderingOpen: true, unavailable: false }));
  assert.match(html, /Orders Open/);
  assert.doesNotMatch(html, /Ordering unavailable/);
});

test("storefront state uses checkout readiness, not the order window alone", async (t) => {
  const values = readyConfig();
  stub(t, prisma.appConfig, "findMany", async () => Object.entries(values).map(([key, value]) => ({ key, value, secret: false })));
  stub(t, prisma.adminSettings, "findFirst", async () => ({ bakeryName: "Kneaded Loaves", notificationEmail: "orders@example.com", instagramHandle: "" }));
  stub(t, prisma.order, "findMany", async () => []);
  stub(t, prisma.orderWindow, "findMany", async () => [openWindow()]);
  const open = await getStorefrontOrderingState();
  assert.equal(open.checkoutReady, true);
  assert.equal(open.orderingOpen, true);
  assert.equal(open.unavailable, false);
  assert.equal(open.contact.email, BAKERY_CONTACT_EMAIL);
  values.VENMO_CHECKOUT_ENABLED = "false";
  const paused = await getStorefrontOrderingState();
  assert.equal(paused.checkoutReady, false);
  assert.equal(paused.publicCheckoutReady, false);
  assert.equal(paused.orderingOpen, false);
  assert.equal(paused.unavailable, true);
  assert.equal(paused.adminTestMode, false);
  assert.deepEqual(paused.adminSetupReasons, []);
  const customer = await getStorefrontOrderingState(false);
  assert.equal(customer.checkoutReady, false);
  assert.equal(customer.unavailable, true);
  assert.equal(customer.adminTestMode, false);
  stub(t, prisma.orderWindow, "findMany", async () => []);
  values.VENMO_CHECKOUT_ENABLED = "true";
  const closed = await getStorefrontOrderingState();
  assert.equal(closed.orderingOpen, false);
  assert.equal(closed.unavailable, false);
});
