import test from "node:test";
import assert from "node:assert/strict";
import { adminNotificationRecipient } from "../lib/admin-notify";

test("enabled setting with a real address wins over the env fallback", () => {
  assert.equal(adminNotificationRecipient({ emailNotificationsEnabled: true, notificationEmail: " owner@example.com " }, { ADMIN_NOTIFY_EMAIL: "env@example.com" }), "owner@example.com");
});

test("disabled or empty setting falls back to ADMIN_NOTIFY_EMAIL", () => {
  const env = { ADMIN_NOTIFY_EMAIL: "kneadedloaves@gmail.com" };
  assert.equal(adminNotificationRecipient({ emailNotificationsEnabled: false, notificationEmail: "owner@example.com" }, env), "kneadedloaves@gmail.com");
  assert.equal(adminNotificationRecipient({ emailNotificationsEnabled: true, notificationEmail: "" }, env), "kneadedloaves@gmail.com");
  assert.equal(adminNotificationRecipient(null, env), "kneadedloaves@gmail.com");
});

test("seed placeholder .local address is never used", () => {
  assert.equal(adminNotificationRecipient({ emailNotificationsEnabled: true, notificationEmail: "admin@bakery.local" }, {}), null);
  assert.equal(adminNotificationRecipient({ emailNotificationsEnabled: true, notificationEmail: "admin@bakery.local" }, { ADMIN_NOTIFY_EMAIL: "kneadedloaves@gmail.com" }), "kneadedloaves@gmail.com");
});

test("no setting and no env keeps today's behavior: no admin alert", () => {
  assert.equal(adminNotificationRecipient({ emailNotificationsEnabled: false, notificationEmail: null }, {}), null);
  assert.equal(adminNotificationRecipient(undefined, { ADMIN_NOTIFY_EMAIL: "not-an-email" }), null);
});
