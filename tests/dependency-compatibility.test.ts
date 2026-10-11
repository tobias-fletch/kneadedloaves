import assert from "node:assert/strict";
import { test } from "node:test";
import nodemailer from "nodemailer";

function offlineTransport() {
  return nodemailer.createTransport({
    streamTransport: true,
    buffer: true,
    newline: "unix",
    disableFileAccess: true,
    disableUrlAccess: true
  });
}

const message = {
  from: "Kneaded Loaves <bakery@example.com>",
  to: "customer@example.com",
  subject: "Your bakery order",
  text: "Your order has been received."
};

test("Nodemailer builds the existing plain-text email format without sending mail", async () => {
  const result = await offlineTransport().sendMail(message);
  assert.deepEqual(result.envelope, {
    from: "bakery@example.com",
    to: ["customer@example.com"]
  });
  assert.match(String(result.message), /Subject: Your bakery order/);
  assert.match(String(result.message), /Your order has been received\./);
});

test("Nodemailer still refuses file-backed message content", async () => {
  await assert.rejects(
    offlineTransport().sendMail({ ...message, text: { path: "./package.json" } }),
    /File access rejected/i
  );
});

test("Nodemailer still refuses URL-backed message content without fetching it", async () => {
  await assert.rejects(
    offlineTransport().sendMail({ ...message, text: { href: "https://example.invalid/email.txt" } }),
    /Url access rejected/i
  );
});
