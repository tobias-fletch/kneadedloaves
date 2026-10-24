import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { adminNotifyOverride, queueAdminOrderFallback } from "../lib/admin-notify";

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
  assert.ok(maintenance.indexOf("queueAdminOrderFallback(orderId)") < maintenance.indexOf("processEmailQueue({ dedupeSuffix"));
});
