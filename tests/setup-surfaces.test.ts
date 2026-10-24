import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { setupConfigKeys } from "../lib/app-config";
import { prisma } from "../lib/prisma";
import { destinationFingerprint, paymentConfigKeys } from "../lib/manual-payment-config";
import { getSetupChecklist } from "../lib/setup-checklist";
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
  for (const key of [...setupConfigKeys, "VENMO_VERIFIED_FINGERPRINT", "NEXT_PUBLIC_APP_URL"]) {
    const before = process.env[key];
    delete process.env[key];
    t.after(() => { if (before === undefined) delete process.env[key]; else process.env[key] = before; });
  }
  const values: Record<string, string> = {
    VENMO_CHECKOUT_ENABLED: "true", VENMO_HANDLE: "@test-bakery", VENMO_DESTINATION: "https://www.venmo.com/u/test-bakery",
    VENMO_DESTINATION_VERIFIED: "true", PAYMENT_HOLD_MINUTES: "30", PAYMENT_WORKERS_READY: "true", CHECKOUT_SMOKE_TESTED: "true",
    APP_URL: "https://shop.example.test", JWT_SECRET: "fixture-session-secret-over-32-characters",
    SMTP_HOST: "smtp.example.test", SMTP_PORT: "587", SMTP_USER: "fixture-smtp-user", SMTP_PASSWORD: "fixture-smtp-secret", EMAIL_FROM: "bakery@example.test"
  };
  values.VENMO_VERIFIED_FINGERPRINT = destinationFingerprint(values.VENMO_HANDLE, values.VENMO_DESTINATION);
  stub(t, prisma.appConfig, "findMany", async () => Object.entries(values).map(([key, value]) => ({ key, value, secret: false })));
  stub(t, prisma.adminSettings, "findFirst", async () => ({ notificationEmail: "owner@example.test", instagramHandle: "test-bakery" }));
  const previousOrigin = process.env.KL_ORIGIN_LATLNG;
  process.env.KL_ORIGIN_LATLNG = "10.123456,-30.654321"; // made-up test coordinates
  t.after(() => { if (previousOrigin === undefined) delete process.env.KL_ORIGIN_LATLNG; else process.env.KL_ORIGIN_LATLNG = previousOrigin; });
  for (const target of [prisma.product, prisma.productImage, prisma.orderWindow, prisma.pickupLocation, prisma.socialPlatformAccount, prisma.emailSubscriber]) stub(t, target, "count", async () => 1);
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

test("checklist rejects insecure email ports and noncanonical or local launch URLs", async t => {
  const values = fixture(t);
  values.SMTP_PORT = "25";
  assert.ok((await getSetupChecklist()).incomplete.some(item => item.id === "email-provider"));
  for (const value of ["http://shop.example.test", "https://localhost", "https://127.0.0.1", "https://user:pass@shop.example.test", "https://shop.example.test/path", "https://shop.example.test?token=x"]) {
    values.APP_URL = value;
    assert.ok((await getSetupChecklist()).incomplete.some(item => item.id === "public-url"), value);
  }
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
