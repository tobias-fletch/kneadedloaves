import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { emailDeliveryMessage, mailTransport, mailerSettings, messageIdDomain } from "../lib/email-queue";
import { readStoredConfig, setupConfigKeys } from "../lib/app-config";
import { EMAIL_STATUS_KEY, withEmailStatus } from "../lib/manual-payment-config";
import {
  EMAIL_REPLY_TO,
  EmailNotConfiguredError,
  PREVIEW_ALLOWED_RECIPIENTS,
  PreviewRecipientBlockedError,
  RESEND_EMAIL_FROM,
  allowedSenderMailbox,
  assertPreviewRecipients,
  previewAllowlistActive,
  resendConfigured
} from "../lib/mail-provider";

const FAKE_KEY = "re_test_not_a_real_key";
const OLD_GMAIL_KEYS = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "EMAIL_FROM"];

test("RESEND_API_KEY alone configures the Resend SMTP relay as noreply@kneadedloaves.com", () => {
  const settings = mailerSettings({ RESEND_API_KEY: FAKE_KEY });
  assert.equal(settings.from, RESEND_EMAIL_FROM);
  assert.equal(settings.from, "Kneaded Loaves <noreply@kneadedloaves.com>");
  assert.equal(settings.options.host, "smtp.resend.com");
  assert.equal(settings.options.port, 465);
  assert.equal(settings.options.secure, true);
  assert.equal(settings.options.requireTLS, false);
  assert.equal(settings.options.auth.user, "resend");
  assert.equal(settings.options.auth.pass, FAKE_KEY);
  assert.equal(settings.options.disableFileAccess, true);
  assert.equal(settings.options.disableUrlAccess, true);
  assert.equal(messageIdDomain(settings.from), "kneadedloaves.com");
});

test("old Gmail SMTP_* and EMAIL_FROM env vars are ignored entirely", () => {
  const gmailEnv = { SMTP_HOST: "smtp.gmail.com", SMTP_PORT: "587", SMTP_USER: "kneadedloaves@gmail.com", SMTP_PASSWORD: "gmail-app-password", EMAIL_FROM: "Kneaded Loaves <kneadedloaves@gmail.com>" };
  const settings = mailerSettings({ ...gmailEnv, RESEND_API_KEY: FAKE_KEY });
  assert.equal(settings.options.host, "smtp.resend.com");
  assert.equal(settings.options.auth.pass, FAKE_KEY);
  assert.equal(settings.from, RESEND_EMAIL_FROM);
  // Without RESEND_API_KEY there is no Gmail fallback: nothing is configured.
  assert.throws(() => mailerSettings(gmailEnv), EmailNotConfiguredError);
});

test("without RESEND_API_KEY site email is not configured and the error never names a value", () => {
  for (const env of [{}, { RESEND_API_KEY: "" }, { RESEND_API_KEY: "   " }]) {
    assert.equal(resendConfigured(env), false);
    assert.throws(() => mailerSettings(env), (error: unknown) => error instanceof EmailNotConfiguredError && /set RESEND_API_KEY/.test(error.message));
  }
  assert.equal(resendConfigured({ RESEND_API_KEY: FAKE_KEY }), true);
});

test("mailTransport builds the Resend transport and still enforces the preview allowlist", async () => {
  const created: Array<{ host: string; auth: { user: string } }> = [];
  const sent: unknown[] = [];
  const fake = (options: { host: string; auth: { user: string; pass: string } }) => { created.push(options); return { sendMail: async (message: unknown) => { sent.push(message); return {}; } }; };
  const preview = await mailTransport(fake, { RESEND_API_KEY: FAKE_KEY, VERCEL_ENV: "preview" });
  assert.equal(preview.from, RESEND_EMAIL_FROM);
  assert.equal(created[0].host, "smtp.resend.com");
  await preview.sendMail({ from: preview.from, to: "tobias.fletch@gmail.com", subject: "s", text: "t" });
  await assert.rejects(preview.sendMail({ from: preview.from, to: "maya@example.com", subject: "s", text: "t" }), PreviewRecipientBlockedError);
  assert.equal(sent.length, 1);
  await assert.rejects(mailTransport(fake, {}), EmailNotConfiguredError);
  assert.equal(created.length, 1, "no transport is created without RESEND_API_KEY");
});

test("Admin > Setup no longer stores or reads any Gmail SMTP setting", () => {
  for (const key of OLD_GMAIL_KEYS) assert.ok(!(setupConfigKeys as readonly string[]).includes(key), key);
  assert.ok(!(setupConfigKeys as readonly string[]).includes("RESEND_API_KEY"), "the Resend key is env-only");
  const saved = process.env.RESEND_API_KEY;
  try {
    process.env.RESEND_API_KEY = FAKE_KEY;
    // No Resend override leaks the key through the generic setting reader any more.
    assert.equal(readStoredConfig("SMTP_PASSWORD", undefined).value, "");
    assert.equal(readStoredConfig("SMTP_HOST", undefined).value, "");
  } finally {
    if (saved === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = saved;
  }
});

test("checkout readiness sees only whether RESEND_API_KEY is set, never its value", () => {
  const on = withEmailStatus({ APP_URL: "https://kneadedloaves.com" }, { RESEND_API_KEY: FAKE_KEY });
  const off = withEmailStatus({ APP_URL: "https://kneadedloaves.com" }, {});
  assert.equal(on[EMAIL_STATUS_KEY], "true");
  assert.equal(off[EMAIL_STATUS_KEY], "");
  assert.ok(!JSON.stringify(on).includes(FAKE_KEY));
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx|mjs|js|sh)$/.test(name) ? [path] : [];
  });
}

test("no app, lib, component or script code reads the Gmail SMTP env vars", () => {
  const offenders: string[] = [];
  for (const file of ["app", "lib", "components", "scripts"].flatMap(sourceFiles)) {
    if (file === join("scripts", "build.mjs")) continue; // log redaction pattern only, never a reader
    const text = readFileSync(file, "utf8");
    if (/\b(SMTP_HOST|SMTP_PORT|SMTP_USER|SMTP_PASSWORD|EMAIL_FROM)\b/.test(text)) offenders.push(file);
  }
  assert.deepEqual(offenders, []);
  assert.equal(existsSync("app/api/admin/setup/smtp/route.ts"), false, "the SMTP check route is gone");
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

test("allowed sender mailboxes are kneadedloaves.com only (no Gmail fallback sender)", () => {
  assert.equal(allowedSenderMailbox("noreply@kneadedloaves.com"), true);
  assert.equal(allowedSenderMailbox("KneadedLoaves@gmail.com"), false);
  assert.equal(allowedSenderMailbox("someone@example.org"), false);
  assert.equal(allowedSenderMailbox("hello@talespyre.com"), false);
  assert.equal(allowedSenderMailbox("noreply@kneadedloaves.com.evil.test"), false);
});
