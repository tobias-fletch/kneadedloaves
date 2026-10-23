import assert from "node:assert/strict";
import test from "node:test";
import { mailerSettings, messageIdDomain } from "../lib/email-queue";

const gmail = {
  SMTP_HOST: "smtp.gmail.com",
  SMTP_USER: "kneadedloaves@gmail.com",
  SMTP_PASSWORD: "app-password",
  EMAIL_FROM: "Kneaded Loaves <kneadedloaves@gmail.com>"
};

test("Gmail 465 uses implicit TLS and accepts a display-name From", () => {
  const settings = mailerSettings({ ...gmail, SMTP_PORT: "465" });
  assert.equal(settings.options.secure, true);
  assert.equal(settings.options.requireTLS, false);
  assert.equal(settings.options.port, 465);
  assert.equal(settings.options.host, "smtp.gmail.com");
  assert.equal(settings.from, "Kneaded Loaves <kneadedloaves@gmail.com>");
  assert.equal(settings.options.auth.user, "kneadedloaves@gmail.com");
  assert.equal(messageIdDomain(settings.from), "gmail.com");
});

test("Gmail 587 and 2525 require STARTTLS", () => {
  for (const port of ["587", "2525"]) {
    const settings = mailerSettings({ ...gmail, SMTP_PORT: port });
    assert.equal(settings.options.secure, false);
    assert.equal(settings.options.requireTLS, true);
    assert.equal(settings.options.port, Number(port));
  }
});

test("Gmail rejects a From mailbox that does not match the authenticated account", () => {
  assert.throws(() => mailerSettings({ ...gmail, SMTP_PORT: "465", EMAIL_FROM: "other@gmail.com" }), /EMAIL_FROM address to match SMTP_USER/);
  const otherHost = mailerSettings({ ...gmail, SMTP_HOST: "smtp.example.test", SMTP_PORT: "587", EMAIL_FROM: "Bakery <orders@kneadedloaves.com>" });
  assert.equal(otherHost.from, "Bakery <orders@kneadedloaves.com>");
});
