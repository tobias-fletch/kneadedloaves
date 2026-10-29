import assert from "node:assert/strict";
import test from "node:test";
import { emailDeliveryMessage, mailerSettings } from "../lib/email-queue";
import { readStoredConfig } from "../lib/app-config";
import {
  EMAIL_REPLY_TO,
  MAIL_CONFIG_KEYS,
  PREVIEW_ALLOWED_RECIPIENTS,
  PreviewRecipientBlockedError,
  RESEND_EMAIL_FROM,
  allowedSenderMailbox,
  assertPreviewRecipients,
  mailProvider,
  previewAllowlistActive,
  resendOverride
} from "../lib/mail-provider";

const FAKE_KEY = "re_test_not_a_real_key";

function resendConfig() {
  const env = { RESEND_API_KEY: FAKE_KEY };
  return Object.fromEntries(MAIL_CONFIG_KEYS.map((key) => [key, resendOverride(key, env) as string])) as Record<(typeof MAIL_CONFIG_KEYS)[number], string>;
}

test("RESEND_API_KEY switches every mail setting to the Resend SMTP relay as noreply@kneadedloaves.com", () => {
  const config = resendConfig();
  assert.deepEqual({ ...config, SMTP_PASSWORD: "[set]" }, {
    SMTP_HOST: "smtp.resend.com",
    SMTP_PORT: "465",
    SMTP_USER: "resend",
    SMTP_PASSWORD: "[set]",
    EMAIL_FROM: "Kneaded Loaves <noreply@kneadedloaves.com>"
  });
  assert.equal(config.SMTP_PASSWORD, FAKE_KEY);
  const settings = mailerSettings(config);
  assert.equal(settings.from, RESEND_EMAIL_FROM);
  assert.equal(settings.options.host, "smtp.resend.com");
  assert.equal(settings.options.port, 465);
  assert.equal(settings.options.secure, true);
  assert.equal(settings.options.auth.user, "resend");
  assert.equal(mailProvider({ RESEND_API_KEY: FAKE_KEY }), "resend");
});

test("without RESEND_API_KEY the Gmail SMTP settings are used unchanged (fallback)", () => {
  for (const env of [{}, { RESEND_API_KEY: "" }, { RESEND_API_KEY: "   " }]) {
    for (const key of MAIL_CONFIG_KEYS) assert.equal(resendOverride(key, env), undefined);
    assert.equal(mailProvider(env), "smtp");
  }
  assert.equal(resendOverride("JWT_SECRET", { RESEND_API_KEY: FAKE_KEY }), undefined);
  const gmail = mailerSettings({ SMTP_HOST: "smtp.gmail.com", SMTP_PORT: "465", SMTP_USER: "kneadedloaves@gmail.com", SMTP_PASSWORD: "abcd efgh", EMAIL_FROM: "Kneaded Loaves <kneadedloaves@gmail.com>" });
  assert.equal(gmail.from, "Kneaded Loaves <kneadedloaves@gmail.com>");
  assert.equal(gmail.options.host, "smtp.gmail.com");
});

test("readStoredConfig prefers the Resend relay over SMTP env vars and saved Gmail values when RESEND_API_KEY is set", () => {
  const saved = { SMTP_HOST: process.env.SMTP_HOST, EMAIL_FROM: process.env.EMAIL_FROM, RESEND_API_KEY: process.env.RESEND_API_KEY };
  try {
    process.env.SMTP_HOST = "smtp.gmail.com";
    process.env.EMAIL_FROM = "Kneaded Loaves <kneadedloaves@gmail.com>";
    delete process.env.RESEND_API_KEY;
    assert.equal(readStoredConfig("SMTP_HOST", undefined).value, "smtp.gmail.com");
    assert.equal(readStoredConfig("EMAIL_FROM", undefined).value, "Kneaded Loaves <kneadedloaves@gmail.com>");
    process.env.RESEND_API_KEY = FAKE_KEY;
    assert.equal(readStoredConfig("SMTP_HOST", { value: "smtp.gmail.com", secret: false }).value, "smtp.resend.com");
    assert.equal(readStoredConfig("EMAIL_FROM", undefined).value, "Kneaded Loaves <noreply@kneadedloaves.com>");
    assert.equal(readStoredConfig("SMTP_PASSWORD", undefined).value, FAKE_KEY);
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test("Resend refuses a sender outside kneadedloaves.com, so no other brand can appear in From", () => {
  assert.throws(() => mailerSettings({ ...resendConfig(), EMAIL_FROM: "TaleSpyre <hello@talespyre.com>" }), /Resend requires the EMAIL_FROM address to be on kneadedloaves\.com/);
  assert.throws(() => mailerSettings({ ...resendConfig(), EMAIL_FROM: "Kneaded Loaves <kneadedloaves@gmail.com>" }), /Resend requires/);
});

test("every queued email type carries From noreply@kneadedloaves.com and Reply-To kneadedloaves@gmail.com", () => {
  const kinds = [
    ["customer reservation", "maya@example.com", "Your Kneaded Loaves reservation"],
    ["admin new order", "kneadedloaves@gmail.com", "New order"],
    ["admin fallback alert", "tobias.fletch@gmail.com", "New order"],
    ["payment review", "kneadedloaves@gmail.com", "Payment to review"],
    ["payment verified", "maya@example.com", "Payment verified"],
    ["reservation expired", "maya@example.com", "Reservation expired"],
    ["password reset", "maya@example.com", "Reset your Kneaded Loaves password"]
  ] as const;
  for (const [kind, to, subject] of kinds) {
    const message = emailDeliveryMessage({ id: `job-${kind.replace(/\s/g, "-")}`, to, subject, body: "Body", html: "<p>Body</p>" }, RESEND_EMAIL_FROM);
    assert.equal(message.from, "Kneaded Loaves <noreply@kneadedloaves.com>", kind);
    assert.equal(message.replyTo, "kneadedloaves@gmail.com", kind);
    assert.match(message.messageId, /@kneadedloaves\.com>$/, kind);
  }
  assert.equal(EMAIL_REPLY_TO, "kneadedloaves@gmail.com");
});

test("preview allowlist is exactly the two test inboxes and applies to every non-production Vercel deployment", () => {
  assert.deepEqual([...PREVIEW_ALLOWED_RECIPIENTS], ["tobias.fletch@gmail.com", "kneadedloaves@gmail.com"]);
  assert.equal(previewAllowlistActive({ VERCEL_ENV: "preview" }), true);
  assert.equal(previewAllowlistActive({ VERCEL_ENV: "development" }), true);
  assert.equal(previewAllowlistActive({ VERCEL_ENV: "production" }), false);
  assert.equal(previewAllowlistActive({}), false);
});

test("preview allowlist refuses any recipient off the list, including in cc/bcc and display-name forms", () => {
  const preview = { VERCEL_ENV: "preview" };
  assert.doesNotThrow(() => assertPreviewRecipients({ to: "tobias.fletch@gmail.com" }, preview));
  assert.doesNotThrow(() => assertPreviewRecipients({ to: "Kneaded Loaves <KneadedLoaves@Gmail.com>" }, preview));
  assert.throws(() => assertPreviewRecipients({ to: "maya@example.com" }, preview), PreviewRecipientBlockedError);
  assert.throws(() => assertPreviewRecipients({ to: "tobias.fletch@gmail.com, maya@example.com" }, preview), PreviewRecipientBlockedError);
  assert.throws(() => assertPreviewRecipients({ to: "tobias.fletch@gmail.com", bcc: "maya@example.com" }, preview), PreviewRecipientBlockedError);
  assert.throws(() => assertPreviewRecipients({ to: "kneadedloaves@gmail.com", cc: [{ address: "maya@example.com" }] }, preview), PreviewRecipientBlockedError);
  assert.throws(() => assertPreviewRecipients({ to: "" }, preview), PreviewRecipientBlockedError);
  assert.doesNotThrow(() => assertPreviewRecipients({ to: "maya@example.com" }, { VERCEL_ENV: "production" }));
});

test("allowed sender mailboxes are the Gmail fallback account or kneadedloaves.com only", () => {
  assert.equal(allowedSenderMailbox("noreply@kneadedloaves.com"), true);
  assert.equal(allowedSenderMailbox("KneadedLoaves@gmail.com"), true);
  assert.equal(allowedSenderMailbox("someone@example.org"), false);
  assert.equal(allowedSenderMailbox("hello@talespyre.com"), false);
  assert.equal(allowedSenderMailbox("noreply@kneadedloaves.com.evil.test"), false);
});
