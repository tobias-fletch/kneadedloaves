import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { ResendStatus, SetupSettingsForm } from "../components/SetupSettingsForm";
import { getSetupConfigSummary, legacyUnusedSetupKeys, setupConfigKeys } from "../lib/app-config";
import { prisma } from "../lib/prisma";
import { destinationFingerprint, paymentConfigKeys } from "../lib/manual-payment-config";
import { getSetupChecklist } from "../lib/setup-checklist";
import { resetWeeklyTableCache } from "../lib/order-window";
import { DEFAULT_WEEKLY_SETTINGS } from "../lib/weekly-window";
import AdminEmailPage from "../app/admin/email/page";

function stub(t: TestContext, target: object, key: string, implementation: (...args: unknown[]) => unknown) {
  const original = Reflect.get(target, key);
  Reflect.set(target, key, implementation);
  t.after(() => { Reflect.set(target, key, original); });
}
function fixture(t: TestContext) {
  const previousKey = process.env.CONFIG_ENCRYPTION_KEY;
  process.env.CONFIG_ENCRYPTION_KEY = "ab".repeat(32);
  t.after(() => { if (previousKey === undefined) delete process.env.CONFIG_ENCRYPTION_KEY; else process.env.CONFIG_ENCRYPTION_KEY = previousKey; });
  for (const key of [...setupConfigKeys, "VENMO_VERIFIED_FINGERPRINT", "NEXT_PUBLIC_APP_URL", "ADMIN_NOTIFY_EMAIL"]) {
    const before = process.env[key];
    delete process.env[key];
    t.after(() => { if (before === undefined) delete process.env[key]; else process.env[key] = before; });
  }
  const values: Record<string, string> = {
    VENMO_CHECKOUT_ENABLED: "true", VENMO_HANDLE: "@test-bakery", VENMO_DESTINATION: "https://www.venmo.com/u/test-bakery",
    VENMO_DESTINATION_VERIFIED: "true", PAYMENT_HOLD_MINUTES: "30", PAYMENT_WORKERS_READY: "true", CHECKOUT_SMOKE_TESTED: "true",
    APP_URL: "https://shop.example.test", JWT_SECRET: "fixture-session-secret-over-32-characters"
  };
  // Site email is configured by RESEND_API_KEY alone (a placeholder; nothing is sent).
  const previousResend = process.env.RESEND_API_KEY;
  process.env.RESEND_API_KEY = "re_test_placeholder_not_real";
  t.after(() => { if (previousResend === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = previousResend; });
  values.VENMO_VERIFIED_FINGERPRINT = destinationFingerprint(values.VENMO_HANDLE, values.VENMO_DESTINATION);
  stub(t, prisma.appConfig, "findMany", async () => Object.entries(values).map(([key, value]) => ({ key, value, secret: false })));
  stub(t, prisma.adminSettings, "findFirst", async () => ({ notificationEmail: "owner@example.test", instagramHandle: "test-bakery" }));
  const previousOrigin = process.env.KL_ORIGIN_LATLNG;
  process.env.KL_ORIGIN_LATLNG = "10.123456,-30.654321"; // made-up test coordinates
  t.after(() => { if (previousOrigin === undefined) delete process.env.KL_ORIGIN_LATLNG; else process.env.KL_ORIGIN_LATLNG = previousOrigin; });
  for (const target of [prisma.product, prisma.productImage, prisma.orderWindow, prisma.pickupLocation, prisma.emailSubscriber]) stub(t, target, "count", async () => 1);
  // No weekly tables unless a test turns them on.
  resetWeeklyTableCache();
  t.after(resetWeeklyTableCache);
  stub(t, prisma, "$queryRaw", async () => [{ ready: false }]);
  return values;
}

test("manual-ready checklist needs neither Stripe credentials nor legacy email templates", async t => {
  fixture(t);
  const result = await getSetupChecklist();
  assert.deepEqual(result.incomplete, []);
  assert.equal(result.completeCount, result.totalCount);
});

test("distance delivery checklist item reports a missing origin without disclosing it", async t => {
  fixture(t);
  delete process.env.KL_ORIGIN_LATLNG;
  const result = await getSetupChecklist();
  const item = result.incomplete.find(entry => entry.id === "delivery-distance");
  assert.ok(item);
  assert.match(item.detail, /Free delivery within 1 mile, \$6 up to 3 miles\./);
  assert.doesNotMatch(JSON.stringify(result), /10\.123456|-30\.654321/);
});

test("every operational payment gate keeps the checklist incomplete without disclosing secrets", async t => {
  const values = fixture(t);
  for (const key of paymentConfigKeys) {
    const original = values[key];
    values[key] = "";
    const result = await getSetupChecklist();
    assert.ok(result.incomplete.some(item => item.id === "manual-venmo-readiness"), key);
    assert.doesNotMatch(JSON.stringify(result), /fixture-session-secret|fixture-smtp-secret|fixture-smtp-user|Stripe/);
    values[key] = original;
  }
});

test("destination changes invalidate readiness and ignored legacy templates cannot satisfy email tests", async t => {
  const values = fixture(t);
  values.VENMO_DESTINATION = "https://venmo.com/u/changed-bakery";
  values.PAYMENT_WORKERS_READY = "false";
  Object.assign(values, { EMAIL_PICKUP_SUBJECT: "Legacy", EMAIL_PICKUP_BODY: "Legacy", EMAIL_DELIVERY_SUBJECT: "Legacy", EMAIL_DELIVERY_BODY: "Legacy" });
  const result = await getSetupChecklist();
  assert.match(result.incomplete.find(item => item.id === "manual-venmo-readiness")!.detail, /verify the current receiving destination/);
  assert.match(result.incomplete.find(item => item.id === "lifecycle-email-test")!.detail, /Legacy pickup and delivery templates are not used/);
});

test("legacy pickup/delivery email templates are never flagged as missing on /admin/setup", async t => {
  const legacy = ["EMAIL_PICKUP_SUBJECT", "EMAIL_PICKUP_BODY", "EMAIL_DELIVERY_SUBJECT", "EMAIL_DELIVERY_BODY"];
  assert.deepEqual([...legacyUnusedSetupKeys].sort(), [...legacy].sort());
  const router = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} } as AppRouterInstance;
  const values = fixture(t);
  // Unset (the reported case) and saved legacy values both leave the fields hidden and unflagged.
  for (const saved of [false, true]) {
    for (const key of legacy) { if (saved) values[key] = "Legacy"; else delete values[key]; }
    const summary = await getSetupConfigSummary();
    for (const key of legacy) assert.ok(!summary.some(field => field.key === key), `${key} hidden (saved=${saved})`);
    assert.ok(summary.some(field => field.key === "VENMO_HANDLE"), "other setup fields still shown");
    const checklist = JSON.stringify(await getSetupChecklist());
    for (const key of legacy) assert.doesNotMatch(checklist, new RegExp(key));
    const html = renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: router }, createElement(SetupSettingsForm, { fields: summary, emailStatus: { resendConfigured: true } })));
    assert.doesNotMatch(html, /Pickup email|Delivery email|EMAIL_PICKUP|EMAIL_DELIVERY/);
    assert.doesNotMatch(html, />Missing</);
    assert.match(html, /<h2[^>]*>Email<\/h2>/);
    assert.match(html, /data-testid="resend-status"/);
    assert.match(html, /built-in wording/);
  }
  // The keys stay valid setup keys, so saved rows and the save API are unchanged.
  for (const key of legacy) assert.ok((setupConfigKeys as readonly string[]).includes(key), key);
});

test("checklist requires RESEND_API_KEY for email and rejects noncanonical or local launch URLs", async t => {
  const values = fixture(t);
  assert.ok(!(await getSetupChecklist()).incomplete.some(item => item.id === "email-provider"));
  delete process.env.RESEND_API_KEY;
  const withoutResend = await getSetupChecklist();
  const emailItem = withoutResend.incomplete.find(item => item.id === "email-provider");
  assert.ok(emailItem);
  assert.match(emailItem.detail, /RESEND_API_KEY/);
  assert.doesNotMatch(emailItem.detail, /SMTP|Gmail|TLS email/);
  assert.ok(withoutResend.incomplete.some(item => item.id === "lifecycle-email-test"));
  process.env.RESEND_API_KEY = "re_test_placeholder_not_real";
  for (const value of ["http://shop.example.test", "https://localhost", "https://127.0.0.1", "https://user:pass@shop.example.test", "https://shop.example.test/path", "https://shop.example.test?token=x"]) {
    values.APP_URL = value;
    assert.ok((await getSetupChecklist()).incomplete.some(item => item.id === "public-url"), value);
  }
});

const incompleteIds = async () => (await getSetupChecklist()).incomplete.map(item => item.id);

test("a weekly schedule counts as a scheduled ordering window without creating one", async t => {
  fixture(t);
  stub(t, prisma.orderWindow, "count", async () => 0);
  assert.ok((await incompleteIds()).includes("order-window"));

  let weekly = { ...DEFAULT_WEEKLY_SETTINGS, enabled: true, closeTime: "13:00" };
  resetWeeklyTableCache();
  stub(t, prisma, "$queryRaw", async () => [{ ready: true }]);
  stub(t, prisma.weeklyOrderSchedule, "findUnique", async () => ({ id: "default", ...weekly }));
  stub(t, prisma.weeklyOrderWeek, "findMany", async () => []);
  for (const method of ["create", "update", "upsert", "createMany", "updateMany"]) {
    stub(t, prisma.orderWindow, method, async () => { throw new Error("checklist must not write order windows"); });
  }
  assert.ok(!(await incompleteIds()).includes("order-window"));

  weekly = { ...weekly, enabled: false };
  assert.ok((await incompleteIds()).includes("order-window"));
});

test("notification settings are complete when admin order alerts go to ADMIN_NOTIFY_EMAIL", async t => {
  fixture(t);
  stub(t, prisma.adminSettings, "findFirst", async () => ({ notificationEmail: null, emailNotificationsEnabled: false, instagramHandle: null }));
  const missing = (await getSetupChecklist()).incomplete.find(item => item.id === "notification-settings");
  assert.ok(missing);

  process.env.ADMIN_NOTIFY_EMAIL = "kneadedloaves@gmail.com";
  assert.ok(!(await incompleteIds()).includes("notification-settings"));
  process.env.ADMIN_NOTIFY_EMAIL = "admin@bakery.local";
  assert.ok((await incompleteIds()).includes("notification-settings"));
});

test("the footer Instagram link completes social links; Facebook is not needed", async t => {
  fixture(t);
  stub(t, prisma.adminSettings, "findFirst", async () => ({ notificationEmail: "owner@example.test", instagramHandle: null, facebookHandle: null }));
  assert.ok(!(await incompleteIds()).includes("social-handles"));
});

test("email admin renders truthful lifecycle and no legacy template panel or editor", async t => {
  stub(t, prisma.emailJob, "findMany", async () => [{ id: "test-job", to: "customer@example.test", status: "FAILED", attempts: 1, lastError: "test delivery error" }]);
  const html = renderToStaticMarkup(await AdminEmailPage());
  assert.match(html, /reservation received and awaiting payment/);
  assert.match(html, /payment verified after independent bakery verification/);
  assert.match(html, /Sending an email does not verify payment/);
  assert.doesNotMatch(html, /Legacy email templates/);
  assert.doesNotMatch(html, /<textarea|name="pickupSubject"|name="deliverySubject"|Save templates|Edit the confirmation emails/);
  assert.match(html, /action="\/api\/admin\/email\/retry"/);
  assert.match(html, /Retry delivery/);
});

test("Resend status badge shows configured state without exposing the key", () => {
  const off = renderToStaticMarkup(createElement(ResendStatus, { status: { resendConfigured: false } }));
  const on = renderToStaticMarkup(createElement(ResendStatus, { status: { resendConfigured: true } }));
  assert.match(off, /data-testid="resend-status"/);
  assert.match(off, /Not configured/);
  assert.match(on, />Configured</);
  for (const html of [on, off]) assert.doesNotMatch(html, /SMTP|Gmail|re_[A-Za-z0-9]/);
});
