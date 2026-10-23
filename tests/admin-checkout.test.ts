import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AddToCartButton } from "../components/AddToCartButton";
import { CheckoutForm } from "../components/CheckoutForm";
import { AdminOrderingBanner, OrderingBadge, OrderingUnavailableNotice } from "../components/OrderingStatus";
import { ADMIN_CHECKOUT_BLOCKED_LEAD, ADMIN_TEST_MODE_BANNER, BAKERY_CONTACT_EMAIL, ORDERING_UNAVAILABLE_MESSAGE } from "../lib/config-messages";
import { adminCheckoutReadiness, destinationFingerprint, isAdminTestOrder, paymentReadiness } from "../lib/manual-payment-config";
import { prisma } from "../lib/prisma";
import { getStorefrontOrderingState } from "../lib/storefront-ordering";

const launchKeys = ["VENMO_CHECKOUT_ENABLED", "PAYMENT_WORKERS_READY", "CHECKOUT_SMOKE_TESTED"] as const;
const launchReasons = new Set([
  "Venmo checkout is disabled.",
  "Expiry and email workers must be configured and tested.",
  "Checkout testing must be confirmed."
]);

function readyConfig() {
  const values: Record<string, string> = {
    VENMO_CHECKOUT_ENABLED: "true", VENMO_HANDLE: "@kneadedloaves", VENMO_DESTINATION: "https://www.venmo.com/u/kneadedloaves",
    VENMO_DESTINATION_VERIFIED: "true", PAYMENT_HOLD_MINUTES: "60", PAYMENT_WORKERS_READY: "true", CHECKOUT_SMOKE_TESTED: "true",
    APP_URL: "https://kneadedloaves.com", JWT_SECRET: "fixture-session-secret-over-32-characters",
    SMTP_HOST: "smtp.gmail.com", SMTP_PORT: "465", SMTP_USER: "kneadedloaves@gmail.com", SMTP_PASSWORD: "fixture-app-password",
    EMAIL_FROM: "Kneaded Loaves <kneadedloaves@gmail.com>"
  };
  values.VENMO_VERIFIED_FINGERPRINT = destinationFingerprint(values.VENMO_HANDLE, values.VENMO_DESTINATION);
  return values;
}

function launchClosed(values: Record<string, string>): Record<string, string> {
  return { ...values, VENMO_CHECKOUT_ENABLED: "false", PAYMENT_WORKERS_READY: "", CHECKOUT_SMOKE_TESTED: "" };
}

function stub(t: TestContext, target: object, key: string, implementation: (...args: unknown[]) => unknown) {
  const original = Reflect.get(target, key);
  Reflect.set(target, key, implementation);
  t.after(() => { Reflect.set(target, key, original); });
}

test("admin checkout ignores only the three launch flags", () => {
  const values = readyConfig();
  const closed = launchClosed(values);
  assert.equal(paymentReadiness(closed).ready, false);
  assert.equal(adminCheckoutReadiness(closed, false).ready, false);
  assert.equal(adminCheckoutReadiness(closed, true).ready, true);
  assert.deepEqual(adminCheckoutReadiness(closed, true).reasons, []);
  assert.equal(isAdminTestOrder(closed, true), true);
  assert.equal(isAdminTestOrder(closed, false), false);
  assert.equal(isAdminTestOrder(values, true), false);
  for (const key of Object.keys(values)) {
    if ((launchKeys as readonly string[]).includes(key)) {
      assert.equal(adminCheckoutReadiness({ ...values, [key]: "" }, true).ready, true, key);
      continue;
    }
    const blocked = adminCheckoutReadiness({ ...closed, [key]: "" }, true);
    assert.equal(blocked.ready, false, key);
    assert.equal(blocked.reasons.some((reason) => launchReasons.has(reason)), false, key);
    assert.equal(adminCheckoutReadiness({ ...closed, [key]: "" }, false).ready, false, key);
  }
});

test("an unverified Venmo destination still blocks the admin and names the remaining reason", () => {
  const closed = launchClosed(readyConfig());
  closed.VENMO_DESTINATION_VERIFIED = "false";
  const admin = adminCheckoutReadiness(closed, true);
  const customer = adminCheckoutReadiness(closed, false);
  assert.equal(admin.ready, false);
  assert.equal(customer.ready, false);
  assert.deepEqual(admin.reasons, ["The owner must verify the current receiving destination."]);
  assert.equal(customer.reasons.some((reason) => launchReasons.has(reason)), true);
  assert.equal(isAdminTestOrder(closed, true), false);
});

test("signed-out storefront stays unavailable while an admin can use test mode", async (t) => {
  const values = launchClosed(readyConfig());
  stub(t, prisma.appConfig, "findMany", async () => Object.entries(values).map(([key, value]) => ({ key, value, secret: false })));
  stub(t, prisma.adminSettings, "findFirst", async () => ({ bakeryName: "Kneaded Loaves", notificationEmail: "orders@example.com", instagramHandle: "" }));
  stub(t, prisma.order, "findMany", async () => []);
  stub(t, prisma.orderWindow, "findMany", async () => [{
    id: "window-test", manualClosed: false, manualOpen: true, opensAt: new Date(Date.now() - 60_000),
    closesAt: new Date(Date.now() + 86_400_000), fulfillmentDate: new Date(Date.now() + 172_800_000), maxOrders: null, orders: []
  }]);
  const signedOut = await getStorefrontOrderingState();
  assert.equal(signedOut.checkoutReady, false);
  assert.equal(signedOut.orderingOpen, false);
  assert.equal(signedOut.unavailable, true);
  assert.equal(signedOut.adminTestMode, false);
  assert.deepEqual(signedOut.adminSetupReasons, []);
  const admin = await getStorefrontOrderingState(true);
  assert.equal(admin.publicCheckoutReady, false);
  assert.equal(admin.checkoutReady, true);
  assert.equal(admin.orderingOpen, true);
  assert.equal(admin.unavailable, false);
  assert.equal(admin.adminTestMode, true);
  assert.deepEqual(admin.adminSetupReasons, []);
  values.VENMO_DESTINATION_VERIFIED = "";
  const blockedAdmin = await getStorefrontOrderingState(true);
  assert.equal(blockedAdmin.checkoutReady, false);
  assert.equal(blockedAdmin.orderingOpen, false);
  assert.equal(blockedAdmin.adminTestMode, false);
  assert.deepEqual(blockedAdmin.adminSetupReasons, ["The owner must verify the current receiving destination."]);
});

test("admin test banner is exact, and signed-out checkout stays unavailable", () => {
  const banner = renderToStaticMarkup(createElement(AdminOrderingBanner, { testMode: true, reasons: [] }));
  assert.match(banner, /ADMIN TEST MODE: ordering is off for the public\. Orders you place here are real orders in the database; mark paid and cancel them in Admin &gt; Orders\./);
  assert.equal(ADMIN_TEST_MODE_BANNER, "ADMIN TEST MODE: ordering is off for the public. Orders you place here are real orders in the database; mark paid and cancel them in Admin > Orders.");
  const blocked = renderToStaticMarkup(createElement(AdminOrderingBanner, {
    testMode: false,
    reasons: ["The owner must verify the current receiving destination."]
  }));
  assert.match(blocked, /Admin checkout is still blocked\. Fix these in Admin &gt; Setup:/);
  assert.match(blocked, /The owner must verify the current receiving destination\./);
  assert.equal(ADMIN_CHECKOUT_BLOCKED_LEAD, "Admin checkout is still blocked. Fix these in Admin > Setup:");
  assert.doesNotMatch(blocked, /Venmo checkout is disabled|workers must be configured|Checkout testing must be confirmed/);
  const adminCheckout = renderToStaticMarkup(createElement(CheckoutForm, {
    deliveryZones: [], pickupLocations: [], checkoutReady: true, adminTestMode: true, hasCartItems: true, contactEmail: BAKERY_CONTACT_EMAIL
  }));
  assert.match(adminCheckout, /ADMIN TEST MODE:/);
  assert.doesNotMatch(adminCheckout, /Online ordering isn(?:'|&#x27;)t available right now/);
  const publicCheckout = renderToStaticMarkup(createElement("section", null,
    createElement(OrderingBadge, { orderingOpen: false, unavailable: true }),
    createElement(OrderingUnavailableNotice, { email: BAKERY_CONTACT_EMAIL }),
    createElement(AddToCartButton, { productId: "loaf", disabled: true }),
    createElement(CheckoutForm, { deliveryZones: [], pickupLocations: [], checkoutReady: false, hasCartItems: true, contactEmail: BAKERY_CONTACT_EMAIL })
  ));
  assert.match(publicCheckout, /Ordering unavailable/);
  assert.match(publicCheckout, new RegExp(ORDERING_UNAVAILABLE_MESSAGE.replace("'", "(?:'|&#x27;)")));
  assert.match(publicCheckout, /disabled=""/);
  assert.doesNotMatch(publicCheckout, /ADMIN TEST MODE/);
});

test("checkout and storefront decide admin test mode from the session role only", () => {
  const route = readFileSync(new URL("../app/api/checkout/route.ts", import.meta.url), "utf8");
  const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  const layout = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
  assert.match(route, /const isAdmin = session\?\.role === "ADMIN"/);
  assert.match(route, /adminCheckoutReadiness\(config, isAdmin\)/);
  assert.match(route, /adminCheckoutReadiness\(freshConfig, isAdmin\)/);
  assert.match(route, /isAdminTestOrder\(config, isAdmin\) \? "KL-ADMIN-TEST-" : "KL-"/);
  assert.doesNotMatch(route, /searchParams|admin=true|ADMIN_CHECKOUT_TEST|test-mode/);
  assert.match(page, /getStorefrontOrderingState\(session\?\.role === "ADMIN"\)/);
  assert.doesNotMatch(page, /searchParams|revalidate/);
  assert.match(layout, /export const dynamic = "force-dynamic"/);
  assert.match(layout, /storefrontCheckoutAccess\(payment, session\?\.role === "ADMIN"\)/);
  assert.doesNotMatch(layout, /revalidate|Cache-Control/);
  const pages = ["app/page.tsx", "app/layout.tsx", "components/CheckoutForm.tsx", "components/CartDrawerButton.tsx"].map((file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8")).join("\n");
  assert.doesNotMatch(pages, /process\.env\.|searchParams/);
});
