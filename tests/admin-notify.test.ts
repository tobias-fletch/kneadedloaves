import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { adminNotifyOverride, queueAdminOrderFallback } from "../lib/admin-notify";
import { processOrderEmails } from "../lib/email-maintenance";
import { prisma } from "../lib/prisma";

test("ADMIN_NOTIFY_EMAIL with a real address turns admin alerts on", () => {
  assert.equal(adminNotifyOverride({ ADMIN_NOTIFY_EMAIL: " kneadedloaves@gmail.com " }), "kneadedloaves@gmail.com");
});

test("unset, blank, invalid or .local ADMIN_NOTIFY_EMAIL changes nothing", () => {
  for (const value of [undefined, "", "   ", "not-an-email", "admin@bakery.local", "ADMIN@BAKERY.LOCAL"]) {
    assert.equal(adminNotifyOverride({ ADMIN_NOTIFY_EMAIL: value }), null, String(value));
  }
});

test("without the env var the fallback is a no-op and never touches the database", async () => {
  assert.equal(await queueAdminOrderFallback("order-1", {}), false);
  assert.equal(await queueAdminOrderFallback("order-1", { ADMIN_NOTIFY_EMAIL: "admin@bakery.local" }), false);
});

test("fallback reuses checkout's admin-order dedupe key and runs before the post-checkout send", () => {
  const notify = readFileSync("lib/admin-notify.ts", "utf8");
  const maintenance = readFileSync("lib/email-maintenance.ts", "utf8");
  assert.match(notify, /dedupeKey: `admin-order:\$\{order\.id\}`/);
  assert.match(notify, /renderOrderEmail\("admin-new-order"/);
  assert.match(maintenance, /adminFallback: queueAdminOrderFallback/);
  assert.ok(maintenance.indexOf("deps.adminFallback(orderId)") < maintenance.indexOf("deps.processQueue({ dedupeSuffix"));
});

test("fallback never throws: a database failure is logged and returns false", async () => {
  const original = Object.getOwnPropertyDescriptor(prisma, "order");
  const errors: unknown[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => { errors.push(args.join(" ")); };
  Object.defineProperty(prisma, "order", { configurable: true, value: { findUnique: async () => { throw new Error("db down"); } } });
  try {
    assert.equal(await queueAdminOrderFallback("order-1", { ADMIN_NOTIFY_EMAIL: "kneadedloaves@gmail.com" }), false);
    assert.equal(errors.length, 1);
    assert.doesNotMatch(String(errors[0]), /kneadedloaves@gmail\.com|db down/);
  } finally {
    console.error = originalError;
    if (original) Object.defineProperty(prisma, "order", original); else delete (prisma as unknown as Record<string, unknown>).order;
  }
});

test("order emails still go out when the admin notification throws", async () => {
  const sent: string[] = [];
  const originalError = console.error;
  console.error = () => {};
  try {
    let calls = 0;
    const processed = await processOrderEmails("order-1", 5, {
      adminFallback: async () => { throw new Error("admin alert exploded"); },
      processQueue: async (options?: { dedupeSuffix?: string }) => { if (calls++ === 0) { sent.push(`order-received${options?.dedupeSuffix}`); return 1; } return 0; }
    });
    assert.equal(processed, 1);
    assert.deepEqual(sent, ["order-received:order-1"]);
  } finally {
    console.error = originalError;
  }
});

test("checkout commits and responds before any admin alert work, which is caught", () => {
  const route = readFileSync("app/api/checkout/route.ts", "utf8");
  const commit = route.indexOf("return receiptForOwnedAttempt(tx");
  const deferred = route.indexOf("after(() => processOrderEmails(orderId).catch(");
  const respond = route.indexOf('return NextResponse.json({ message: "Reservation received.');
  assert.ok(commit > 0 && deferred > commit && respond > deferred, "admin alert runs only in after(), outside the order transaction");
  assert.equal(route.split("processOrderEmails(").length - 1, 1);
  assert.doesNotMatch(route, /queueAdminOrderFallback|ADMIN_NOTIFY_EMAIL/);
});
